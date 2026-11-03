import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { registrarCambioDeEtapa } from "@/lib/historial-etapa";
import { decidirEtapaDeAgente } from "@/lib/crm-stage-sync";
import { recordConversationActivity } from "@/lib/conversation-activity";
import { createFollowsFromRulesForSource } from "@/features/seguimientos/services/follows";
import type { CrmStage } from "@/features/crm/types";

export { textoTraeElTotal } from "@/lib/etapa-automatica-crm-texto";

/**
 * ETAPA AUTOMÁTICA DEL CRM (22-oct-2026).
 *
 * Había ~1.900 leads en NUEVO ("---"): solo ese día entraron 90 y ninguno avanzó, así que el embudo
 * no se podía medir ni supervisar. Este "motor" mueve la etapa en dos momentos:
 *  - se le asigna el chat a una asesora y el lead está en NUEVO  -> Frío (CALIFICADO);
 *  - se crea la cotización en Gestión desde el chat, o sale al cliente el mensaje del panel de
 *    envío con el total                                          -> Caliente (NEGOCIACION).
 *
 * Usa el mismo candado que el bot (`decidirEtapaDeAgente`): nunca pone Ganado ni Perdido (eso lo
 * decide una persona, y Ganado pide número de cotización), nunca baja a un lead y no toca los
 * cerrados. Tampoco toca contactos "fuera del CRM" ni los de la línea administrativa.
 *
 * El cambio solo se guarda si el lead SIGUE en la etapa que se leyó: si alguien lo movió a mano en
 * el medio, o dos cambios llegan a la vez, entra uno solo. Cada cambio deja la nota "Etapa movida
 * por el sistema: ..." en el chat y una fila en el historial de etapas (origen AUTOMATICO).
 *
 * Interruptor: AppSetting `crm:etapa-automatica:<negocio>` = `off`. Viene prendido.
 * NUNCA lanza: la asignación, la cotización o el envío ya ocurrieron y no se pueden romper por esto.
 *
 * LO QUE DICE EL CLIENTE (23-oct-2026, ver features/crm/services/etapa-por-lectura.ts): con cada
 * mensaje del cliente se lee la intención y se mueve a Frío (pide precio o fotos, solo desde "---"),
 * Caliente, Tibio o Descartado. Además de lo de arriba:
 *  - LA ETAPA PUESTA A MANO NUNCA BAJA (3-nov-2026, reemplaza la ventana de 24 horas): si el último
 *    cambio del historial es de una persona (ASESORA o MCP), el sistema solo la puede SUBIR, sin importar
 *    cuánto tiempo pasó. Ver `puedeMoverSobreEtapaManual`;
 *  - Descartado es la ÚNICA bajada (y por eso nunca entra sobre una etapa puesta a mano), sale solo de una frase clara (nunca de la IA) y tiene su propio
 *    interruptor: `crm:etapa-automatica:descarte:<negocio>` = `off`. Viene prendido;
 *  - Tibio sobre un Caliente no lo baja: solo le deja la fecha de recontacto en la ficha;
 *  - no dispara las reglas de seguimiento por etapa: leer un mensaje no puede terminar en un WhatsApp.
 */

export type MotivoDeEtapaAutomatica =
  | { tipo: "asignado"; asesora?: string | null }
  | { tipo: "cotizacion"; referencia?: string | null }
  | { tipo: "panel-de-envio" }
  /** Lo dijo el cliente. `metodo`: si lo decidió una frase clara o la IA. */
  | { tipo: "lectura"; porque: string; metodo: "frase" | "ia" };

const ETIQUETA: Partial<Record<CrmStage, string>> = {
  CALIFICADO: "Frío",
  PROPUESTA: "Tibio",
  NEGOCIACION: "Caliente",
  PERDIDO: "Descartado",
};

/** Prefijo de la nota del historial: así el embudo y la lista de Llamadas reconocen estos cambios. */
export const NOTA_ETAPA_AUTOMATICA = "etapa automática";

export function claveInterruptorEtapaAutomatica(workspaceId: string): string {
  return `crm:etapa-automatica:${workspaceId}`;
}

export async function etapaAutomaticaPrendida(workspaceId: string): Promise<boolean> {
  const fila = await prisma.appSetting.findUnique({
    where: { key: claveInterruptorEtapaAutomatica(workspaceId) },
    select: { value: true },
  });
  return fila?.value?.trim().toLowerCase() !== "off";
}

