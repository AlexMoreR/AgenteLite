import { Prisma } from "@prisma/client";

import { sendAndPersistEvolutionFlowStepResilient } from "@/lib/evolution-envio";
import { prisma } from "@/lib/prisma";
import { BOT_PROMETE_ASESORA, claseDelEvento, type EventoDelChat } from "@/lib/turno-de-la-conversacion";

/**
 * AVISO A LA CLIENTA: "te paso con una asesora" (tarjeta 7ya6bh0q, Alex, 12-nov-2026).
 *
 * Caso real (12-nov): la clienta pidió fotos y precio a las 12:08, el reparto le dio el chat a
 * María, el bot mandó las fotos y siguió preguntando color y "para cuándo lo necesitas". La clienta
 * no sabía que la iba a atender una persona, y María escribió a las 12:26.
 *
 * Ahora, cuando el chat pasa a una asesora EN ESTE TURNO, al final de lo que respondió el bot sale
 * una sola vez este texto. No nombra a la asesora: la regla de demora puede cambiarla.
 *
 * Sale solo si se cumple TODO (la decisión es `debeAvisarPasoAAsesora`, sin base):
 *  1. El chat tiene asesora y la línea es de ventas.
 *  2. Es la PRIMERA asignación del chat y pasó en este turno: la primera nota "assigned" del chat
 *     es posterior al último mensaje de la clienta. Una reasignación por demora o un chat
 *     asignado ayer no avisan.
 *  3. El bot ya terminó de responder: el último mensaje (sin notas) es del bot y es posterior al
 *     último de la clienta. En una tanda, solo avisa el paso del mensaje que de verdad contestó.
 *  4. Ninguna persona escribió en el chat (CRM o celular de la asesora).
 *  5. El bot no dijo ya, en esta respuesta, que pasa con una asesora (decisión del dueño: se omite).
 *  6. Nunca se mandó antes: el texto exacto no está en el chat y el candado en AppSetting
 *     (`chats:aviso-paso-asesora:<conversationId>`) se crea ANTES de enviar; la clave es única y
 *     dos pasos a la vez no pueden mandarlo dos veces.
 *
 * Lo que NO hace: no avisa en los chats que asigna el cron de rescate, el reparto de la madrugada
 * ni en las líneas de la API oficial (no hay una respuesta del bot en ese momento). No reintenta si
 * el envío falla: queda la fila FALLIDA de siempre.
 */

export const TEXTO_AVISO_PASO_A_ASESORA = "Te paso con una asesora para que te ayude a separar tu combo. Ya te escribe 🙌";

export const claveAvisoPasoAAsesora = (conversationId: string) => `chats:aviso-paso-asesora:${conversationId}`;

/** Cuántos mensajes (los últimos del chat, con las notas) se leen para el turno y las personas. */
const MENSAJES_A_MIRAR = 80;

/** Un mensaje o nota del chat, como lo lee la decisión. */
export type MensajeDelAviso = EventoDelChat & {
  /** Message.externalId: identifica el mensaje de la clienta que trajo este paso del webhook. */
  externalId?: string | null;
};

export type EntradaDelAviso = {
  /** El chat tiene asesora AHORA. */
  asignada: boolean;
  /** La línea es de ventas (purpose = SALES). */
  lineaDeVentas: boolean;
  /** La primera nota "assigned" del chat (de toda su historia), o null si no hay. */
  primeraAsignacionEn: Date | null;
  /** El texto exacto del aviso ya está en el chat (enviado o fallido). */
  yaSeMando: boolean;
  /** Los últimos mensajes del chat, con las notas, en cualquier orden. */
  mensajes: MensajeDelAviso[];
  /**
   * externalId del mensaje de la clienta que trajo ESTE paso. Si llega y no es el último de la
   * clienta, otro paso de la tanda es el que contestó. Sin dato no se mira.
   */
  externalIdDeEstePaso?: string | null;
};

export type MotivoDelAviso =
  | "avisar"
  | "sin_asesora"
  | "no_es_ventas"
  | "sin_nota_de_asignacion"
  | "asignado_antes"
  | "ya_avisado"
  | "cliente_no_ha_escrito"
  | "bot_no_ha_respondido"
  | "otro_paso_de_la_tanda"
  | "escribio_una_persona"
  | "bot_ya_dijo_asesora";

export type DecisionDelAviso = { avisar: boolean; motivo: MotivoDelAviso };

const no = (motivo: MotivoDelAviso): DecisionDelAviso => ({ avisar: false, motivo });

