import { whereSinCandadoVigente } from "@/features/chats/domain/candado-no-reasignar";
import { leerMarcaExterior } from "@/features/seguimiento-inteligente/dominio/exterior";
import { recordConversationActivity } from "@/lib/conversation-activity";
import { etapaAlAsignar } from "@/lib/etapa-automatica-crm";
import { prisma } from "@/lib/prisma";

/**
 * RESCATE DE UNA SOLA VEZ (Alex, 22-nov-2026): los chats en Nuevo, sin asesora, que la clienta SÍ
 * escribió (más de un mensaje) y nadie tomó, de los últimos 10 días, se reparten entre Ingrid y María.
 *
 * Por qué: en 30 días quedaron 216 chats así (preguntaron precio, fotos, ubicación) porque la regla
 * del reparto del 11-11 solo asignaba después de las fotos y si después hablaban de precio o ciudad.
 * Desde el 22-11 la regla asigna apenas la clienta escribe algo más (reparto-cuando-lo-necesita.ts);
 * esto se encarga de los que ya quedaron atrás.
 *
 * Lo que hace: asigna por turnos (una a Ingrid, una a María, del chat más reciente al más viejo), deja la
 * nota interna de asignación y, si la etapa automática está prendida, el chat pasa a Frío como cualquier
 * asignación. Lo que NO hace: no le escribe a ninguna clienta, no manda avisos al celular de las asesoras
 * (serían cien de golpe), no toca un chat que ya tenga asesora, ni uno con el candado "No reasignar", ni
 * uno de una clienta de fuera de Colombia. Si hay reglas de seguimiento por etapa del CRM prendidas, no
 * mueve la etapa (el Frío programaría seguimientos que le escriben a la clienta).
 *
 * Corre UNA vez: lo llama el reloj de cada minuto (api/cron/follows) y deja la marca
 * `rescate:nuevo-sin-asesora:2026-11-22` en AppSetting con el resultado. La marca se escribe ANTES de
 * asignar, así dos vueltas a la vez no lo corren dos veces.
 */

export const CLAVE_RESCATE_NUEVO_SIN_ASESORA = "rescate:nuevo-sin-asesora:2026-11-22";

/** Desde el 13-nov-2026 00:00 en Colombia (05:00 UTC): los últimos 10 días contando hoy, 22-nov. */
export const DESDE_RESCATE = new Date("2026-11-13T05:00:00.000Z");

/** Ingrid Sanchez y Maria Bautista (ver_asignacion, 22-11-2026), en el orden del turno. */
export const ASESORAS_DEL_RESCATE = [
  { id: "cms0qky97099f2go1n16d5y3y", nombre: "Ingrid Sanchez" },
  { id: "cmtuns8l302782nlp3cvrgdgt", nombre: "Maria Bautista" },
] as const;

/** Más de un mensaje de la clienta: el primero es el del anuncio. */
export const MINIMO_DE_MENSAJES_DE_LA_CLIENTA = 2;

export type ChatDelRescate = { id: string; numeroDeMensajes: number };

/** Código puro: a quién le toca cada chat, por turnos y del más reciente al más viejo (ya vienen así). */
export function repartirPorTurnos<T>(chats: ReadonlyArray<T>, asesoras: ReadonlyArray<string>): Array<{ chat: T; asesora: string }> {
  if (asesoras.length === 0) return [];
  return chats.map((chat, indice) => ({ chat, asesora: asesoras[indice % asesoras.length] }));
}

export type ResultadoDelRescate = {
  hecho: boolean;
  revisados: number;
  asignados: number;
  porAsesora: Record<string, number>;
  sinEtapa: boolean;
};