/** Interruptor aparte, solo para el descarte por lo que dice el cliente. */
export function claveInterruptorDescarteAutomatico(workspaceId: string): string {
  return `crm:etapa-automatica:descarte:${workspaceId}`;
}

export async function descartePorLecturaPrendido(workspaceId: string): Promise<boolean> {
  const fila = await prisma.appSetting.findUnique({
    where: { key: claveInterruptorDescarteAutomatico(workspaceId) },
    select: { value: true },
  });
  return fila?.value?.trim().toLowerCase() !== "off";
}

/** Donde queda, en Contact.metadata, cuándo volver a escribirle a un Tibio (texto ISO). */
export const CLAVE_RECONTACTO = "recontactarEl";
/** Donde queda la frase exacta con la que el cliente se descartó solo. */
export const CLAVE_DESCARTE_POR_LECTURA = "descartePorLectura";

/** El orden de subida. Perdido (Descartado) no está: no es "más arriba" de nada, es un final. */
const ORDEN_DE_SUBIDA: CrmStage[] = ["NUEVO", "CALIFICADO", "PROPUESTA", "NEGOCIACION", "GANADO"];

/** Los orígenes del historial que son una persona: lo que ellas ponen el sistema nunca lo baja. */
const ORIGENES_A_MANO = ["ASESORA", "MCP"];

/**
 * ¿El sistema puede pasar el lead de `actual` a `destino`? Si el último cambio de etapa lo hizo una
 * persona (ASESORA o MCP), solo si es una SUBIDA en el orden --- < Frío < Tibio < Caliente < Ganado,
 * sin importar cuánto tiempo pasó. Descartado nunca entra sobre una etapa puesta a mano (es una bajada)
 * y sobre un Descartado puesto a mano no se sube nada. Si el último cambio no fue de una persona (o no
 * hay historial), decide el resto del motor.
 *
 * La parte 2 la reutiliza para el Ganado de Gestión, la única excepción (pasa por encima de un
 * Descartado puesto a mano): esa excepción la pone quien llama, no esta función.
 */
export function puedeMoverSobreEtapaManual(
  actual: CrmStage | null | undefined,
  destino: CrmStage,
  ultimoOrigen: string | null | undefined,
): boolean {
  if (!ultimoOrigen || !ORIGENES_A_MANO.includes(ultimoOrigen)) return true;
  return esSubida(actual, destino);
}

/** ¿De `actual` a `destino` es subir en el orden --- < Frío < Tibio < Caliente < Ganado? */
function esSubida(actual: CrmStage | null | undefined, destino: CrmStage): boolean {
  const desde = ORDEN_DE_SUBIDA.indexOf(actual ?? "NUEVO");
  const hasta = ORDEN_DE_SUBIDA.indexOf(destino);
  return desde >= 0 && hasta >= 0 && hasta > desde;
}

/**
 * La causa de una falla en UNA palabra corta y sin el mensaje completo, para el registro.
 *
 * 30-oct-2026: el registro anterior dejaba `error: 'fetch failed'` y el mensaje entero de Prisma (varias
 * líneas que empiezan con `error: '\n' +`) cada vez que la IA o la base no contestaban. Esas líneas
 * cuentan como falla nueva en la vigilancia de 30 minutos después de subir, y la subida se deshizo. Lo
 * que no se pudo hacer acá no rompe nada (se intenta con el próximo mensaje): basta una línea informativa.
 */
export function causaCorta(falla: unknown): string {
  const codigo = (falla as { code?: unknown } | null)?.code;
  // Solo códigos de Prisma (P2024) o de Postgres (57P03): los de red (ECONNREFUSED) son palabras de
  // falla para la vigilancia y van como "sin-conexion".
  if (typeof codigo === "string" && /^(P\d{4}|[0-9][0-9A-Z]{4})$/.test(codigo)) return `base-${codigo}`;
  const nombre = falla instanceof Error ? falla.name : "";
  const mensaje = falla instanceof Error ? falla.message : String(falla ?? "");
  if (nombre === "AbortError" || nombre === "TimeoutError") return "tardo-demasiado";
  if (typeof codigo === "string" && /^E[A-Z]+$/.test(codigo)) return "sin-conexion";
  if (/fetch failed|ECONN|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|socket/i.test(mensaje)) return "sin-conexion";
  if (/prisma/i.test(mensaje)) return "base";
  const http = mensaje.match(/\b(\d{3})\b/);
  return http ? `http-${http[1]}` : "otra";
}

