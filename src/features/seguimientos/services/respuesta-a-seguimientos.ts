import { prisma } from "@/lib/prisma";
import { ORIGENES_DE_SEGUIMIENTO } from "@/features/seguimientos/dominio/seguimiento-que-escucha";
import {
  limitesDelRango,
  medirRango,
  TOLERANCIA_DEL_FOLLOW_MS,
  VENTANA_DE_RESPUESTA_MS,
  type FollowEjecutado,
  type MedicionDelRango,
  type MensajeDelChat,
  type Rango,
  type SeguimientoEnviado,
} from "@/features/seguimientos/dominio/respuesta-a-seguimientos";

/**
 * % DE RESPUESTA A LOS SEGUIMIENTOS (parte 2: lo que se lee de la base). Solo lectura: no escribe nada.
 * La cuenta esta en dominio/respuesta-a-seguimientos.ts.
 */

/** Tope de seguimientos leidos por rango (una semana normal son unos cientos). */
export const SEGUIMIENTOS_MAXIMOS_POR_RANGO = 20_000;

/** Chats por consulta de mensajes (para no armar un IN enorme). */
const CHATS_POR_CONSULTA = 500;

type Lectura = {
  seguimientos: SeguimientoEnviado[];
  follows: FollowEjecutado[];
  /** true = se llego al tope y faltan seguimientos. */
  cortado: boolean;
};

/** La marca del redactor en el rawPayload: true/false si la tiene, null si no. */
function marcaDeIA(rawPayload: unknown): boolean | null {
  const marca = (rawPayload as { seguimientoQueEscucha?: { deIA?: unknown } } | null)?.seguimientoQueEscucha;
  return typeof marca?.deIA === "boolean" ? marca.deIA : null;
}

function origenDe(rawPayload: unknown): string {
  const source = (rawPayload as { source?: unknown } | null)?.source;
  return typeof source === "string" ? source : "";
}

/** Los seguimientos del rango (y de las 24 h siguientes, que cortan la ventana) y los follows de esas horas. */
async function leerRango(workspaceId: string, rango: Rango): Promise<Lectura> {
  const { inicio, fin } = limitesDelRango(rango);
  const hasta = new Date(fin + VENTANA_DE_RESPUESTA_MS);
  const [filas, follows] = await Promise.all([
    prisma.message.findMany({
      where: {
        workspaceId,
        direction: "OUTBOUND",
        deletedAt: null,
        createdAt: { gte: new Date(inicio), lte: hasta },
        OR: ORIGENES_DE_SEGUIMIENTO.map((source) => ({ rawPayload: { path: ["source"], equals: source } })),
      },
      orderBy: { createdAt: "asc" },
      take: SEGUIMIENTOS_MAXIMOS_POR_RANGO + 1,
      select: { conversationId: true, contactId: true, createdAt: true, rawPayload: true },
    }),
    prisma.follow.findMany({
      where: {
        workspaceId,
        status: "EXECUTED",
        executedAt: { gte: new Date(inicio - TOLERANCIA_DEL_FOLLOW_MS), lte: new Date(hasta.getTime() + TOLERANCIA_DEL_FOLLOW_MS) },
      },
      select: { contactId: true, name: true, followRuleId: true, executedAt: true },
    }),
  ]);
  return {
    seguimientos: filas.slice(0, SEGUIMIENTOS_MAXIMOS_POR_RANGO).map((fila) => ({
      conversationId: fila.conversationId,
      contactId: fila.contactId,
      en: fila.createdAt,
      origen: origenDe(fila.rawPayload),
      marcaDeIA: marcaDeIA(fila.rawPayload),
    })),
    follows: follows.flatMap((f) => (f.executedAt ? [{ contactId: f.contactId, name: f.name, followRuleId: f.followRuleId, executedAt: f.executedAt }] : [])),
    cortado: filas.length > SEGUIMIENTOS_MAXIMOS_POR_RANGO,
  };
}

/** Todos los mensajes (sin contenido) de esos chats hasta `hasta`: para la bienvenida y la respuesta. */
async function leerMensajes(workspaceId: string, chats: string[], hasta: Date): Promise<Map<string, MensajeDelChat[]>> {
  const porChat = new Map<string, MensajeDelChat[]>();
  for (let i = 0; i < chats.length; i += CHATS_POR_CONSULTA) {
    const filas = await prisma.message.findMany({
      where: { workspaceId, conversationId: { in: chats.slice(i, i + CHATS_POR_CONSULTA) }, deletedAt: null, createdAt: { lte: hasta } },
      select: { conversationId: true, direction: true, type: true, createdAt: true },
    });
    for (const fila of filas) {
      const lista = porChat.get(fila.conversationId) ?? [];
      lista.push({ direction: fila.direction, type: fila.type, createdAt: fila.createdAt });
      porChat.set(fila.conversationId, lista);
    }
  }
  return porChat;
}

/** Mide un rango en la base del negocio. `cortado` = se llego al tope de seguimientos leidos. */
export async function medirRespuestaEnElRango(
  workspaceId: string,
  rango: Rango,
  ahora: Date,
): Promise<{ medicion: MedicionDelRango; cortado: boolean }> {
  const lectura = await leerRango(workspaceId, rango);
  const { inicio, fin } = limitesDelRango(rango);
  const chats = [
    ...new Set(lectura.seguimientos.filter((s) => s.en.getTime() >= inicio && s.en.getTime() <= fin).map((s) => s.conversationId)),
  ];
  const mensajesPorChat = await leerMensajes(workspaceId, chats, new Date(fin + VENTANA_DE_RESPUESTA_MS));
  const enLosChats = new Set(chats);
  return {
    medicion: medirRango({
      rango,
      seguimientos: lectura.seguimientos.filter((s) => enLosChats.has(s.conversationId)),
      follows: lectura.follows,
      mensajesPorChat,
      ahora,
    }),
    cortado: lectura.cortado,
  };
}