/** ¿Se le avisa a la clienta, ahora, que la atiende una asesora? Código puro, sin base. */
export function debeAvisarPasoAAsesora(entrada: EntradaDelAviso): DecisionDelAviso {
  if (!entrada.asignada) return no("sin_asesora");
  if (!entrada.lineaDeVentas) return no("no_es_ventas");
  if (entrada.yaSeMando) return no("ya_avisado");

  const orden = [...entrada.mensajes].sort((a, b) => a.en.getTime() - b.en.getTime());
  const clases = orden.map(claseDelEvento);

  // 4. Una persona ya escribió (o habló por llamada): no hace falta presentarla.
  if (clases.some((clase) => clase === "humano" || clase === "llamada_atendida")) return no("escribio_una_persona");

  let iCliente = -1;
  for (let i = orden.length - 1; i >= 0; i -= 1) {
    if (clases[i] === "cliente") {
      iCliente = i;
      break;
    }
  }
  if (iCliente < 0) return no("cliente_no_ha_escrito");
  const ultimoCliente = orden[iCliente];

  // 2. La PRIMERA asignación del chat tiene que ser de este turno.
  if (!entrada.primeraAsignacionEn) return no("sin_nota_de_asignacion");
  if (entrada.primeraAsignacionEn.getTime() < ultimoCliente.en.getTime()) return no("asignado_antes");

  // 3. Solo el paso del mensaje que contestó la tanda.
  if (entrada.externalIdDeEstePaso && ultimoCliente.externalId && ultimoCliente.externalId !== entrada.externalIdDeEstePaso) {
    return no("otro_paso_de_la_tanda");
  }

  // 3. El último mensaje (sin notas) es del bot y es posterior al de la clienta.
  let iUltimo = -1;
  for (let i = orden.length - 1; i >= 0; i -= 1) {
    if (clases[i] !== "nota") {
      iUltimo = i;
      break;
    }
  }
  if (iUltimo <= iCliente || clases[iUltimo] !== "bot") return no("bot_no_ha_respondido");

  // 5. El bot ya dijo en esta respuesta que pasa con una asesora: no repetirlo.
  const respuestaDelBot = orden.slice(iCliente + 1).filter((_, k) => clases[iCliente + 1 + k] === "bot");
  if (respuestaDelBot.some((m) => BOT_PROMETE_ASESORA.test(m.texto ?? ""))) return no("bot_ya_dijo_asesora");

  return { avisar: true, motivo: "avisar" };
}

function origenDe(rawPayload: Prisma.JsonValue | null): string | null {
  if (!rawPayload || typeof rawPayload !== "object" || Array.isArray(rawPayload)) return null;
  const source = (rawPayload as Record<string, unknown>).source;
  return typeof source === "string" ? source : null;
}

/**
 * Lee el chat, decide y, si toca, pone el candado y manda el aviso. Corre en el `after()` del
 * reparto del webhook de Evolution, después de `repartirSiElTurnoLoAmerita`. Nunca lanza por el
 * envío (la función de envío deja la fila FALLIDA); sí puede lanzar si la base falla: el que la
 * llama la envuelve en su propio try/catch.
 */
export async function avisarPasoAAsesoraSiToca(input: {
  conversationId: string;
  channelId: string;
  workspaceId: string;
  contactId: string;
  agentId?: string;
  instanceName: string;
  phoneNumber: string;
  externalIdDeEstePaso?: string | null;
}): Promise<DecisionDelAviso> {
  const [conversacion, canal] = await Promise.all([
    prisma.conversation.findUnique({ where: { id: input.conversationId }, select: { assignedToUserId: true } }),
    prisma.whatsAppChannel.findUnique({ where: { id: input.channelId }, select: { purpose: true } }),
  ]);
  const asignada = Boolean(conversacion?.assignedToUserId);
  const lineaDeVentas = canal?.purpose === "SALES";
  // Lo de siempre primero, sin más consultas: casi todos los pasos terminan aquí.
  if (!asignada || !lineaDeVentas) {
    return debeAvisarPasoAAsesora({ asignada, lineaDeVentas, primeraAsignacionEn: null, yaSeMando: false, mensajes: [] });
  }

  const [primeraNota, yaEnElChat, filas] = await Promise.all([
    prisma.message.findFirst({
      where: { conversationId: input.conversationId, type: "SYSTEM", rawPayload: { path: ["kind"], equals: "assigned" } },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),
    prisma.message.findFirst({
      where: { conversationId: input.conversationId, content: TEXTO_AVISO_PASO_A_ASESORA },
      select: { id: true },
    }),
    prisma.message.findMany({
      where: { conversationId: input.conversationId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: MENSAJES_A_MIRAR,
      select: { direction: true, type: true, content: true, createdAt: true, rawPayload: true, externalId: true },
    }),
  ]);

  const decision = debeAvisarPasoAAsesora({
    asignada,
    lineaDeVentas,
    primeraAsignacionEn: primeraNota?.createdAt ?? null,
    yaSeMando: Boolean(yaEnElChat),
    externalIdDeEstePaso: input.externalIdDeEstePaso ?? null,
    mensajes: filas.map((fila) => ({
      direccion: fila.direction === "INBOUND" ? "IN" : "OUT",
      tipo: fila.type,
      origen: origenDe(fila.rawPayload),
      texto: fila.content,
      en: fila.createdAt,
      externalId: fila.externalId,
    })),
  });
  if (!decision.avisar) return decision;

  // El candado ANTES de enviar: si otro paso ya lo puso, este no manda nada.
  try {
    await prisma.appSetting.create({
      data: { key: claveAvisoPasoAAsesora(input.conversationId), value: new Date().toISOString() },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return no("ya_avisado");
    }
    throw error;
  }

  const enviado = await sendAndPersistEvolutionFlowStepResilient({
    step: { kind: "text", content: TEXTO_AVISO_PASO_A_ASESORA },
    workspaceId: input.workspaceId,
    conversationId: input.conversationId,
    channelId: input.channelId,
    contactId: input.contactId,
    agentId: input.agentId,
    instanceName: input.instanceName,
    phoneNumber: input.phoneNumber,
  });
  console.log("[reparto-aviso-a-la-clienta] aviso", { conversationId: input.conversationId, enviado });
  return decision;
}