/** "se asignó a Laura", "se creó la cotización COT-123", "se envió el panel de envío con el total". */
export function textoDelMotivo(motivo: MotivoDeEtapaAutomatica): string {
  if (motivo.tipo === "asignado") {
    return motivo.asesora?.trim() ? `se asignó a ${motivo.asesora.trim()}` : "se asignó a una asesora";
  }
  if (motivo.tipo === "cotizacion") {
    return motivo.referencia?.trim() ? `se creó la cotización ${motivo.referencia.trim()}` : "se creó la cotización";
  }
  if (motivo.tipo === "lectura") return motivo.porque;
  return "se envió el panel de envío con el total";
}

/** Texto de la nota que se ve en el chat. */
export function notaDelChat(destino: CrmStage, motivo: MotivoDeEtapaAutomatica): string {
  return `Etapa movida por el sistema: ${ETIQUETA[destino] ?? destino} (${textoDelMotivo(motivo)})`;
}

/** La nota del historial. Con lectura lleva el método al final ("[frase]" o "[ia]"), para poder contarlos. */
export function notaDelHistorial(motivo: MotivoDeEtapaAutomatica): string {
  const metodo = motivo.tipo === "lectura" ? ` [${motivo.metodo}]` : "";
  return `${NOTA_ETAPA_AUTOMATICA}: ${textoDelMotivo(motivo)}${metodo}`;
}

type Destino = "CALIFICADO" | "PROPUESTA" | "NEGOCIACION" | "PERDIDO";

type Entrada = {
  workspaceId: string;
  /** "agent" = línea de WhatsApp de siempre; "official" = API oficial. */
  source: "agent" | "official";
  conversationId: string;
  destino: Destino;
  motivo: MotivoDeEtapaAutomatica;
  /** Tibio: cuándo volver a escribirle. Se guarda aunque la etapa no cambie (un Caliente que dice "lo pienso"). */
  recontactarEl?: Date | null;
  /** Descartado: el motivo de la lista (Contact.lostReason) y la frase exacta del cliente. */
  descarte?: { lostReason: string; frase: string } | null;
  /** Solo mueve un chat vacío ("---", NUEVO): el Interesado que pide precio o fotos. */
  soloSiEstaVacio?: boolean;
};

function leerMetadata(valor: unknown): Record<string, unknown> {
  return valor && typeof valor === "object" && !Array.isArray(valor) ? { ...(valor as Record<string, unknown>) } : {};
}

/** El origen del último cambio de etapa de este lead (ASESORA, MCP, AUTOMATICO, ...), o null si no hay. */
async function ultimoOrigenDeEtapa(workspaceId: string, contactId: string): Promise<string | null> {
  const fila = await prisma.historialEtapa.findFirst({
    where: { workspaceId, contactId },
    orderBy: { creadoEn: "desc" },
    select: { origen: true },
  });
  return fila?.origen ?? null;
}

/**
 * La etapa que le toca. Descartado sale solo de una frase clara del cliente, con su interruptor, y
 * nunca sobre un lead cerrado. Lo demás pasa por el candado del bot (solo sube, nunca cierra).
 */
async function decidirDestino(entrada: Entrada, actual: CrmStage): Promise<CrmStage | null> {
  if (entrada.destino !== "PERDIDO") return decidirEtapaDeAgente(entrada.destino, actual).destino;
  if (entrada.motivo.tipo !== "lectura" || entrada.motivo.metodo !== "frase" || !entrada.descarte) return null;
  if (actual === "GANADO" || actual === "PERDIDO") return null;
  return (await descartePorLecturaPrendido(entrada.workspaceId)) ? "PERDIDO" : null;
}

async function dejarNotaOficial(input: { configId: string; conversationId: string; texto: string }) {
  const ahora = new Date();
  await prisma.$executeRaw`
    INSERT INTO "OfficialApiMessage" (
      "id", "configId", "conversationId", "direction", "type", "status",
      "content", "rawPayload", "createdAt", "updatedAt"
    )
    VALUES (
      ${randomUUID()},
      ${input.configId},
      ${input.conversationId},
      'OUTBOUND'::"OfficialApiMessageDirection",
      'SYSTEM'::"OfficialApiMessageType",
      'SENT'::"OfficialApiMessageStatus",
      ${input.texto},
      ${JSON.stringify({ source: "activity", kind: "stage_changed", origen: "etapa-automatica" })},
      ${ahora},
      ${ahora}
    )
  `;
}

