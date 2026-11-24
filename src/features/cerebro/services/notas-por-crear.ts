import { prisma } from "@/lib/prisma";
import { driveDelNegocio, enlaceParaConectarGoogle } from "./conexion";
import { ErrorDeDrive, esErrorSinEspacio } from "./drive";
import { MIME_CARPETA, problemaDeRutaDeNota, sePuedeEscribir, type EstadoDeNota } from "./reglas";

/*
  CEREBRO: las notas NUEVAS que crea aizen1 (comportamiento VIEJO, hoy apagado por el interruptor de abajo).

  La cuenta de servicio de Google edita los archivos de la carpeta del cerebro, pero NO puede crear uno nuevo en un
  Drive personal (403 storageQuotaExceeded: no tiene espacio propio). Esa carpeta es la bóveda D:\Magilus de aizen1,
  sincronizada con Google Drive para escritorio. Entonces:
    1. escribir.ts deja el pedido aquí (PENDIENTE) con la ruta relativa y el contenido completo;
    2. el Coordinador de aizen1 (trabajador-tablero/lib/notas-boveda.mjs), cada minuto, pide las pendientes por
       GET /api/trabajador/cerebro/notas-por-crear, escribe el archivo en <boveda.ruta>/<ruta> (nunca sobrescribe: si
       ya existe, agrega al final) y la marca CREADA (o ERROR con motivo) por POST;
    3. Drive para escritorio sube el archivo a nombre del dueño y, desde la siguiente sincronización, el CRM lo edita.
  Nunca se borra un pedido: queda como registro.

  Desde la parte 2 (24-nov-2026) aizen1 ya NO escribe en D:\Magilus: el interruptor `cerebro:notas-en-aizen1`
  (AppSetting) está apagado por defecto (sin fila = apagado). Con él apagado:
    - GET notas-por-crear devuelve la lista vacía y escribir.ts no deja pedidos nuevos (crea directo con OAuth o
      avisa con el link para dar el permiso);
    - las notas que quedaron PENDIENTES las crea el CRM en el Drive en la vuelta de cada hora
      (crearNotasPendientesEnDrive, desde sincronizarCerebroDeTodos).
  Prenderlo a mano ("1", "true" o "prendida") vuelve lo de antes SOLO como respaldo cuando falta el permiso OAuth.
*/

export const MAXIMO_POR_VUELTA = 20;

/** El interruptor de las notas por aizen1. Sin fila cuenta como apagado. */
export const CLAVE_NOTAS_EN_AIZEN1 = "cerebro:notas-en-aizen1";

/** ¿Este valor de la fila prende el interruptor? Solo "1", "true" o "prendida" (sin importar mayúsculas). */
export const interruptorPrendido = (valor: string | null | undefined) =>
  ["1", "true", "prendida"].includes(String(valor ?? "").trim().toLowerCase());

/** ¿Las notas nuevas las crea aizen1? false por defecto (sin fila, o con cualquier otro valor). */
export async function notasEnAizen1Prendidas(): Promise<boolean> {
  const fila = await prisma.appSetting.findUnique({ where: { key: CLAVE_NOTAS_EN_AIZEN1 }, select: { value: true } });
  return interruptorPrendido(fila?.value);
}

export type NotaParaElTrabajador = { id: string; ruta: string; contenido: string; creadoEn: string };

/**
 * Las pendientes del negocio de la clave, las más viejas primero (así una segunda nota a la misma ruta se agrega después).
 * Con el interruptor apagado (lo normal) devuelve [] sin mirar la tabla: aizen1 no escribe nada.
 */
export async function notasPendientesParaElTrabajador(workspaceId: string, maximo = MAXIMO_POR_VUELTA): Promise<NotaParaElTrabajador[]> {
  if (!(await notasEnAizen1Prendidas())) return [];
  const filas = await prisma.cerebroNotaPorCrear.findMany({
    where: { workspaceId, estado: "PENDIENTE" },
    orderBy: { creadoEn: "asc" },
    take: Math.min(Math.max(1, maximo), MAXIMO_POR_VUELTA),
    select: { id: true, ruta: true, contenido: true, creadoEn: true },
  });
  return filas.map((fila) => ({ ...fila, creadoEn: fila.creadoEn.toISOString() }));
}

/** Deja una nota PENDIENTE para que la cree aizen1 (solo con el interruptor prendido y sin el permiso OAuth). */
export async function encolarNotaParaAizen1(datos: {
  workspaceId: string;
  ruta: string;
  contenido: string;
  userId: string;
  quienNombre: string | null;
  origen: string;
  tarjetaId?: string | null;
}): Promise<{ id: string }> {
  return prisma.cerebroNotaPorCrear.create({
    data: {
      workspaceId: datos.workspaceId,
      ruta: datos.ruta,
      contenido: datos.contenido,
      userId: datos.userId,
      quienNombre: datos.quienNombre,
      origen: datos.origen,
      tarjetaId: datos.tarjetaId ?? null,
    },
    select: { id: true },
  });
}

