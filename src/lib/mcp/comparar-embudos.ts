import {
  esDiaValido,
  esOrigen,
  etiquetaDeVersion,
  familiaDePedido,
  textoDeComparacion,
  ORIGENES,
} from "@/features/embudo/dominio/comparar";
import { nombreDeFamilia } from "@/features/embudo/dominio/semanal";
import { leerComparacion } from "@/features/embudo/servicios/leer-comparacion";
import { puedeVerElSupervisor } from "@/lib/mcp/supervisor";

/*
  COMPARAR EMBUDOS DESDE CLAUDE (solo lectura).

  Devuelve lo mismo que la pantalla /cliente/direccion/comparar-embudos: dos versiones del libro lado a
  lado (chats, % que respondió la bienvenida, dio su ciudad, llegó a Caliente, compró, en qué paso
  se cae la gente, días hasta la venta y plata), más un texto corto para decir por voz qué versión
  vende más. Usa EL MISMO cálculo que la pantalla (features/embudo/dominio/comparar.ts).

  No escribe nada, no manda mensajes y no toca el bot. El negocio sale de la clave, nunca de un
  argumento. Lo pueden usar las mismas personas que ven la pantalla: dueño, administradores y
  supervisora.
*/

type Contexto = { workspaceId: string; userId: string };
type Argumentos = Record<string, unknown>;

const SOLO_LECTURA = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;

export const HERRAMIENTAS_MCP_COMPARAR_EMBUDOS = [
  {
    name: "comparar_embudos",
    title: "Comparar dos versiones del embudo",
    description:
      "Compara DOS VERSIONES del libro del agente lado a lado (la 'version' es la del libro con la que entro el chat). Por version: chats que entraron, % que respondio la bienvenida, % que dio su ciudad, % que llego a Caliente, % que compro (tasa de cierre), el paso donde se cae la mayoria, dias promedio hasta la venta y plata vendida (hoy 'no disponible': el CRM no guarda el monto). Trae 'resumen_para_decir' con una frase de que version vende mas y donde se cae la gente, y avisa 'faltan datos' si una version tiene menos de 100 chats. Sin version_a/version_b compara las dos con mas chats. Solo lectura: no cambia el bot ni manda mensajes.",
    inputSchema: {
      type: "object",
      properties: {
        producto: {
          type: "string",
          description: "Familia de producto: combo, camillas, manicura, sillas, lavacabezas, marketplace u otros (tambien acepta el nombre, ej. 'camillas'). Por defecto combo.",
        },
        version_a: { type: "string", description: "Numero de version (ej. '3') o 'sin' para los chats sin version. Opcional." },
        version_b: { type: "string", description: "Numero de version (ej. '4') o 'sin' para los chats sin version. Opcional." },
        desde: { type: "string", description: "AAAA-MM-DD (hora de Colombia). Por defecto, hace 60 dias." },
        hasta: { type: "string", description: "AAAA-MM-DD (hora de Colombia), incluido. Por defecto, hoy." },
        linea_id: { type: "string", description: "Id de una linea de WhatsApp de ventas, para ver solo esa." },
        origen: { type: "string", enum: ORIGENES.map((origen) => origen.clave), description: "anuncio, marketplace o directo." },
      },
      additionalProperties: false,
    },
    annotations: SOLO_LECTURA,
  },
] as const;

const NOMBRES = new Set<string>(HERRAMIENTAS_MCP_COMPARAR_EMBUDOS.map((herramienta) => herramienta.name));

export function esHerramientaDeCompararEmbudos(nombre: string) {
  return NOMBRES.has(nombre);
}

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
}

/** undefined = no la pidió (elige sola); null = "sin"; número = esa versión. Lanza si es inválida. */
export function leerVersion(valor: unknown, nombre: string): number | null | undefined {
  if (valor === undefined || valor === null || valor === "") return undefined;
  const limpio = String(valor).trim().toLowerCase().replace(/^v(ersi[oó]n)?\s*/, "");
  if (limpio === "sin" || limpio === "sin version") return null;
  if (/^\d{1,6}$/.test(limpio)) return Number(limpio);
  throw new Error(`${nombre} debe ser un número de versión (ej. 3) o "sin".`);
}

function leerDia(valor: unknown, nombre: string): string | null {
  const dia = texto(valor);
  if (!dia) return null;
  if (!esDiaValido(dia)) throw new Error(`${nombre} debe ser AAAA-MM-DD.`);
  return dia;
}

async function compararEmbudos(args: Argumentos, contexto: Contexto) {
  if (!(await puedeVerElSupervisor(contexto))) {
    throw new Error("Esta clave no tiene permiso para comparar embudos: es solo del dueño, los administradores y la supervisora.");
  }
  const pedidoProducto = texto(args.producto);
  const familia = pedidoProducto ? familiaDePedido(pedidoProducto) : "combo";
  if (!familia) throw new Error(`No reconozco el producto "${pedidoProducto}". Usa combo, camillas, manicura, sillas, lavacabezas, marketplace u otros.`);
  const origenPedido = texto(args.origen);
  if (origenPedido && !esOrigen(origenPedido)) throw new Error("origen debe ser anuncio, marketplace o directo.");

  const lectura = await leerComparacion(contexto.workspaceId, {
    desde: leerDia(args.desde, "desde"),
    hasta: leerDia(args.hasta, "hasta"),
    canalId: texto(args.linea_id) || null,
    origen: origenPedido && esOrigen(origenPedido) ? origenPedido : null,
    familia,
    versionA: leerVersion(args.version_a, "version_a"),
    versionB: leerVersion(args.version_b, "version_b"),
  });

  const base = {
    producto: nombreDeFamilia(familia),
    desde: lectura.desde,
    hasta: lectura.hasta,
    versiones_con_chats: lectura.versiones.map((item) => ({ version: etiquetaDeVersion(item.version), chats: item.chats })),
    chats_sin_version: lectura.sinVersion,
  };
  if (!lectura.activo) {
    return { ...base, resumen_para_decir: "El registro del embudo está apagado en este negocio: no hay datos para comparar." };
  }
  if (!lectura.comparacion) {
    return {
      ...base,
      resumen_para_decir:
        lectura.versiones.length < 2
          ? "Hay menos de dos versiones con chats en ese rango y filtros: no se puede comparar. Prueba con otras fechas o pide version_a y version_b."
          : "Indica version_a y version_b para comparar.",
    };
  }
  const { a, b, diferencias, ganadora, avisos } = lectura.comparacion;
  return {
    ...base,
    version_que_vende_mas: ganadora ? lectura.comparacion[ganadora].etiqueta : null,
    version_a: a,
    version_b: b,
    diferencia_de_b_frente_a_a: Object.fromEntries(Object.entries(diferencias).map(([clave, dif]) => [clave, dif.texto])),
    avisos,
    resumen_para_decir: textoDeComparacion(lectura.comparacion),
  };
}

export async function ejecutarHerramientaMcpCompararEmbudos(nombre: string, argumentos: Argumentos, contexto: Contexto): Promise<unknown> {
  switch (nombre) {
    case "comparar_embudos":
      return compararEmbudos(argumentos, contexto);
    default:
      throw new Error(`No existe la herramienta "${nombre}".`);
  }
}