type ChatDelLead = Pick<Entrada, "workspaceId" | "source" | "conversationId">;

/**
 * El lead del chat, o null si no es del embudo: línea administrativa, "fuera del CRM" o sin ficha.
 * Siempre dentro del negocio (workspaceId).
 */
async function leerLead(entrada: ChatDelLead) {
  let contactId: string | null = null;
  let channelId: string | null = null;
  let configId: string | null = null;

  if (entrada.source === "agent") {
    const conversacion = await prisma.conversation.findFirst({
      where: { id: entrada.conversationId, workspaceId: entrada.workspaceId },
      select: { contactId: true, channelId: true, channel: { select: { purpose: true } } },
    });
    if (!conversacion) return null;
    // La línea administrativa no es del embudo de ventas.
    if (conversacion.channel && conversacion.channel.purpose !== "SALES") return null;
    contactId = conversacion.contactId;
    channelId = conversacion.channelId;
  } else {
    const conversacion = await prisma.officialApiConversation.findUnique({
      where: { id: entrada.conversationId },
      select: { configId: true, contact: { select: { crmContactId: true } } },
    });
    contactId = conversacion?.contact?.crmContactId ?? null;
    configId = conversacion?.configId ?? null;
  }
  if (!contactId) return null;

  const contacto = await prisma.contact.findFirst({
    where: { id: contactId, workspaceId: entrada.workspaceId },
    select: { crmStage: true, excludedFromCrm: true, metadata: true },
  });
  if (!contacto || contacto.excludedFromCrm) return null;
  return { contactId, channelId, configId, contacto };
}

/**
 * La etapa del lead si lo que diga el cliente lo puede mover, o null: no es del embudo o está cerrado
 * (Ganado o Perdido). Sirve para no preguntarle a la IA por un chat que igual no se va a tocar. Una etapa
 * puesta a mano no lo impide: la IA solo sube (Frío, Tibio o Caliente) y subir siempre se puede.
 */
export async function etapaQueSePuedeLeer(entrada: ChatDelLead): Promise<CrmStage | null> {
  const lead = await leerLead(entrada);
  if (!lead) return null;
  const actual = lead.contacto.crmStage as CrmStage;
  if (actual === "GANADO" || actual === "PERDIDO") return null;
  return actual;
}

