import { prisma } from "@/lib/prisma";
import { createFollowsFromRulesForSource } from "@/features/seguimientos/services/follows";
import { recordConversationActivity } from "@/lib/conversation-activity";
import { CRM_STAGE_META } from "@/features/crm/domain/crm-config";
import type { CrmStage } from "@/features/crm/types";
import type { CommercialConversationContext, CommercialStage } from "@/lib/commercial-stage";

/**
 * PUENTE entre el embudo del bot y el embudo del CRM.
 *
 * Habia dos embudos que no se hablaban: el bot clasifica la conversacion en 7 etapas
 * comerciales (classifyCommercialStage) y las guarda en Conversation.commercialContext, pero lo
 * UNICO que escribia Contact.crmStage era el arrastre manual del kanban. Resultado medido en
 * produccion el 19-jul-2026: 332 de 360 contactos (92%) atascados en NUEVO, aunque el bot ya
 * les habia mandado catalogo y precio. El dueño no podia ver donde se caian las ventas porque
 * el embudo nunca se llenaba solo.
 */

// El bot NO cierra: GANADO/PERDIDO son decision humana. Una venta es plata recibida, no
// intencion de compra; si el bot marcara GANADO por detectar "lo quiero", la tasa de conversion
// naceria inflada y sin valor. Por eso ACUERDO y POSTVENTA llegan hasta NEGOCIACION y ahi para.
const COMMERCIAL_TO_CRM: Record<CommercialStage, CrmStage> = {
  CONEXION: "NUEVO",
  AVERIGUACION: "CALIFICADO",
  DIAGNOSTICO: "CALIFICADO",
  EXPOSICION: "PROPUESTA",
  NEGOCIACION: "NEGOCIACION",
  ACUERDO: "NEGOCIACION",
  POSTVENTA: "NEGOCIACION",
};

// Solo el tramo que el bot puede recorrer, en orden. GANADO/PERDIDO quedan fuera a proposito:
// no son "mas adelante", son un final que decide una persona.
const BOT_STAGE_ORDER: CrmStage[] = ["NUEVO", "CALIFICADO", "PROPUESTA", "NEGOCIACION"];

/**
 * Etapa de CRM que corresponde al estado comercial de la conversacion.
 *
 * No alcanza con traducir `currentStage`: el clasificador mete casi todo en DIAGNOSTICO (medido
 * el 19-jul-2026: 326 de 341 conversaciones), asi que traducir a secas solo mueve el amontonamiento
 * de NUEVO a CALIFICADO y el embudo sigue sin decir nada. Peor: "cotizado" —el momento donde el
 * negocio pierde los leads, justo despues de mandar fotos y precio— quedaba invisible.
 *
 * Por eso mandan tambien las banderas de HECHOS del contexto, que son mas confiables que la
 * etiqueta de etapa porque registran algo que efectivamente paso:
 *  - shownPrice / shownProductMedia => ya se cotizo (PROPUESTA)
 *  - objectionDetected              => el cliente objeto (NEGOCIACION)
 *
 * Con esto el embudo real pasa de "todo en una columna" a 4 / 220 / 114 / 2.
 */
function resolveCrmStageFromContext(
  context: Pick<
    CommercialConversationContext,
    "currentStage" | "shownPrice" | "shownProductMedia" | "objectionDetected"
  >,
): CrmStage | null {
  let target = COMMERCIAL_TO_CRM[context.currentStage] ?? null;
  if (!target) {
    return null;
  }

  if (context.shownPrice || context.shownProductMedia) {
    if (BOT_STAGE_ORDER.indexOf("PROPUESTA") > BOT_STAGE_ORDER.indexOf(target)) {
      target = "PROPUESTA";
    }
  }

  if (context.objectionDetected) {
    target = "NEGOCIACION";
  }

  return target;
}

