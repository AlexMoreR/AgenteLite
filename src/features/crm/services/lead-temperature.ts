import { prisma } from "@/lib/prisma";
import { recordConversationActivity } from "@/lib/conversation-activity";
import {
  DIAS_DESDE_SU_ULTIMO_MENSAJE,
  INTENTOS_SIN_RESPUESTA,
  contactosQueBajan,
} from "@/features/crm/services/bajada-por-inactividad";

/**
 * TEMPERATURA DEL LEAD: el reloj enfria, el cliente recalienta.
 *
 * Las columnas del CRM se llaman Frio/Tibio/Caliente pero hasta ahora solo se movian por lo que
 * se HABLO (el puente del bot) o porque alguien arrastraba la tarjeta. Nadie miraba el tiempo, y
 * el resultado medido el 12-ago-2026 es un tablero que miente: 732 leads en Nuevo, 481 de ellos
 * sin tocarse hace mas de 7 dias, y 43 descartados en toda la historia.
 *
 * Ahora que el avance de la venta vive aparte (Conversation.funnelStage, ver funnel-stage-sync),
 * enfriar una tarjeta ya NO borra hasta donde llego la venta: un lead puede quedar "Frio" y seguir
 * marcado en "Cierre", que es justo el lead mas caro del negocio.
 *
 * Dos candados que pidio Alex:
 *  - CALIENTE no se toca. Si una asesora lo marco asi (p.ej. hablo por telefono), el reloj no le
 *    pisa la decision. Solo se enfria lo que esta en Tibio.
 *  - Enfriar es REVERSIBLE, y por eso se puede automatizar: apenas el cliente escribe, el lead
 *    vuelve a la etapa que tenia. Descartar, que no se puede deshacer, lo sigue decidiendo una
 *    persona.
 */

/*
  CUANDO se enfria lo decide la regla del Playbook (ver bajada-por-inactividad.ts): 3 intentos
  nuestros sin respuesta, 5 dias desde su ultimo mensaje y cero respuesta, y nunca con cotizacion.

  Hasta el 03-10-2026 aca habia otra regla: "2 dias sin que el cliente escriba". No miraba lo que
  le escribiamos nosotros, y bajo a Frio a una clienta con cotizacion formal cuatro minutos despues
  de que la asesora le escribiera.
*/
const MOTIVO_DEL_PLAYBOOK = `${INTENTOS_SIN_RESPUESTA} intentos nuestros sin respuesta y ${DIAS_DESDE_SU_ULTIMO_MENSAJE} días sin escribir.`;

type MetadataDeContacto = Record<string, unknown>;

function leerMetadata(valor: unknown): MetadataDeContacto {
  return valor && typeof valor === "object" && !Array.isArray(valor)
    ? (valor as MetadataDeContacto)
    : {};
}

async function anotarEnElChat(input: {
  workspaceId: string;
  contactId: string;
  texto: string;
}) {
  const conversation = await prisma.conversation.findFirst({
    where: { contactId: input.contactId, workspaceId: input.workspaceId },
    orderBy: { lastMessageAt: "desc" },
    select: { id: true, channelId: true },
  });
  if (!conversation) {
    return;
  }
  await recordConversationActivity({
    workspaceId: input.workspaceId,
    conversationId: conversation.id,
    channelId: conversation.channelId,
    contactId: input.contactId,
    kind: "stage_changed",
    text: input.texto,
  }).catch(() => {});
}

/**
 * Enfria UN lead: de Tibio a Frio, dejando la marca que permite devolverlo.
 *
 * Sale del barrido de abajo para poder usarse suelto. Lo usan dos: el reloj de los 2 dias, y el
 * ultimo seguimiento inteligente del Agente V3 (a los 3 dias, cuando deja de insistir).
 *
 * Solo enfria lo que esta en Tibio, a proposito. Caliente no se toca -si una asesora lo marco asi
 * el reloj no le pisa la decision- y GANADO/PERDIDO tampoco: cerrar es decision humana.
 */
export async function enfriarUnLead(input: {
  workspaceId: string;
  contactId: string;
  /** Lo que queda escrito en el chat. Ej: "2 días sin respuesta del cliente." */
  motivo: string;
}): Promise<boolean> {
  try {
    const contacto = await prisma.contact.findFirst({
      where: { id: input.contactId, workspaceId: input.workspaceId },
      select: { metadata: true },
    });
    if (!contacto) {
      return false;
    }

    // Con WHERE de la etapa por si otro proceso ya la movio: correr esto dos veces no hace daño.
    const movidos = await prisma.$executeRaw`
      UPDATE "Contact"
      SET "crmStage" = 'CALIFICADO', "updatedAt" = NOW()
      WHERE "id" = ${input.contactId} AND "crmStage" = 'PROPUESTA'
    `;
    if (movidos === 0) {
      return false;
    }

    // La marca es lo que hace reversible el enfriamiento: sin ella no se sabria a donde
    // devolver el lead cuando conteste, ni se podria distinguir de un lead que siempre estuvo
    // en Frio porque el bot lo dejo ahi.
    await prisma.contact.update({
      where: { id: input.contactId },
      data: {
        metadata: {
          ...leerMetadata(contacto.metadata),
          enfriadoEl: new Date().toISOString(),
          enfriadoDesde: "PROPUESTA",
        } as object,
      },
    });

    await anotarEnElChat({
      workspaceId: input.workspaceId,
      contactId: input.contactId,
      texto: `Se enfrió a Frío: ${input.motivo}`,
    });
    return true;
  } catch (error) {
    console.error("[lead-temperature] error enfriando", input.contactId, error);
    return false;
  }
}