/** Devuelve la etapa a la que quedó el lead, o null si no se movió. Nunca lanza. */
export async function moverEtapaAutomatica(entrada: Entrada): Promise<CrmStage | null> {
  try {
    if (!(await etapaAutomaticaPrendida(entrada.workspaceId))) return null;

    const lead = await leerLead(entrada);
    if (!lead) return null;
    const { contactId, channelId, configId, contacto } = lead;

    const actual = contacto.crmStage as CrmStage;
    const lectura = entrada.motivo.tipo === "lectura";
    // Pedir precio o fotos solo llena un chat vacío: en Tibio, Caliente u otra etapa no cambia nada.
    if (entrada.soloSiEstaVacio && actual && actual !== "NUEVO") return null;

    let destino = await decidirDestino(entrada, actual);
    // Lo que puso una persona nunca baja. Solo se pregunta al historial si no es una subida.
    if (destino && !esSubida(actual, destino)) {
      const origen = await ultimoOrigenDeEtapa(entrada.workspaceId, contactId);
      if (!puedeMoverSobreEtapaManual(actual, destino, origen)) destino = null;
    }
    const metadata = leerMetadata(contacto.metadata);
    if (entrada.recontactarEl) metadata[CLAVE_RECONTACTO] = entrada.recontactarEl.toISOString();

    if (!destino) {
      // No sube (ya estaba igual o más arriba): un Tibio sobre un lead abierto igual deja la fecha.
      if (entrada.recontactarEl && actual !== "GANADO" && actual !== "PERDIDO") {
        await prisma.contact.updateMany({
          where: { id: contactId, workspaceId: entrada.workspaceId, crmStage: actual },
          data: { metadata: metadata as object },
        });
      }
      return null;
    }

    if (destino === "NEGOCIACION") delete metadata[CLAVE_RECONTACTO];
    if (destino === "PERDIDO" && entrada.descarte) {
      metadata[CLAVE_DESCARTE_POR_LECTURA] = { frase: entrada.descarte.frase, en: new Date().toISOString() };
    }

    // Solo si sigue en la etapa leída: si alguien lo movió en el medio, gana la persona.
    const guardado = await prisma.contact.updateMany({
      where: { id: contactId, workspaceId: entrada.workspaceId, crmStage: actual },
      data: {
        crmStage: destino,
        ...(lectura ? { metadata: metadata as object } : {}),
        ...(destino === "PERDIDO" && entrada.descarte ? { lostReason: entrada.descarte.lostReason } : {}),
      },
    });
    if (guardado.count === 0) return null;

    await registrarCambioDeEtapa({
      workspaceId: entrada.workspaceId,
      contactId,
      conversationId: entrada.conversationId,
      etapaAnterior: actual,
      etapaNueva: destino,
      origen: "AUTOMATICO",
      nota: notaDelHistorial(entrada.motivo),
    });

    // Las mismas consecuencias que mover la tarjeta a mano (hoy no hay reglas de seguimiento por etapa).
    // Con lo que dijo el cliente NO: leer un mensaje no puede terminar en un WhatsApp nuevo.
    if (!lectura) {
      await createFollowsFromRulesForSource({
        workspaceId: entrada.workspaceId,
        contactId,
        sourceType: "CRM_STAGE",
        sourceId: destino,
      }).catch(() => {});
    }

    const texto = notaDelChat(destino, entrada.motivo);
    try {
      if (entrada.source === "agent") {
        await recordConversationActivity({
          workspaceId: entrada.workspaceId,
          conversationId: entrada.conversationId,
          channelId,
          contactId,
          kind: "stage_changed",
          text: texto,
        });
      } else if (configId) {
        await dejarNotaOficial({ configId, conversationId: entrada.conversationId, texto });
      }
    } catch (falla) {
      console.info(
        `[etapa-automatica] la etapa cambió pero la nota no quedó en el chat conversationId=${entrada.conversationId} causa=${causaCorta(falla)}`,
      );
    }
    return destino;
  } catch (falla) {
    console.info(`[etapa-automatica] no movió la etapa conversationId=${entrada.conversationId} causa=${causaCorta(falla)}`);
    return null;
  }
}

/** Atajo: se le asignó el chat a una asesora. */
export function etapaAlAsignar(input: {
  workspaceId: string;
  source: "agent" | "official";
  conversationId: string;
  asesora?: string | null;
}): Promise<CrmStage | null> {
  return moverEtapaAutomatica({
    workspaceId: input.workspaceId,
    source: input.source,
    conversationId: input.conversationId,
    destino: "CALIFICADO",
    motivo: { tipo: "asignado", asesora: input.asesora },
  });
}

/** Atajo: pasa a Caliente por una cotización creada o por el panel de envío enviado. */
export function etapaCaliente(input: {
  workspaceId: string;
  source: "agent" | "official";
  conversationId: string;
  motivo: Exclude<MotivoDeEtapaAutomatica, { tipo: "asignado" }>;
}): Promise<CrmStage | null> {
  return moverEtapaAutomatica({
    workspaceId: input.workspaceId,
    source: input.source,
    conversationId: input.conversationId,
    destino: "NEGOCIACION",
    motivo: input.motivo,
  });
}

/* ---------------------------------------------------------------------------------------------- */
/* GANADO DESDE GESTIÓN (parte 2, 3-nov-2026): ver features/crm/services/barrido-de-etapas.ts.     */

/**
 * Interruptor aparte, solo para el Ganado que sale de las ventas pagadas de Gestión:
 * `crm:etapa-automatica:ganado:<negocio>` = `off`. Si no existe, está prendido.
 */
export function claveInterruptorGanadoAutomatico(workspaceId: string): string {
  return `crm:etapa-automatica:ganado:${workspaceId}`;
}

export async function ganadoAutomaticoPrendido(workspaceId: string): Promise<boolean> {
  const fila = await prisma.appSetting.findUnique({
    where: { key: claveInterruptorGanadoAutomatico(workspaceId) },
    select: { value: true },
  });
  return fila?.value?.trim().toLowerCase() !== "off";
}

