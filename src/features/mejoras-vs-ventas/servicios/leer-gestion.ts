import { leerConexionConGestion, type ConexionConGestion } from "@/lib/sincronizacion-gestion";

import { diaDeColombia, type AbonoReducido } from "../dominio/serie";

/**
 * LECTURA DEL MCP DE GESTIÓN (solo leer). Gestión no tiene un endpoint para leer cotizaciones ni abonos (su
 * /api/cotizaciones solo crea, y /api/abonos no existe): lo único que los entrega es su servidor MCP.
 *
 * - Solo se llaman TRES herramientas, fijas: `listar_cotizaciones`, `listar_abonos` y `listar_ventas`. El MCP de
 *   Gestión también tiene herramientas que escriben; cualquier otro nombre se rechaza antes de tocar la red.
 * - Dirección: `<origen de la conexión con Gestión>/api/mcp`. Llave: `GESTION_MCP_LLAVE` si existe; si no, la de la
 *   conexión con Gestión (la del catálogo).
 * - Las respuestas traen clientes, montos y links: se reducen AQUÍ a fecha, si es primer abono, si se anuló, código
 *   de venta y origen. Nada de eso sale del servidor: a la vista solo llegan conteos.
 */

export const HERRAMIENTAS_DE_LECTURA = ["listar_cotizaciones", "listar_abonos", "listar_ventas"] as const;
export type HerramientaDeLectura = (typeof HERRAMIENTAS_DE_LECTURA)[number];

const ESPERA_MS = 30_000;

export class FallaDeGestion extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = "FallaDeGestion";
  }
}

export function esHerramientaDeLectura(nombre: unknown): nombre is HerramientaDeLectura {
  return typeof nombre === "string" && (HERRAMIENTAS_DE_LECTURA as readonly string[]).includes(nombre);
}

type Destino = { url: string; llave: string };

function destinoDe(conexion: ConexionConGestion): Destino {
  const llave = process.env.GESTION_MCP_LLAVE?.trim() || conexion.llave;
  return { url: new URL("/api/mcp", new URL(conexion.url).origin).toString(), llave };
}

/** La respuesta JSON-RPC, venga como JSON o como eventos (text/event-stream). */
async function leerRespuesta(respuesta: Response): Promise<Record<string, unknown> | null> {
  const texto = await respuesta.text();
  if (!texto.trim()) return null;
  const tipo = respuesta.headers.get("content-type") ?? "";
  const candidatos = tipo.includes("text/event-stream")
    ? texto
        .split(/\r?\n/)
        .filter((linea) => linea.startsWith("data:"))
        .map((linea) => linea.slice(5).trim())
    : [texto];
  for (const candidato of candidatos.reverse()) {
    try {
      const datos = JSON.parse(candidato) as unknown;
      if (datos && typeof datos === "object" && !Array.isArray(datos)) return datos as Record<string, unknown>;
    } catch {
      // Se prueba el siguiente evento.
    }
  }
  throw new FallaDeGestion("Gestión respondió algo que no se entiende.");
}

let siguienteId = 1;

async function pedir(destino: Destino, metodo: string, params: Record<string, unknown>, sesion: string | null, esAviso = false) {
  const respuesta = await fetch(destino.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${destino.llave}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(sesion ? { "Mcp-Session-Id": sesion } : {}),
    },
    body: JSON.stringify(esAviso ? { jsonrpc: "2.0", method: metodo, params } : { jsonrpc: "2.0", id: siguienteId++, method: metodo, params }),
    cache: "no-store",
    signal: AbortSignal.timeout(ESPERA_MS),
  });
  if (respuesta.status === 401 || respuesta.status === 403) {
    throw new FallaDeGestion(`Gestión no autorizó la lectura (${respuesta.status}): revisa la llave GESTION_MCP_LLAVE.`, respuesta.status);
  }
  if (!respuesta.ok && !(esAviso && respuesta.status === 202)) {
    throw new FallaDeGestion(`Gestión respondió ${respuesta.status}.`, respuesta.status);
  }
  const datos = esAviso ? null : await leerRespuesta(respuesta);
  if (datos && datos.error) throw new FallaDeGestion("Gestión devolvió un error al leer.");
  return { datos, sesion: respuesta.headers.get("mcp-session-id") ?? sesion };
}

/** Un cliente del MCP de Gestión que SOLO deja llamar las tres herramientas de lectura. */
export type ClienteDeGestion = { llamar(herramienta: string, args: Record<string, unknown>): Promise<unknown> };

