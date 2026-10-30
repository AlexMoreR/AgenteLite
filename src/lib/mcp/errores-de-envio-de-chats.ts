import { diaDeColombia, resumirErroresDeEnvio, MOTIVOS_DE_FALLO } from "@/lib/chat-envio-reintento";
import { puedeVerElSupervisor } from "@/lib/mcp/supervisor";
import { prisma } from "@/lib/prisma";

/*
  ERRORES DE ENVIO DE CHATS DESDE CLAUDE (solo lectura, tarjeta whovymqk).

  Cuenta los mensajes de las asesoras que NO salieron desde Chats (tabla ChatSendError): por dia,
  por linea y por motivo, y los ultimos con su detalle. Sirve para medir que los errores de envio
  queden cerca de cero. No escribe nada ni manda mensajes. El negocio sale de la clave, nunca de un
  argumento. Lo pueden usar el dueño, los administradores y la supervisora.
*/

type Contexto = { workspaceId: string; userId: string };
type Argumentos = Record<string, unknown>;

const SOLO_LECTURA = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;
const DIA = 24 * 60 * 60_000;
const MAX_FILAS = 5000;

export const HERRAMIENTAS_MCP_ERRORES_DE_ENVIO = [
  {
    name: "errores_de_envio_de_chats",
    title: "Errores de envío de Chats",
    description:
      `Cuenta los mensajes de las asesoras que NO salieron desde Chats: por dia (hora de Colombia, tambien los dias en cero), por linea de WhatsApp (con su gateway) y por motivo (${MOTIVOS_DE_FALLO.join(", ")}), y los ultimos 20 con hora, linea, motivo y detalle. 'origen' navegador = el pedido ni llego al servidor (sin internet o la app reiniciando). guardado_fallo = el cliente SI lo recibio pero no se guardo en la base. Sin desde/hasta usa los ultimos 7 dias. Solo lectura.`,
    inputSchema: {
      type: "object",
      properties: {
        desde: { type: "string", description: "AAAA-MM-DD (hora de Colombia). Por defecto, hace 6 dias." },
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

function leerDia(valor: unknown, nombre: string): string | null {
  const dia = typeof valor === "string" ? valor.trim() : "";
  if (!dia) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia) || Number.isNaN(Date.parse(`${dia}T00:00:00Z`))) {
    throw new Error(`${nombre} debe ser AAAA-MM-DD.`);
  }
  return dia;
}

/** Inicio del dia de Colombia (00:00 en UTC-5) en UTC. */
function inicioDelDia(dia: string) {
  return new Date(Date.parse(`${dia}T05:00:00Z`));
}

async function erroresDeEnvioDeChats(args: Argumentos, contexto: Contexto) {
  if (!(await puedeVerElSupervisor(contexto))) {
    throw new Error("Esta clave no tiene permiso para ver los errores de envío: es solo del dueño, los administradores y la supervisora.");
  }
  const hoy = diaDeColombia(new Date());
  const hasta = leerDia(args.hasta, "hasta") ?? hoy;
  const desde = leerDia(args.desde, "desde") ?? diaDeColombia(new Date(inicioDelDia(hasta).getTime() + 12 * 60 * 60_000 - 6 * DIA));
  if (desde > hasta) {
    throw new Error("desde no puede ser despues de hasta.");
  }

  const filas = await prisma.chatSendError.findMany({
    where: {
      workspaceId: contexto.workspaceId,
      createdAt: { gte: inicioDelDia(desde), lt: new Date(inicioDelDia(hasta).getTime() + DIA) },
    },
    orderBy: { createdAt: "desc" },
    take: MAX_FILAS,
    select: {
      createdAt: true,
      lineaId: true,
      lineaNombre: true,
      gateway: true,
      motivo: true,
      origen: true,
      detalle: true,
      intento: true,
      conversationId: true,
    },
  });

  return {
    desde,
    hasta,
    ...resumirErroresDeEnvio(filas, desde, hasta),
    ...(filas.length >= MAX_FILAS ? { aviso: `Se contaron solo los ultimos ${MAX_FILAS} errores del rango.` } : {}),
    ultimos: filas.slice(0, 20).map((fila) => ({
      cuando: fila.createdAt.toISOString(),
      linea: fila.lineaNombre ?? "Sin línea",
      gateway: fila.gateway,
      motivo: fila.motivo,
      intento: fila.intento,
      origen: fila.origen,
      detalle: fila.detalle,
      conversacion_id: fila.conversationId,
    })),
  };
}

export async function ejecutarHerramientaMcpErroresDeEnvio(nombre: string, argumentos: Argumentos, contexto: Contexto): Promise<unknown> {
  switch (nombre) {
    case "errores_de_envio_de_chats":
      return erroresDeEnvioDeChats(argumentos, contexto);
    default:
      throw new Error(`No existe la herramienta "${nombre}".`);
  }
}