/** La marca del historial que deja cada Ganado de Gestión: "[gestion] cotización COT-123". */
export function marcaDeGanadoPorGestion(cotizacion: string | null | undefined): string {
  const ref = cotizacion?.trim();
  return ref ? `[gestion] cotización ${ref}` : "[gestion] venta pagada";
}

/**
 * Gestión registró el pago: el lead pasa a Ganado con la fecha del pago (wonAt) y la cotización
 * (wonQuoteRef). Es la ÚNICA subida que pasa por encima de cualquier etapa, también de un Descartado
 * puesto a mano: el pago es un hecho, no una lectura. Si ya está en Ganado no hace nada.
 *
 * Deja la fila del historial (origen AUTOMATICO, nota "[gestion] cotización COT-…") y la nota interna
 * en el chat más reciente del lead. Solo escribe en el CRM: no le avisa nada a Gestión ni al cliente,
 * y no dispara reglas de seguimiento. Devuelve true si lo movió. NUNCA lanza.
 */
export async function marcarGanadoPorGestion(input: {
  workspaceId: string;
  contactId: string;
  cotizacion: string | null;
  fechaPago: Date;
}): Promise<boolean> {
  try {
    const contacto = await prisma.contact.findFirst({
      where: { id: input.contactId, workspaceId: input.workspaceId },
      select: { crmStage: true },
    });
    if (!contacto) return false;
    const actual = contacto.crmStage as CrmStage;
    if (actual === "GANADO") return false;

    const cotizacion = input.cotizacion?.trim() || null;
    // Solo si sigue en la etapa leída: si alguien lo movió en el medio, se intenta en la próxima vuelta.
    const guardado = await prisma.contact.updateMany({
      where: { id: input.contactId, workspaceId: input.workspaceId, crmStage: actual },
      data: { crmStage: "GANADO", wonAt: input.fechaPago, wonQuoteRef: cotizacion, lostReason: null },
    });
    if (guardado.count === 0) return false;

    // El chat más reciente del lead (línea de WhatsApp de siempre o API oficial), para la nota.
    const [chat, oficial] = await Promise.all([
      prisma.conversation.findFirst({
        where: { workspaceId: input.workspaceId, contactId: input.contactId },
        orderBy: [{ lastMessageAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
        select: { id: true, channelId: true, lastMessageAt: true },
      }),
      prisma.officialApiConversation.findFirst({
        where: { contact: { crmContactId: input.contactId, config: { workspaceId: input.workspaceId } } },
        orderBy: [{ lastMessageAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
        select: { id: true, configId: true, lastMessageAt: true },
      }),
    ]);
    const usarOficial =
      Boolean(oficial) && (!chat || (oficial?.lastMessageAt?.getTime() ?? 0) > (chat.lastMessageAt?.getTime() ?? 0));

    await registrarCambioDeEtapa({
      workspaceId: input.workspaceId,
      contactId: input.contactId,
      conversationId: usarOficial ? oficial?.id ?? null : chat?.id ?? null,
      etapaAnterior: actual,
      etapaNueva: "GANADO",
      origen: "AUTOMATICO",
      nota: `${NOTA_ETAPA_AUTOMATICA}: ${marcaDeGanadoPorGestion(cotizacion)}`,
    });

    const texto = `Etapa movida por el sistema: Ganado (Gestión registró el pago${cotizacion ? ` de la cotización ${cotizacion}` : ""})`;
    try {
      if (usarOficial && oficial) {
        await dejarNotaOficial({ configId: oficial.configId, conversationId: oficial.id, texto });
      } else if (chat) {
        await recordConversationActivity({
          workspaceId: input.workspaceId,
          conversationId: chat.id,
          channelId: chat.channelId,
          contactId: input.contactId,
          kind: "stage_changed",
          text: texto,
        });
      }
    } catch (falla) {
      console.info(
        `[etapa-automatica] Ganado de Gestión guardado pero la nota no quedó en el chat contactId=${input.contactId} causa=${causaCorta(falla)}`,
      );
    }
    return true;
  } catch (falla) {
    console.info(`[etapa-automatica] no marcó Ganado por Gestión contactId=${input.contactId} causa=${causaCorta(falla)}`);
    return false;
  }
}
