import { leerEstado } from "@/features/agente-v3/motor/estado";
import { prisma } from "@/lib/prisma";

import {
  clienteRespondioLaBienvenida,
  esDelDiaSiguiente,
  textoSinRespuesta,
} from "../dominio/sin-respuesta-a-la-bienvenida";
import type { SeguimientoRedactado } from "./seguimiento-que-escucha";

/**
 * Lee el chat y dice si el cliente ya respondió nuestra bienvenida (regla en
 * dominio/sin-respuesta-a-la-bienvenida.ts). La usa el reloj de los seguimientos del V3: con `false`,
 * el seguimiento sale con el texto de la regla del libro tal cual, sin IA.
 *
 * Devuelve `null` si el chat no existe o si falla la lectura: `null` significa seguir como antes (con
 * la IA). Nunca lanza.
 *
 * Lee TODOS los mensajes del chat (solo 3 campos), sin tope: con un `take` de los más nuevos se
 * perdería el primer mensaje nuestro.
 */
export async function elClienteRespondioLaBienvenida(input: {
  workspaceId: string;
  conversationId: string;
}): Promise<boolean | null> {
  try {
    const charla = await prisma.conversation.findFirst({
      where: { id: input.conversationId, workspaceId: input.workspaceId },
      select: {
        messages: {
          where: { deletedAt: null },
          orderBy: { createdAt: "asc" },
          select: { direction: true, type: true, createdAt: true },
        },
      },
    });
    if (!charla) return null;
    return clienteRespondioLaBienvenida(charla.messages);
  } catch (error) {
    console.warn("[seguimientos] no se pudo leer si el cliente respondió la bienvenida; se sigue como antes", {
      conversationId: input.conversationId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Seguimientos automáticos del motor (Follow) cuando el cliente NO respondió la bienvenida: salen sin
 * IA. En el día siguiente del Combo Camillas sale el texto fijo del combo; en todo lo demás, el texto
 * agendado tal cual. Un flujo nunca recibe el texto del combo.
 *
 * Devuelve `null` si el cliente ya respondió, si el chat no existe o si falla la lectura: `null`
 * significa seguir con el redactor como siempre. Nunca lanza.
 *
 * No lee `OPENAI_API_KEY` ni el interruptor de los seguimientos que escuchan: el texto del combo sale
 * igual sin clave y con el interruptor apagado.
 */
export async function resolverSinRespuesta(input: {
  workspaceId: string;
  conversationId: string;
  follow: { name: string | null; timeType: string; timeValue: number };
  textoFijo: string;
  /** De dónde viene ("follow" o "flujo"). */
  origen: string;
}): Promise<SeguimientoRedactado | null> {
  let activeProductContext: unknown;
  try {
    const charla = await prisma.conversation.findFirst({
      where: { id: input.conversationId, workspaceId: input.workspaceId },
      select: {
        activeProductContext: true,
        messages: {
          where: { deletedAt: null },
          orderBy: { createdAt: "asc" },
          select: { direction: true, type: true, createdAt: true },
        },
      },
    });
    if (!charla || clienteRespondioLaBienvenida(charla.messages)) return null;
    activeProductContext = charla.activeProductContext;
  } catch (error) {
    console.warn("[seguimientos] no se pudo leer si el cliente respondió la bienvenida; sigue el redactor", {
      conversationId: input.conversationId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }

  const esFlujo = input.origen === "flujo";
  const delDiaSiguiente = esDelDiaSiguiente(input.follow);
  // El producto solo importa para el día siguiente (y nunca en un flujo).
  const productoId = !esFlujo && delDiaSiguiente ? await productoDelChat(input.conversationId, activeProductContext) : null;
  const { texto, esElDelCombo } = textoSinRespuesta({ productoId, delDiaSiguiente, esFlujo, textoFijo: input.textoFijo });
  if (esElDelCombo) {
    return {
      enviar: true,
      texto,
      deIA: false,
      textoReemplazado: input.textoFijo,
      motivo: "el cliente no respondió la bienvenida: sale el texto del Combo Camillas del día siguiente, sin IA",
    };
  }
  return {
    enviar: true,
    texto,
    deIA: false,
    textoReemplazado: null,
    motivo: "el cliente no respondió la bienvenida: sale el texto agendado, sin IA",
  };
}

/**
 * El texto del combo sale UNA sola vez por Follow: si ya salió (otra acción de texto del mismo Follow),
 * esta sale con su texto agendado, sin IA. Devuelve lo que sale y si el combo ya tuvo su turno.
 */
export function sinRepetirElCombo(
  redactado: SeguimientoRedactado,
  comboYaSalio: boolean,
  textoFijo: string,
): { redactado: SeguimientoRedactado; comboYaSalio: boolean } {
  const esElDelCombo = redactado.enviar && redactado.textoReemplazado !== null;
  if (!esElDelCombo) return { redactado, comboYaSalio };
  if (comboYaSalio) {
    return {
      redactado: {
        enviar: true,
        texto: textoFijo,
        deIA: false,
        textoReemplazado: null,
        motivo: "el cliente no respondió la bienvenida: el texto del combo ya salió en este seguimiento; sale el agendado, sin IA",
      },
      comboYaSalio,
    };
  }
  return { redactado, comboYaSalio: true };
}

/** El producto del chat: el del V3 y, si no tiene, el `activeProductContext.productId` del chat. */
async function productoDelChat(conversationId: string, activeProductContext: unknown): Promise<string | null> {
  try {
    const estado = await leerEstado(conversationId);
    if (estado.productoActivo) return estado.productoActivo;
  } catch (error) {
    console.warn("[seguimientos] no se pudo leer el producto del V3; se usa el del chat", {
      conversationId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  if (activeProductContext && typeof activeProductContext === "object" && !Array.isArray(activeProductContext)) {
    const productId = (activeProductContext as Record<string, unknown>).productId;
    if (typeof productId === "string" && productId.trim()) return productId.trim();
  }
  return null;
}