/**
 * Baja a Frio los leads en Tibio que cumplen la regla del Playbook (ver bajada-por-inactividad.ts).
 *
 * NO dispara seguimientos, a proposito: la primera corrida mueve cientos de leads de una y eso
 * seria una rafaga de WhatsApp a gente que lleva semanas callada. Los seguimientos por etapa se
 * arman aparte y con intencion.
 */
export async function enfriarLeadsSinRespuesta(): Promise<{ enfriados: number }> {
  let candidatos: Array<{ id: string; workspaceId: string }> = [];
  try {
    candidatos = await contactosQueBajan("PROPUESTA");
  } catch (error) {
    console.error("[lead-temperature] error buscando candidatos", error);
    return { enfriados: 0 };
  }

  let enfriados = 0;
  for (const candidato of candidatos) {
    const movido = await enfriarUnLead({
      workspaceId: candidato.workspaceId,
      contactId: candidato.id,
      motivo: MOTIVO_DEL_PLAYBOOK,
    });
    if (movido) {
      enfriados += 1;
    }
  }

  if (enfriados > 0) {
    console.log("[lead-temperature] enfriados", { cantidad: enfriados });
  }

  return { enfriados };
}

/**
 * Devuelve el lead a la etapa que tenia antes de enfriarse, porque volvio a escribir.
 *
 * Corre en CADA mensaje entrante y NO dentro del bloque del agente: cuando una asesora toma el
 * chat la IA queda en pausa y ese bloque nunca se ejecuta. Son 280 de las conversaciones sin
 * etapa medidas el 12-ago-2026; si el recalentamiento colgara del agente, justo los chats que
 * atiende una persona nunca volverian a Tibio.
 *
 * Solo toca leads que enfrio el reloj (los que tienen la marca). Un lead que siempre estuvo en
 * Frio se queda donde esta: subirlo a Tibio sin que haya propuesta seria inventar avance.
 */
export async function recalentarLeadSiRespondio(input: {
  workspaceId: string;
  contactId: string;
}): Promise<boolean> {
  try {
    const contacto = await prisma.contact.findFirst({
      where: { id: input.contactId, workspaceId: input.workspaceId },
      select: { crmStage: true, metadata: true },
    });
    if (!contacto) {
      return false;
    }

    const metadata = leerMetadata(contacto.metadata);
    if (!metadata.enfriadoEl) {
      return false;
    }

    /*
      A donde vuelve y desde donde. Dos relojes bajan: Tibio -> Frio (este) y Caliente -> Tibio
      (lead-cooldown.ts). Los dos dejan la marca, y el que contesta vuelve a la etapa que tenia.

      La marca sobrevive al recalentamiento manual (una asesora pudo mover la tarjeta antes que el
      cliente contestara): si ya no esta donde lo dejo el reloj, se limpia y no se toca la etapa.
    */
    const destino =
      metadata.enfriadoDesde === "PROPUESTA" ? "PROPUESTA" : metadata.enfriadoDesde === "NEGOCIACION" ? "NEGOCIACION" : null;
    const dondeLoDejo = destino === "NEGOCIACION" ? "PROPUESTA" : "CALIFICADO";
    const seguiaEnFrio = contacto.crmStage === dondeLoDejo;

    const { enfriadoEl: _enfriadoEl, enfriadoDesde: _enfriadoDesde, ...metadataLimpia } = metadata;
    await prisma.contact.update({
      where: { id: input.contactId },
      data: { metadata: metadataLimpia as object },
    });

    if (!seguiaEnFrio || !destino) {
      return false;
    }

    const movidos = await prisma.$executeRaw`
      UPDATE "Contact"
      SET "crmStage" = ${destino}::"CrmStage", "updatedAt" = NOW()
      WHERE "id" = ${input.contactId} AND "crmStage" = ${dondeLoDejo}::"CrmStage"
    `;
    if (movidos === 0) {
      return false;
    }

    await anotarEnElChat({
      workspaceId: input.workspaceId,
      contactId: input.contactId,
      texto: destino === "NEGOCIACION" ? "Volvió a Caliente: el cliente respondió." : "Volvió a Tibio: el cliente respondió.",
    });
    return true;
  } catch (error) {
    console.error("[lead-temperature] error recalentando", input.contactId, error);
    return false;
  }
}