export function clienteDeGestion(conexion: ConexionConGestion): ClienteDeGestion {
  const destino = destinoDe(conexion);
  let sesion: Promise<string | null> | null = null;
  const abrir = async () => {
    const inicio = await pedir(
      destino,
      "initialize",
      { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "aizencrm-mejoras-vs-ventas", version: "1.0.0" } },
      null,
    );
    await pedir(destino, "notifications/initialized", {}, inicio.sesion, true).catch(() => null);
    return inicio.sesion;
  };
  return {
    async llamar(herramienta, args) {
      // El candado va antes de cualquier pedido a la red.
      if (!esHerramientaDeLectura(herramienta)) throw new FallaDeGestion(`La herramienta "${String(herramienta)}" no es de lectura: no se llama.`);
      sesion ??= abrir();
      const { datos } = await pedir(destino, "tools/call", { name: herramienta, arguments: args }, await sesion);
      const resultado = (datos?.result ?? null) as Record<string, unknown> | null;
      if (!resultado) throw new FallaDeGestion("Gestión no devolvió resultado.");
      if (resultado.isError) throw new FallaDeGestion(`Gestión no pudo ${herramienta.replace("_", " ")}.`);
      if (resultado.structuredContent !== undefined) return resultado.structuredContent;
      const textos = Array.isArray(resultado.content)
        ? resultado.content.filter((parte): parte is { type: string; text: string } => parte?.type === "text" && typeof parte.text === "string")
        : [];
      for (const parte of textos) {
        try {
          return JSON.parse(parte.text) as unknown;
        } catch {
          // Se prueba la siguiente parte.
        }
      }
      throw new FallaDeGestion("Gestión no devolvió datos que se entiendan.");
    },
  };
}

/* ------------------------------------------------------------------------------------------------
   REDUCIR LAS RESPUESTAS (aquí se quedan clientes, montos y links)
------------------------------------------------------------------------------------------------ */

const comoObjeto = (valor: unknown): Record<string, unknown> | null =>
  valor && typeof valor === "object" && !Array.isArray(valor) ? (valor as Record<string, unknown>) : null;
const texto = (valor: unknown) => (typeof valor === "string" && valor.trim() ? valor.trim() : typeof valor === "number" ? String(valor) : null);

/** La lista de filas de una respuesta: la propia lista o la primera lista que traiga (cotizaciones, abonos, ventas...). */
export function filasDe(datos: unknown, preferida: string): Record<string, unknown>[] {
  const objeto = comoObjeto(datos);
  const lista = Array.isArray(datos)
    ? datos
    : objeto
      ? ([objeto[preferida], objeto.items, objeto.datos, objeto.resultados, ...Object.values(objeto)].find(Array.isArray) ?? null)
      : null;
  if (!lista) throw new FallaDeGestion(`Gestión no devolvió la lista de ${preferida}.`);
  return (lista as unknown[]).map(comoObjeto).filter((fila): fila is Record<string, unknown> => fila !== null);
}

function codigoDeVenta(fila: Record<string, unknown>): string | null {
  const directo = texto(fila.venta_codigo) ?? texto(fila.codigo_venta) ?? texto(fila.ventaCodigo) ?? texto(fila.venta_id);
  if (directo) return directo;
  if (typeof fila.venta === "string" || typeof fila.venta === "number") return texto(fila.venta);
  const venta = comoObjeto(fila.venta);
  return venta ? (texto(venta.codigo) ?? texto(venta.id)) : null;
}

const idDe = (fila: Record<string, unknown>) => texto(fila.id) ?? texto(fila.numero) ?? texto(fila.codigo);

/** Solo el día de cada cotización (por su campo `fecha`, nunca por el filtro del pedido). Sin repetir. */
export function reducirCotizaciones(filas: Record<string, unknown>[], vistas = new Set<string>()): Array<string | null> {
  const dias: Array<string | null> = [];
  for (const fila of filas) {
    const id = idDe(fila);
    if (id) {
      if (vistas.has(id)) continue;
      vistas.add(id);
    }
    dias.push(diaDeColombia(fila.fecha ?? fila.creadaEn ?? fila.created_at));
  }
  return dias;
}

export function reducirAbonos(filas: Record<string, unknown>[], vistos = new Set<string>()): AbonoReducido[] {
  const abonos: AbonoReducido[] = [];
  for (const fila of filas) {
    const id = idDe(fila);
    if (id) {
      if (vistos.has(id)) continue;
      vistos.add(id);
    }
    abonos.push({
      dia: diaDeColombia(fila.fecha ?? fila.fecha_abono ?? fila.creadoEn ?? fila.created_at),
      esPrimerAbono: fila.es_primer_abono === true,
      ventaCancelada: fila.venta_cancelada === true,
      venta: codigoDeVenta(fila),
      origen: typeof fila.origen === "string" ? fila.origen : undefined,
    });
  }
  return abonos;
}