/** Corre el rescate si no se corrió nunca. Nunca lanza. */
export async function rescatarNuevoSinAsesoraUnaVez(ahora = new Date()): Promise<ResultadoDelRescate | null> {
  try {
    const marca = await prisma.appSetting.findUnique({ where: { key: CLAVE_RESCATE_NUEVO_SIN_ASESORA }, select: { key: true } });
    if (marca) return null;
    // La marca primero: la clave es única, si otra vuelta la creó antes, esta falla y no hace nada.
    try {
      await prisma.appSetting.create({ data: { key: CLAVE_RESCATE_NUEVO_SIN_ASESORA, value: JSON.stringify({ empezo: ahora.toISOString() }) } });
    } catch {
      return null;
    }

    const asesoras = await prisma.user.findMany({
      where: { id: { in: ASESORAS_DEL_RESCATE.map((asesora) => asesora.id) } },
      select: { id: true },
    });
    const existen = new Set(asesoras.map((asesora) => asesora.id));
    const turno = ASESORAS_DEL_RESCATE.filter((asesora) => existen.has(asesora.id));
    const resultado: ResultadoDelRescate = { hecho: true, revisados: 0, asignados: 0, porAsesora: {}, sinEtapa: false };
    for (const asesora of turno) resultado.porAsesora[asesora.nombre] = 0;

    if (turno.length === ASESORAS_DEL_RESCATE.length) {
      const candidatos = await prisma.conversation.findMany({
        where: {
          assignedToUserId: null,
          status: { notIn: ["CLOSED", "ARCHIVED"] },
          channelId: { not: null },
          channel: { is: { purpose: "SALES" } },
          contact: { crmStage: "NUEVO", excludedFromCrm: false, bloqueadoEn: null, createdAt: { gte: DESDE_RESCATE } },
          ...whereSinCandadoVigente(ahora),
        },
        orderBy: { lastMessageAt: { sort: "desc", nulls: "last" } },
        select: { id: true, workspaceId: true, channelId: true, contactId: true, contact: { select: { metadata: true } } },
        take: 2000,
      });
      resultado.revisados = candidatos.length;

      const conteos = candidatos.length
        ? await prisma.message.groupBy({
            by: ["conversationId"],
            where: {
              conversationId: { in: candidatos.map((chat) => chat.id) },
              direction: "INBOUND",
              type: { not: "SYSTEM" },
              deletedAt: null,
            },
            _count: { _all: true },
          })
        : [];
      const mensajes = new Map(conteos.map((fila) => [fila.conversationId, fila._count._all]));
      const escribieron = candidatos.filter(
        (chat) => (mensajes.get(chat.id) ?? 0) >= MINIMO_DE_MENSAJES_DE_LA_CLIENTA && !leerMarcaExterior(chat.contact?.metadata),
      );

      // Con reglas de seguimiento por etapa prendidas, el Frío le programaría mensajes a la clienta.
      const reglasPorEtapa = await prisma.followRule.count({ where: { sourceType: "CRM_STAGE", isActive: true } });
      resultado.sinEtapa = reglasPorEtapa > 0;

      const nombre = new Map<string, string>(ASESORAS_DEL_RESCATE.map((asesora) => [asesora.id, asesora.nombre]));
      for (const { chat, asesora } of repartirPorTurnos(escribieron, turno.map((t) => t.id))) {
        const asignada = await prisma.conversation.updateMany({
          where: { id: chat.id, assignedToUserId: null },
          data: { assignedToUserId: asesora },
        });
        if (asignada.count === 0) continue;
        resultado.asignados += 1;
        const quien = nombre.get(asesora) ?? "Asesora";
        resultado.porAsesora[quien] = (resultado.porAsesora[quien] ?? 0) + 1;
        await recordConversationActivity({
          workspaceId: chat.workspaceId,
          conversationId: chat.id,
          channelId: chat.channelId,
          contactId: chat.contactId,
          kind: "assigned",
          assigneeUserId: asesora,
          text: `${quien} asignada en el rescate del 22-nov (chat en Nuevo que había escrito y nadie tomó)`,
        }).catch(() => {});
        if (!resultado.sinEtapa) {
          await etapaAlAsignar({ workspaceId: chat.workspaceId, source: "agent", conversationId: chat.id, asesora: quien });
        }
      }
    }

    await prisma.appSetting.update({
      where: { key: CLAVE_RESCATE_NUEVO_SIN_ASESORA },
      data: { value: JSON.stringify({ empezo: ahora.toISOString(), termino: new Date().toISOString(), ...resultado }) },
    });
    console.info("[rescate-nuevo-sin-asesora] listo", resultado);
    return resultado;
  } catch (error) {
    console.error("[rescate-nuevo-sin-asesora] falló", error instanceof Error ? error.message : String(error));
    return null;
  }
}
