import { prisma } from "@/lib/prisma";
import { ORIGENES_AUTOMATICOS } from "@/lib/freno-de-automaticos";
import { getDocumentMetaFromMessage } from "@/components/chats/chat-inbox-media";

import {
  decidirCompuerta,
  DIAS_SIN_REPETIR,
  productoVigenteDelChat,
  type FrenoDeCompuerta,
  type MensajeParaElProducto,
  type ProductoVigente,
} from "../dominio/compuerta-de-envio";

/**
 * Lo que la revisión final de un seguimiento automático lee de la base (la regla está en
 * dominio/compuerta-de-envio.ts). La usan el reloj del V3 y el motor de Follow, justo antes de enviar.
 * Nunca lanza: si no se puede leer, el seguimiento sigue como antes.
 */

/** Mensajes del chat que se miran para saber de qué producto va (los más nuevos). */
const MENSAJES_PARA_EL_PRODUCTO = 80;
/** Seguimientos automáticos de los últimos 7 días que se comparan. */
const AUTOMATICOS_A_COMPARAR = 100;

/** El nombre del archivo de un documento, como lo muestra la bandeja. null si no se sabe. */
export function nombreDeArchivo(mensaje: { type: string; rawPayload: unknown }): string | null {
  if (mensaje.type !== "DOCUMENT") return null;
  const nombre = getDocumentMetaFromMessage({ rawPayload: mensaje.rawPayload } as Parameters<
    typeof getDocumentMetaFromMessage
  >[0]).fileName;
  return nombre && nombre !== "Documento" ? nombre : null;
}

/** De qué producto va el chat (ver `productoVigenteDelChat`). null si no hay señal o no se pudo leer. */
export async function leerProductoVigente(conversationId: string): Promise<ProductoVigente | null> {
  try {
    const filas = await prisma.message.findMany({
      where: { conversationId, type: { not: "SYSTEM" }, deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: MENSAJES_PARA_EL_PRODUCTO,
      select: { direction: true, type: true, content: true, transcripcion: true, rawPayload: true, createdAt: true },
    });
    const mensajes: MensajeParaElProducto[] = filas.map((fila) => ({
      direccion: fila.direction === "INBOUND" ? "IN" : "OUT",
      tipo: fila.type,
      texto: fila.type === "AUDIO" ? fila.transcripcion?.trim() || null : fila.content,
      nombreDeArchivo: nombreDeArchivo(fila),
      en: fila.createdAt,
    }));
    return productoVigenteDelChat(mensajes);
  } catch (error) {
    console.error("[seguimientos] no se pudo leer el producto del chat", {
      conversationId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * La revisión final: null = puede salir. Si frena, devuelve el motivo (`texto_repetido` u `otro_producto`)
 * para cancelarlo y anotarlo. Se llama con los textos ya listos (después del redactor).
 */
export async function revisarCompuertaDeEnvio(input: {
  conversationId: string | null;
  textos: string[];
  ahora?: Date;
}): Promise<FrenoDeCompuerta | null> {
  if (!input.conversationId) return null;
  try {
    const ahora = input.ahora ?? new Date();
    const [previos, producto] = await Promise.all([
      prisma.message.findMany({
        where: {
          conversationId: input.conversationId,
          direction: "OUTBOUND",
          deletedAt: null,
          createdAt: { gte: new Date(ahora.getTime() - DIAS_SIN_REPETIR * 24 * 3_600_000) },
          OR: ORIGENES_AUTOMATICOS.map((source) => ({ rawPayload: { path: ["source"], equals: source } })),
        },
        orderBy: { createdAt: "desc" },
        take: AUTOMATICOS_A_COMPARAR,
        select: { content: true },
      }),
      leerProductoVigente(input.conversationId),
    ]);
    return decidirCompuerta({ textos: input.textos, previosAutomaticos: previos.map((fila) => fila.content), producto });
  } catch (error) {
    console.error("[seguimientos] fallo la revision final; sale como antes", {
      conversationId: input.conversationId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