export function reducirVentas(filas: Record<string, unknown>[], origenes: Map<string, unknown> = new Map()): Map<string, unknown> {
  for (const fila of filas) {
    const codigo = texto(fila.codigo) ?? texto(fila.codigo_venta) ?? texto(fila.numero) ?? texto(fila.id);
    if (codigo && typeof fila.origen === "string") origenes.set(codigo, fila.origen);
  }
  return origenes;
}

/* ------------------------------------------------------------------------------------------------
   LO DE GESTIÓN EN LA VENTANA
------------------------------------------------------------------------------------------------ */

export type GestionDeLaVentana = {
  /** El día de cada cotización; null = sin dato. */
  cotizaciones: Array<string | null> | null;
  abonos: AbonoReducido[] | null;
  /** Código de venta → origen; null = no se pudo leer (las ventas salen igual, sin clasificar). */
  origenPorVenta: Map<string, unknown> | null;
  avisos: string[];
};

type Tramo = { desde: string; hasta: string; esDeHoy: boolean };

const MEMORIA = new Map<string, { vence: number; valor: unknown }>();
const SEIS_HORAS = 6 * 3_600_000;
const CINCO_MINUTOS = 5 * 60_000;

async function conMemoria<T>(clave: string, duracion: number, leer: () => Promise<T>): Promise<T> {
  const guardado = MEMORIA.get(clave);
  if (guardado && guardado.vence > Date.now()) return guardado.valor as T;
  const valor = await leer();
  MEMORIA.set(clave, { vence: Date.now() + duracion, valor });
  return valor;
}

const motivoDe = (error: unknown) => (error instanceof FallaDeGestion ? error.message : "No se pudo leer Gestión.");

/**
 * Lee cotizaciones, abonos y ventas de Gestión en cada tramo. Una herramienta que falla deja su dato en null y un
 * aviso; las otras siguen. Nunca lanza.
 */
export async function leerGestionDeLaVentana(
  workspaceId: string,
  tramos: Tramo[],
  opciones: { cliente?: ClienteDeGestion | null } = {},
): Promise<GestionDeLaVentana> {
  const avisos: string[] = [];
  let cliente = opciones.cliente ?? null;
  if (!cliente) {
    const conexion = await leerConexionConGestion(workspaceId).catch(() => null);
    if (!conexion) {
      return { cotizaciones: null, abonos: null, origenPorVenta: null, avisos: ["Este negocio no tiene conexión con Gestión: cotizaciones y ventas quedan sin dato."] };
    }
    cliente = clienteDeGestion(conexion);
  }
  const usar = cliente;

  const leerTodo = async <T>(herramienta: HerramientaDeLectura, extra: Record<string, unknown>, preferida: string) => {
    const porTramo: Record<string, unknown>[][] = [];
    for (const tramo of tramos) {
      const filas = await conMemoria(
        `${workspaceId}:${herramienta}:${tramo.desde}:${tramo.hasta}`,
        tramo.esDeHoy ? CINCO_MINUTOS : SEIS_HORAS,
        async () => filasDe(await usar.llamar(herramienta, { desde: tramo.desde, hasta: tramo.hasta, ...extra }), preferida),
      );
      porTramo.push(filas);
    }
    return porTramo as T;
  };

  let cotizaciones: Array<string | null> | null = null;
  try {
    const vistas = new Set<string>();
    cotizaciones = (await leerTodo<Record<string, unknown>[][]>("listar_cotizaciones", {}, "cotizaciones")).flatMap((filas) =>
      reducirCotizaciones(filas, vistas),
    );
  } catch (error) {
    avisos.push(`Cotizaciones sin dato: ${motivoDe(error)}`);
  }

  let abonos: AbonoReducido[] | null = null;
  try {
    const vistos = new Set<string>();
    abonos = (await leerTodo<Record<string, unknown>[][]>("listar_abonos", {}, "abonos")).flatMap((filas) => reducirAbonos(filas, vistos));
  } catch (error) {
    avisos.push(`Ventas sin dato: ${motivoDe(error)}`);
  }

  let origenPorVenta: Map<string, unknown> | null = null;
  if (abonos) {
    try {
      const origenes = new Map<string, unknown>();
      for (const filas of await leerTodo<Record<string, unknown>[][]>("listar_ventas", { estado: "todas" }, "ventas")) reducirVentas(filas, origenes);
      origenPorVenta = origenes;
    } catch (error) {
      avisos.push(`No se pudo saber si las ventas son de leads nuevos o recurrentes: ${motivoDe(error)}`);
    }
  }

  return { cotizaciones, abonos, origenPorVenta, avisos };
}

/** Solo para las pruebas: vacía la memoria. */
export function olvidarMemoriaDeGestion() {
  MEMORIA.clear();
}