/**
 * Mueve el lead a la etapa que corresponde a lo que el bot detecto, con dos candados:
 *
 * 1. NUNCA retrocede. La conversacion puede volver a sonar a "averiguacion" (el cliente
 *    pregunta por otro modelo) y no por eso el lead vuelve atras en el embudo.
 * 2. NUNCA toca un lead ya cerrado (GANADO/PERDIDO). Si una persona lo cerro, manda esa
 *    decision; que el cliente escriba de nuevo no lo reabre.
 *
 * Devuelve la etapa nueva si hubo cambio, o null si no habia nada que hacer.
 */
export async function syncCrmStageFromCommercialStage(input: {
  workspaceId: string;
  contactId: string;
  conversationId: string;
  channelId: string | null;
  commercialContext: Pick<
    CommercialConversationContext,
    "currentStage" | "shownPrice" | "shownProductMedia" | "objectionDetected"
  >;
  /**
   * Dejar la nota "el agente movio la etapa" en el historial del chat.
   *
   * Se apaga cuando el chat NO es del canal viejo: el registro de actividad escribe en la tabla
   * Message, atada a Conversation, y un chat de la API oficial no existe ahi. Pasarlo igual
   * hacia que Postgres rechazara el INSERT en CADA mensaje entrante de ese canal
   * (Message_conversationId_fkey). No rompia nada porque el error se traga, pero ensuciaba el
   * log del servidor y le hacia trabajo al vicio a la base. El canal oficial deja su propia
   * nota en su propia tabla (ver official-api-crm-stage.ts).
   */
  recordActivity?: boolean;
}): Promise<CrmStage | null> {
  const target = resolveCrmStageFromContext(input.commercialContext);
  if (!target) {
    return null;
  }

  const contact = await prisma.contact.findFirst({
    where: { id: input.contactId, workspaceId: input.workspaceId },
    select: { crmStage: true },
  });

  if (!contact) {
    return null;
  }

  const current = contact.crmStage as CrmStage;

  // Candado 2: cerrado por una persona, no se toca.
  if (current === "GANADO" || current === "PERDIDO") {
    return null;
  }

  // Candado 1: solo hacia adelante.
  const currentIndex = BOT_STAGE_ORDER.indexOf(current);
  const targetIndex = BOT_STAGE_ORDER.indexOf(target);
  if (targetIndex < 0 || currentIndex < 0 || targetIndex <= currentIndex) {
    return null;
  }

  await prisma.$executeRaw`
    UPDATE "Contact"
    SET "crmStage" = ${target}::"CrmStage",
        "updatedAt" = NOW()
    WHERE "id" = ${input.contactId}
  `;

  // Mismas consecuencias que el cambio manual del kanban, para que el CRM se comporte igual sin
  // importar quien movio la etapa. Esto ademas hace que las reglas de seguimiento por etapa
  // (sourceType CRM_STAGE) empiecen a dispararse solas, que hoy solo pasaba si alguien arrastraba
  // la tarjeta a mano.
  await createFollowsFromRulesForSource({
    workspaceId: input.workspaceId,
    contactId: input.contactId,
    sourceType: "CRM_STAGE",
    sourceId: target,
  }).catch(() => {});

  const stageLabel = CRM_STAGE_META[target]?.label ?? target;
  if (input.recordActivity !== false) {
    await recordConversationActivity({
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      channelId: input.channelId,
      contactId: input.contactId,
      kind: "stage_changed",
      text: `El agente movió la etapa a "${stageLabel}"`,
    }).catch(() => {});
  }

  return target;
}

/** Donde queda anotado que el cliente entrego datos de compra y falta confirmar si se cerro. */
export const CLAVE_CIERRE_PENDIENTE = "cierrePendienteEn";

