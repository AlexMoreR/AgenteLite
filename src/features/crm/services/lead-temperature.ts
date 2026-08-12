import { prisma } from "@/lib/prisma";
import { recordConversationActivity } from "@/lib/conversation-activity";

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

// Dias corridos sin que el cliente conteste antes de enfriar. Corridos y no habiles a pedido de
// Alex; lo programable quedo anotado como idea aparte.
const DIAS_SIN_RESPUESTA = 2;

// Tope por corrida. La primera vez hay muchos leads viejos que cumplen la condicion; se enfrian
// de a tandas para que el tablero no cambie de golpe delante de las asesoras.
const TOPE_POR_CORRIDA = 200;

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
 * Baja a Frio los leads que estan en Tibio y llevan DIAS_SIN_RESPUESTA sin escribir.
 *
 * NO dispara seguimientos, a proposito: la primera corrida mueve cientos de leads de una y eso
 * seria una rafaga de WhatsApp a gente que lleva semanas callada. Los seguimientos por etapa se
 * arman aparte y con intencion.
 */
export async function enfriarLeadsSinRespuesta(): Promise<{ enfriados: number }> {
  let candidatos: Array<{ id: string; workspaceId: string; metadata: unknown }> = [];
  try {
    candidatos = await prisma.$queryRaw<Array<{ id: string; workspaceId: string; metadata: unknown }>>`
      SELECT c."id" AS "id", c."workspaceId" AS "workspaceId", c."metadata" AS "metadata"
      FROM "Contact" c
      WHERE c."crmStage" = 'PROPUESTA'
        AND c."excludedFromCrm" = false
        AND NOT EXISTS (
          SELECT 1 FROM "Message" m
          WHERE m."contactId" = c."id"
            AND m."direction" = 'INBOUND'
            AND m."isStatusBroadcast" = false
            AND m."createdAt" >= NOW() - (${DIAS_SIN_RESPUESTA} || ' days')::interval
        )
      LIMIT ${TOPE_POR_CORRIDA}
    `;
  } catch (error) {
    console.error("[lead-temperature] error buscando candidatos", error);
    return { enfriados: 0 };
  }

  let enfriados = 0;
  for (const candidato of candidatos) {
    try {
      // Con WHERE de la etapa por si otro proceso ya la movio: correr esto dos veces no hace daño.
      const movidos = await prisma.$executeRaw`
        UPDATE "Contact"
        SET "crmStage" = 'CALIFICADO', "updatedAt" = NOW()
        WHERE "id" = ${candidato.id} AND "crmStage" = 'PROPUESTA'
      `;
      if (movidos === 0) {
        continue;
      }

      // La marca es lo que hace reversible el enfriamiento: sin ella no se sabria a donde
      // devolver el lead cuando conteste, ni se podria distinguir de un lead que siempre estuvo
      // en Frio porque el bot lo dejo ahi.
      await prisma.contact.update({
        where: { id: candidato.id },
        data: {
          metadata: {
            ...leerMetadata(candidato.metadata),
            enfriadoEl: new Date().toISOString(),
            enfriadoDesde: "PROPUESTA",
          } as object,
        },
      });

      enfriados += 1;
      await anotarEnElChat({
        workspaceId: candidato.workspaceId,
        contactId: candidato.id,
        texto: `Se enfrió a Frío: ${DIAS_SIN_RESPUESTA} días sin respuesta del cliente.`,
      });
    } catch (error) {
      console.error("[lead-temperature] error enfriando", candidato.id, error);
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

    // La marca sobrevive al recalentamiento manual (una asesora pudo mover la tarjeta antes que
    // el cliente contestara): si ya no esta en Frio, se limpia y no se toca la etapa.
    const seguiaEnFrio = contacto.crmStage === "CALIFICADO";
    const destino = metadata.enfriadoDesde === "PROPUESTA" ? "PROPUESTA" : null;

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
      SET "crmStage" = 'PROPUESTA', "updatedAt" = NOW()
      WHERE "id" = ${input.contactId} AND "crmStage" = 'CALIFICADO'
    `;
    if (movidos === 0) {
      return false;
    }

    await anotarEnElChat({
      workspaceId: input.workspaceId,
      contactId: input.contactId,
      texto: "Volvió a Tibio: el cliente respondió.",
    });
    return true;
  } catch (error) {
    console.error("[lead-temperature] error recalentando", input.contactId, error);
    return false;
  }
}