/** El separador cuando el archivo ya existía, igual que aizen1 (notas-boveda.mjs): línea en blanco, "---", línea en blanco. */
export function agregarComoAizen1(antes: string, contenido: string): string {
  const texto = String(contenido ?? "").replace(/\s+$/, "") + "\n";
  const separador = !antes.trim() ? "" : antes.endsWith("\n\n") ? "---\n\n" : antes.endsWith("\n") ? "\n---\n\n" : "\n\n---\n\n";
  return `${antes}${separador}${texto}`;
}

export type ResultadoDeNotasPendientes = {
  revisadas: number;
  creadas: number;
  agregadas: number;
  errores: number;
  /** Por qué no se hizo nada (sin pendientes, interruptor prendido sin OAuth, sin carpeta, sin conexión). */
  saltado?: string;
};

const motivoFaltaPermiso = (enlace: string) =>
  `Google no deja crear la nota: falta el permiso de la cuenta de Google de Magilus (o venció, o la app está en "Prueba"). Entra a ${enlace} con esa cuenta y pulsa Permitir. El texto quedó guardado en la base.`;

/**
 * La vuelta de cada hora: toma las notas PENDIENTES (hasta MAXIMO_POR_VUELTA, las más viejas primero) y las crea directo
 * en el Drive del negocio. Si ya hay un archivo con ese nombre en la carpeta (en vivo), le agrega el texto al final, igual
 * que aizen1. Marca cada nota CREADA, o ERROR con el motivo; una que falla no frena a las demás. Nunca borra nada.
 * No hace nada si el interruptor está prendido y no hay OAuth (esas notas son de aizen1) o si falta la carpeta.
 * `conectar` se cambia por un Drive de mentira en las pruebas.
 */
export async function crearNotasPendientesEnDrive(
  workspaceId: string,
  conectar: typeof driveDelNegocio = driveDelNegocio,
): Promise<ResultadoDeNotasPendientes> {
  const resultado: ResultadoDeNotasPendientes = { revisadas: 0, creadas: 0, agregadas: 0, errores: 0 };
  const pendientes = await prisma.cerebroNotaPorCrear.findMany({
    where: { workspaceId, estado: "PENDIENTE" },
    orderBy: { creadoEn: "asc" },
    take: MAXIMO_POR_VUELTA,
    select: { id: true, ruta: true, contenido: true },
  });
  // Sin pendientes (lo normal) no se pide permiso a Google.
  if (!pendientes.length) return { ...resultado, saltado: "sin notas pendientes" };

  let conexionDelDrive: Awaited<ReturnType<typeof driveDelNegocio>>;
  try {
    conexionDelDrive = await conectar(workspaceId);
  } catch (fallo) {
    // Sin conexión no se marca nada: las notas siguen PENDIENTES y se reintentan en la próxima vuelta.
    return { ...resultado, saltado: `sin conexión con el Drive: ${fallo instanceof Error ? fallo.message : "error"}` };
  }
  const { drive, buscador, conexion, modo } = conexionDelDrive;
  if (modo !== "oauth" && (await notasEnAizen1Prendidas())) return { ...resultado, saltado: "interruptor prendido sin OAuth: las crea aizen1" };
  const raizId = conexion.carpetaId;
  if (!raizId) return { ...resultado, saltado: "falta elegir la carpeta del cerebro" };

  // La carpeta de cada ruta, buscada en vivo desde la raíz (así sirve aunque la copia vaya atrasada).
  const carpetas = new Map<string, string | null>([["", raizId]]);
  async function carpetaDe(rutaCarpeta: string): Promise<string | null> {
    if (carpetas.has(rutaCarpeta)) return carpetas.get(rutaCarpeta) ?? null;
    const partes = rutaCarpeta.split("/");
    const padre = await carpetaDe(partes.slice(0, -1).join("/"));
    const encontrada = padre ? (await buscador.buscarPorNombre(padre, partes.at(-1) ?? "")).find((a) => a.tipo === MIME_CARPETA) : undefined;
    const id = encontrada?.driveId ?? null;
    carpetas.set(rutaCarpeta, id);
    return id;
  }

  async function marcar(id: string, estado: "CREADA" | "ERROR", motivo: string | null) {
    // Solo si sigue PENDIENTE: dos vueltas (o un aviso viejo de aizen1) no se pisan.
    await prisma.cerebroNotaPorCrear.updateMany({
      where: { id, workspaceId, estado: "PENDIENTE" },
      data: { estado, motivo: motivo?.slice(0, 1000) ?? null, ...(estado === "CREADA" ? { creadaEn: new Date() } : {}) },
    });
  }

  for (const nota of pendientes) {
    resultado.revisadas += 1;
    try {
      const problema = problemaDeRutaDeNota(nota.ruta);
      if (problema) throw new Error(`La ruta no sirve: ${problema}`);
      const partes = nota.ruta.split(/[\\/]/);
      const nombre = partes.pop() ?? "";
      const rutaCarpeta = partes.join("/");
      const carpetaId = await carpetaDe(rutaCarpeta);
      if (!carpetaId) throw new Error(`No está la carpeta "${rutaCarpeta}" en el Drive del cerebro; no se creó la nota.`);
      const texto = String(nota.contenido ?? "").replace(/\s+$/, "") + "\n";
      const existente = (await buscador.buscarPorNombre(carpetaId, nombre))[0];
      if (existente) {
        if (!sePuedeEscribir(existente.nombre, existente.tipo)) {
          throw new Error(`Ya existe "${nombre}" en esa carpeta y no es un texto .md/.txt (por ejemplo un Google Doc): no se le agrega nada.`);
        }
        const antes = (await drive.leerTexto(existente.driveId, existente.nombre, existente.tipo)) ?? "";
        await drive.reemplazarTexto(existente.driveId, agregarComoAizen1(antes, texto), existente.tipo);
        resultado.agregadas += 1;
      } else {
        await drive.crearTexto(carpetaId, nombre, texto);
        resultado.creadas += 1;
      }
      await marcar(nota.id, "CREADA", null);
    } catch (fallo) {
      resultado.errores += 1;
      const motivo = esErrorSinEspacio(fallo) || (fallo instanceof ErrorDeDrive && fallo.estado === 401)
        ? motivoFaltaPermiso(enlaceParaConectarGoogle())
        : fallo instanceof Error
          ? fallo.message
          : "No se pudo crear la nota.";
      await marcar(nota.id, "ERROR", motivo).catch(() => undefined);
    }
  }
  return resultado;
}

