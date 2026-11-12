// Los mensajes de un seguimiento agendado desde el chat (Alex, 11-nov-2026: "texto + audio, foto").
// Funciones puras, sin imports con alias, para probarlas con Node solo:
//   npm run test:seguimiento-con-adjuntos

export type TipoDeAdjuntoDelChat = "IMAGE" | "VIDEO" | "DOC" | "AUDIO";
export type AdjuntoDelChat = { tipo: TipoDeAdjuntoDelChat; url: string };
export type AccionDelChat = { order: number; messageType: "TEXT" | TipoDeAdjuntoDelChat; content: string; mediaUrl: string };

/**
 * Solo archivos que se subieron a NUESTRO servidor (/uploads/... en uno de nuestros dominios): el
 * seguimiento le manda a WhatsApp esa direccion, y no puede ser una cualquiera que llegue del navegador.
 */
export function esArchivoPropio(url: string, hostsPropios: ReadonlySet<string>): boolean {
  try {
    const direccion = new URL(url);
    return (
      (direccion.protocol === "https:" || direccion.protocol === "http:") &&
      hostsPropios.has(direccion.host.toLowerCase()) &&
      direccion.pathname.startsWith("/uploads/") &&
      !direccion.pathname.includes("..")
    );
  } catch {
    return false;
  }
}

/**
 * Como en WhatsApp: el texto va debajo de la PRIMERA foto, video o PDF; las demas van solas, y los
 * audios al final (una nota de voz no lleva texto). Sin foto, video ni PDF, el texto sale primero
 * como mensaje propio y despues los audios.
 */
export function armarAccionesDelChat(texto: string, adjuntos: readonly AdjuntoDelChat[]): AccionDelChat[] {
  const limpio = texto.trim();
  const visuales = adjuntos.filter((adjunto) => adjunto.tipo !== "AUDIO");
  const audios = adjuntos.filter((adjunto) => adjunto.tipo === "AUDIO");
  const acciones: Array<Omit<AccionDelChat, "order">> = [];
  if (visuales.length) {
    visuales.forEach((adjunto, indice) =>
      acciones.push({ messageType: adjunto.tipo, content: indice === 0 ? limpio : "", mediaUrl: adjunto.url }),
    );
  } else if (limpio) {
    acciones.push({ messageType: "TEXT", content: limpio, mediaUrl: "" });
  }
  for (const audio of audios) acciones.push({ messageType: "AUDIO", content: "", mediaUrl: audio.url });
  return acciones.map((accion, indice) => ({ order: indice + 1, ...accion }));
}
