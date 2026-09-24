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

/**
 * LA ÚNICA PUERTA por la que un agente puede mover la etapa del CRM.
 *
 * Nace de un bug en producción (22-sep-2026): el Agente V3 escribía `contact.crmStage` con un
 * `prisma.contact.update` propio, en el webhook, sin pasar por este archivo. Su tabla de
 * traducción incluía "ganado", así que una regla del libro podía cerrar la venta sola: a Doris la
 * marcó GANADO por decir su ciudad, sin haber pagado un peso.
 *
 * La regla de negocio de Alex, que no se negocia: **cerrar es decisión humana**. Ni el V2, ni el
 * V3, ni un automatismo ponen GANADO o PERDIDO. Una venta es plata recibida.
 *
 * El candado vive acá y no en cada regla a propósito: las reglas las dicta cualquiera hablando, y
 * una regla mal escrita no puede poder saltarse esto.
 *
 * Qué hace con un cierre pedido por el agente:
 * - GANADO  -> lo rechaza y deja el lead en NEGOCIACION (Caliente). La intención de compra es
 *   real y merece atención urgente; lo que no es real todavía es la venta.
 * - PERDIDO -> lo rechaza y NO mueve nada. "Este no compra" también lo decide una persona.
 */
const ETIQUETAS_DE_ETAPA: Record<string, CrmStage> = {
  nuevo: "NUEVO",
  frio: "CALIFICADO",
  calificado: "CALIFICADO",
  tibio: "PROPUESTA",
  propuesta: "PROPUESTA",
  caliente: "NEGOCIACION",
  negociacion: "NEGOCIACION",
  ganado: "GANADO",
  vendido: "GANADO",
  descartado: "PERDIDO",
  perdido: "PERDIDO",
};

/**
 * La decisión, sin base de datos: qué etapa le queda a un lead cuando un agente pide moverlo.
 *
 * Va separada para poder probarla de verdad. El candado es una regla de negocio, no un detalle
 * técnico: merece una prueba que se corra sin tocar producción ni mandarle un WhatsApp a nadie.
 */
export function decidirEtapaDeAgente(
  etapaPedida: string,
  etapaActual: CrmStage,
): { destino: CrmStage | null; motivo?: ResultadoEtapaDeAgente["motivo"] } {
  const normalizada = etapaPedida
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
  const pedida = ETIQUETAS_DE_ETAPA[normalizada];

  if (!pedida) {
    return { destino: null, motivo: "etapa-desconocida" };
  }

  // Cerrar es decisión humana: GANADO baja a Caliente, PERDIDO no mueve nada.
  if (pedida === "PERDIDO") {
    return { destino: null, motivo: "cierre-prohibido" };
  }
  const destino: CrmStage = pedida === "GANADO" ? "NEGOCIACION" : pedida;

  if (etapaActual === "GANADO" || etapaActual === "PERDIDO") {
    return { destino: null, motivo: "ya-cerrado" };
  }

  const indiceActual = BOT_STAGE_ORDER.indexOf(etapaActual);
  const indiceDestino = BOT_STAGE_ORDER.indexOf(destino);
  if (indiceDestino < 0 || indiceActual < 0 || indiceDestino <= indiceActual) {
    return { destino: null, motivo: "no-retrocede" };
  }

  return { destino };
}

export type ResultadoEtapaDeAgente = {
  /** Etapa a la que quedó, o null si no se movió. */
  etapa: CrmStage | null;
  /** Por qué no se movió, para poder explicarlo sin adivinar. */
  motivo?: "etapa-desconocida" | "cierre-prohibido" | "ya-cerrado" | "no-retrocede" | "sin-contacto";
};

export async function moverEtapaDesdeAgente(input: {
  workspaceId: string;
  contactId: string;
  conversationId: string;
  channelId: string | null;
  /** Lo que pidió la regla, en palabras del negocio: "Tibio", "Caliente", "Ganado"... */
  etapa: string;
  recordActivity?: boolean;
}): Promise<ResultadoEtapaDeAgente> {
  const contact = await prisma.contact.findFirst({
    where: { id: input.contactId, workspaceId: input.workspaceId },
    select: { crmStage: true, excludedFromCrm: true },
  });
  if (!contact || contact.excludedFromCrm) {
    return { etapa: null, motivo: "sin-contacto" };
  }

  const { destino, motivo } = decidirEtapaDeAgente(input.etapa, contact.crmStage as CrmStage);

  // El cierre rechazado queda en el log a proposito: si vuelve a pasar, se ve que lo pidio y cuando.
  if (motivo === "cierre-prohibido" || (destino === "NEGOCIACION" && /ganado|vendido/i.test(input.etapa))) {
    console.warn("[crm] cierre rechazado: un agente no puede cerrar una venta", {
      contactId: input.contactId,
      conversationId: input.conversationId,
      pidio: input.etapa,
      queda: destino ?? contact.crmStage,
    });
  }

  if (!destino) {
    return { etapa: null, motivo };
  }

  await prisma.$executeRaw`
    UPDATE "Contact"
    SET "crmStage" = ${destino}::"CrmStage",
        "updatedAt" = NOW()
    WHERE "id" = ${input.contactId}
  `;

  // Las mismas consecuencias que mover la tarjeta a mano, igual que en el puente del V2.
  await createFollowsFromRulesForSource({
    workspaceId: input.workspaceId,
    contactId: input.contactId,
    sourceType: "CRM_STAGE",
    sourceId: destino,
  }).catch(() => {});

  if (input.recordActivity !== false) {
    await recordConversationActivity({
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      channelId: input.channelId,
      contactId: input.contactId,
      kind: "stage_changed",
      text: `El agente movió la etapa a "${CRM_STAGE_META[destino]?.label ?? destino}"`,
    }).catch(() => {});
  }

  return { etapa: destino };
}