/**
 * El cliente entrego datos de compra: se marca el momento y el lead pasa a Caliente.
 *
 * Esta señal ya existia y no servia para nada en el CRM. Cuando alguien manda su nombre y su
 * direccion despues de que se le mostro precio y fotos, el sistema lo reconoce, le avisa por
 * WhatsApp a la asesora y pausa la IA. Pero el lead se quedaba donde estaba: medido el
 * 31-ago-2026, de 10 clientes que entregaron datos de compra, 9 seguian en "Frio" y 1 en "Tibio".
 * Ninguno en "Ganado", y el CRM entero tenia 4 ventas registradas en toda su historia.
 *
 * Lo que se hace aca son dos cosas, y NINGUNA es dar la venta por hecha:
 *
 *  1. Mover el lead a Caliente, que es hasta donde el bot tiene permitido llegar. Dar la
 *     direccion es la intencion de compra mas fuerte que existe, y merece esa etapa.
 *  2. Dejar la marca para que en el chat aparezca la pregunta "¿se cerro?", con un toque para
 *     responderla.
 *
 * "Ganado" lo sigue poniendo una persona, a proposito: una venta es plata recibida, no una
 * direccion escrita. Marcarla sola cambiaria un numero que miente por abajo por uno que miente
 * por arriba, y ese es peor -queda trabado y alimenta las vistas de plata-.
 */
export async function marcarCierreDeCompra(input: {
  workspaceId: string;
  contactId: string;
  conversationId: string;
  channelId: string | null;
  recordActivity?: boolean;
}): Promise<boolean> {
  const contact = await prisma.contact.findFirst({
    where: { id: input.contactId, workspaceId: input.workspaceId },
    select: { crmStage: true, metadata: true, excludedFromCrm: true },
  });

  // Un numero marcado fuera del CRM no es un lead: no se le mueve la etapa ni se le pregunta nada.
  if (!contact || contact.excludedFromCrm) {
    return false;
  }

  const actual = contact.crmStage as CrmStage;
  // Ya cerrado por una persona: manda esa decision, igual que en el puente del embudo.
  if (actual === "GANADO" || actual === "PERDIDO") {
    return false;
  }

  const metadata =
    contact.metadata && typeof contact.metadata === "object" && !Array.isArray(contact.metadata)
      ? (contact.metadata as Record<string, unknown>)
      : {};

  // Si ya estaba preguntado y sin responder, no se pisa la fecha: interesa CUANDO entrego los
  // datos la primera vez, no la ultima vez que escribio.
  const yaMarcado = typeof metadata[CLAVE_CIERRE_PENDIENTE] === "string";

  await prisma.contact.update({
    where: { id: input.contactId },
    data: {
      ...(yaMarcado ? {} : { metadata: { ...metadata, [CLAVE_CIERRE_PENDIENTE]: new Date().toISOString() } }),
      // Solo hacia adelante: si ya venia en Caliente se deja como esta.
      ...(BOT_STAGE_ORDER.indexOf(actual) < BOT_STAGE_ORDER.indexOf("NEGOCIACION")
        ? { crmStage: "NEGOCIACION" as CrmStage }
        : {}),
    },
  });

  const avanzo = BOT_STAGE_ORDER.indexOf(actual) < BOT_STAGE_ORDER.indexOf("NEGOCIACION");
  if (avanzo) {
    await createFollowsFromRulesForSource({
      workspaceId: input.workspaceId,
      contactId: input.contactId,
      sourceType: "CRM_STAGE",
      sourceId: "NEGOCIACION",
    }).catch(() => {});

    if (input.recordActivity !== false) {
      await recordConversationActivity({
        workspaceId: input.workspaceId,
        conversationId: input.conversationId,
        channelId: input.channelId,
        contactId: input.contactId,
        kind: "stage_changed",
        text: `El cliente entregó datos de compra: la etapa pasó a "${CRM_STAGE_META.NEGOCIACION.label}"`,
      }).catch(() => {});
    }
  }

  return true;
}

/** Si a este contacto le falta responder "¿se cerró?". */
export function tieneCierrePendiente(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return false;
  }
  return typeof (metadata as Record<string, unknown>)[CLAVE_CIERRE_PENDIENTE] === "string";
}