export class ErrorDeNota extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export type MarcaDeNota = { id: string; estado: "CREADA" | "ERROR"; motivo: string | null };

/** Lee y revisa el cuerpo del POST: { id, estado: "CREADA" | "ERROR", motivo? }. */
export function marcaDeEntrada(cuerpo: unknown): MarcaDeNota {
  const datos = (cuerpo ?? {}) as Record<string, unknown>;
  const id = typeof datos.id === "string" ? datos.id.trim() : "";
  if (!id || id.length > 100) throw new ErrorDeNota("Falta el id de la nota.", 400);
  if (datos.estado !== "CREADA" && datos.estado !== "ERROR") throw new ErrorDeNota('estado tiene que ser "CREADA" o "ERROR".', 400);
  const motivo = typeof datos.motivo === "string" && datos.motivo.trim() ? datos.motivo.trim().slice(0, 1000) : null;
  if (datos.estado === "ERROR" && !motivo) throw new ErrorDeNota("Un ERROR necesita su motivo.", 400);
  return { id, estado: datos.estado, motivo };
}

/**
 * Qué hacer con una marca según el estado actual: "cambiar", "igual" (ya estaba así: el Coordinador reintentó el aviso)
 * o un error 409 (ya quedó en otro estado final).
 */
export function decidirMarca(actual: EstadoDeNota | string, nuevo: MarcaDeNota["estado"]): "cambiar" | "igual" {
  if (actual === "PENDIENTE") return "cambiar";
  if (actual === nuevo) return "igual";
  throw new ErrorDeNota(`La nota ya está ${actual}: no se puede pasar a ${nuevo}.`, 409);
}

export async function marcarNotaPorCrear(workspaceId: string, cuerpo: unknown) {
  const marca = marcaDeEntrada(cuerpo);
  const fila = await prisma.cerebroNotaPorCrear.findFirst({ where: { id: marca.id, workspaceId }, select: { estado: true, ruta: true } });
  if (!fila) throw new ErrorDeNota("Esa nota no existe en este negocio.", 404);
  if (decidirMarca(fila.estado, marca.estado) === "igual") return { id: marca.id, estado: fila.estado, ruta: fila.ruta, cambio: false };
  // Solo cambia si sigue PENDIENTE (dos avisos a la vez no se pisan).
  const { count } = await prisma.cerebroNotaPorCrear.updateMany({
    where: { id: marca.id, workspaceId, estado: "PENDIENTE" },
    data: { estado: marca.estado, motivo: marca.motivo, ...(marca.estado === "CREADA" ? { creadaEn: new Date() } : {}) },
  });
  if (!count) throw new ErrorDeNota("La nota cambió mientras se marcaba: vuelve a pedir las pendientes.", 409);
  return { id: marca.id, estado: marca.estado, ruta: fila.ruta, cambio: true };
}

export type NotaReciente = { id: string; ruta: string; estado: string; motivo: string | null; quienNombre: string | null; creadoEn: string; creadaEn: string | null };

/** Las últimas notas para la pantalla y el MCP ("pendiente de crear en aizen1" / "creada" / "error"). */
export async function notasRecientes(workspaceId: string, maximo = 10): Promise<NotaReciente[]> {
  const filas = await prisma.cerebroNotaPorCrear.findMany({
    where: { workspaceId },
    orderBy: { creadoEn: "desc" },
    take: maximo,
    select: { id: true, ruta: true, estado: true, motivo: true, quienNombre: true, creadoEn: true, creadaEn: true },
  });
  return filas.map((fila) => ({ ...fila, creadoEn: fila.creadoEn.toISOString(), creadaEn: fila.creadaEn?.toISOString() ?? null }));
}
