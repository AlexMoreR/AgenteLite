import { prisma } from "@/lib/prisma";
import { puedeVerElSupervisor } from "@/lib/mcp/supervisor";

/*
  ERRORES DE ENVIO DE CHATS DESDE CLAUDE (solo lectura).

  Cuenta los errores al enviar un texto desde /cliente/chats (tabla ChatSendError) por dia, por
  linea y por motivo, para medir si la queja "sale error y toca recargar" bajo a cerca de cero.
  Sin fechas usa los ultimos 7 dias. No escribe nada y no envia ningun mensaje. El negocio sale de
  la clave, nunca de un argumento. Lo pueden usar el dueño, los administradores y la supervisora.
*/

type Contexto = { workspaceId: string; userId: string };
type Argumentos = Record<string, unknown>;

const SOLO_LECTURA = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;

export const HERRAMIENTAS_MCP_ERRORES_DE_ENVIO = [
  {
    name: "errores_de_envio_de_chats",
    title: "Errores de envio de Chats",
    description:
      "Cuenta los errores al enviar un texto desde Chats: por dia (hora de Colombia), por linea de WhatsApp (con su gateway) y por motivo (version_vieja, sin_red, timeout_gateway, gateway_rechazo, conexion_cerrada, guardado_fallo, sesion u otro). Cada error se anota desde el servidor o, si el navegador ni llego al servidor, desde el navegador. Sirve para confirmar que los errores de envio por dia quedaron cerca de cero. Sin desde/hasta usa los ultimos 7 dias. Solo lectura: no envia nada.",
    inputSchema: {
      type: "object",
      properties: {
        desde: { type: "string", description: "AAAA-MM-DD (hora de Colombia). Por defecto, hace 7 dias." },
        hasta: { type: "string", description: "AAAA-MM-DD (hora de Colombia), incluido. Por defecto, hoy." },
      },
      additionalProperties: false,
    },
    annotations: SOLO_LECTURA,
  },
] as const;

const NOMBRES = new Set<string>(HERRAMIENTAS_MCP_ERRORES_DE_ENVIO.map((herramienta) => herramienta.name));

export function esHerramientaDeErroresDeEnvio(nombre: string) {
  return NOMBRES.has(nombre);
}

const ZONA = "America/Bogota";

function leerDia(valor: unknown, nombre: string): string | null {
  const dia = typeof valor === "string" ? valor.trim() : "";
  if (!dia) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia) || Number.isNaN(Date.parse(`${dia}T00:00:00Z`))) {
    throw new Error(`${nombre} debe ser AAAA-MM-DD.`);
  }
  return dia;
}

function diaDeColombia(fecha: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: ZONA, year: "numeric", month: "2-digit", day: "2-digit" }).format(fecha);
}

async function erroresDeEnvio(args: Argumentos, contexto: Contexto) {
  if (!(await puedeVerElSupervisor(contexto))) {
    throw new Error("Esta clave no tiene permiso para ver los errores de envio: es solo del dueño, los administradores y la supervisora.");
  }
  const hoy = diaDeColombia(new Date());
  const haceSiete = diaDeColombia(new Date(Date.now() - 6 * 24 * 60 * 60 * 1000));
  const desde = leerDia(args.desde, "desde") ?? haceSiete;
  const hasta = leerDia(args.hasta, "hasta") ?? hoy;

  // Colombia es UTC-5 todo el año (sin horario de verano).
  const inicio = new Date(`${desde}T05:00:00.000Z`);
  const fin = new Date(new Date(`${hasta}T05:00:00.000Z`).getTime() + 24 * 60 * 60 * 1000);

  const filas = await prisma.chatSendError.findMany({
    where: { workspaceId: contexto.workspaceId, createdAt: { gte: inicio, lt: fin } },
    select: { createdAt: true, lineaNombre: true, gateway: true, motivo: true, origen: true, intento: true },
    orderBy: { createdAt: "asc" },
    take: 20000,
  });

  const porDia = new Map<string, number>();
  const porLinea = new Map<string, { linea: string; gateway: string | null; errores: number }>();
  const porMotivo = new Map<string, number>();
  let desdeNavegador = 0;
  for (const fila of filas) {
    const dia = diaDeColombia(fila.createdAt);
    porDia.set(dia, (porDia.get(dia) ?? 0) + 1);
    const nombreLinea = fila.lineaNombre ?? "(sin linea)";
    const claveLinea = `${nombreLinea}|${fila.gateway ?? ""}`;
    const actual = porLinea.get(claveLinea) ?? { linea: nombreLinea, gateway: fila.gateway, errores: 0 };
    actual.errores += 1;
    porLinea.set(claveLinea, actual);
    porMotivo.set(fila.motivo, (porMotivo.get(fila.motivo) ?? 0) + 1);
    if (fila.origen === "navegador") desdeNavegador += 1;
  }

  // Todos los dias del rango, con 0 donde no hubo errores (para ver que bajo, no solo que hubo).
  const dias: Array<{ dia: string; errores: number }> = [];
  for (let t = Date.parse(`${desde}T00:00:00Z`); t <= Date.parse(`${hasta}T00:00:00Z`) && dias.length < 120; t += 24 * 60 * 60 * 1000) {
    const dia = new Date(t).toISOString().slice(0, 10);
    dias.push({ dia, errores: porDia.get(dia) ?? 0 });
  }

  const total = filas.length;
  return {
    desde,
    hasta,
    total_errores: total,
    desde_el_navegador: desdeNavegador,
    por_dia: dias,
    por_linea: [...porLinea.values()].sort((a, b) => b.errores - a.errores),
    por_motivo: [...porMotivo.entries()].map(([motivo, errores]) => ({ motivo, errores })).sort((a, b) => b.errores - a.errores),
    resumen_para_decir:
      total === 0
        ? `Del ${desde} al ${hasta} no hubo errores de envio en Chats.`
        : `Del ${desde} al ${hasta} hubo ${total} errores de envio en Chats; el motivo mas frecuente fue ${[...porMotivo.entries()].sort((a, b) => b[1] - a[1])[0][0]}.`,
  };
}

export async function ejecutarHerramientaMcpErroresDeEnvio(nombre: string, argumentos: Argumentos, contexto: Contexto): Promise<unknown> {
  switch (nombre) {
    case "errores_de_envio_de_chats":
      return erroresDeEnvio(argumentos, contexto);
    default:
      throw new Error(`No existe la herramienta "${nombre}".`);
  }
}
