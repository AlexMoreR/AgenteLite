import { getMediaPreviewLabel } from "./chat-inbox-format";
import { getDocumentMetaFromMessage } from "./chat-inbox-media";
import type { SharedInboxMessageItem } from "./chat-inbox-types";

/*
  Copiar el texto de un mensaje (Chats: "Copiar" como en WhatsApp, parte 1).

  Una foto, un video o un documento NO tienen un campo `caption` aparte: el texto que los acompaña
  se guarda en `content`, el mismo de un mensaje de texto. Cuando no hay texto, `content` trae otra
  cosa que no sirve pegar en ningun lado:
  - la etiqueta del tipo ("Foto", "Video", "Sticker", "Documento", "Audio");
  - en un documento, el nombre del archivo;
  - en un archivo que no se pudo bajar, el aviso que escribe el webhook.
  En esos casos no hay nada que copiar: la burbuja tampoco dibuja ese texto debajo del archivo.
*/

/** Lo que se copia de un mensaje, o null si no tiene texto de verdad. */
export function textoParaCopiar(message: SharedInboxMessageItem): string | null {
  if (message.deletedAt) {
    return null;
  }
  // Una nota de voz o un sticker no llevan texto en WhatsApp.
  if (message.type === "AUDIO" || message.type === "STICKER") {
    return null;
  }

  const texto = (message.content ?? "").trim();
  if (!texto) {
    return null;
  }
  if (texto === getMediaPreviewLabel(message.type)) {
    return null;
  }
  if (message.type === "DOCUMENT" && texto === getDocumentMetaFromMessage(message).fileName) {
    return null;
  }
  // "⚠️ Te mando una foto, pero no se pudo descargar..." (lib/waha.ts): es nuestro, no de la clienta.
  if (message.direction === "INBOUND" && texto.startsWith("⚠️") && texto.includes("no se pudo descargar")) {
    return null;
  }
  return texto;
}

/** El texto de varios mensajes, uno por linea, saltando los que no tienen texto. */
export function textoDeVariosParaCopiar(mensajes: SharedInboxMessageItem[]): string | null {
  const texto = mensajes
    .map(textoParaCopiar)
    .filter((linea): linea is string => Boolean(linea))
    .join("\n");
  return texto || null;
}

/*
  La forma antigua de copiar: un cuadro de texto oculto, seleccionado, y `execCommand('copy')`.

  - Letra de 16px: con menos, el iPhone acerca la pantalla al enfocar el cuadro.
  - `setSelectionRange`: en iPhone `select()` solo no marca el texto.
  - Va dentro de la hoja abierta si la hay: la hoja atrapa el foco y un cuadro fuera de ella no se
    deja enfocar, asi que no copiaria nada.
*/
function copiarConRespaldo(texto: string): boolean {
  if (typeof document === "undefined" || !document.body) {
    return false;
  }
  const activo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const contenedor = activo?.closest<HTMLElement>('[role="dialog"]') ?? document.body;

  const cuadro = document.createElement("textarea");
  cuadro.value = texto;
  cuadro.setAttribute("readonly", "");
  cuadro.setAttribute("aria-hidden", "true");
  cuadro.style.position = "fixed";
  cuadro.style.top = "0";
  cuadro.style.left = "0";
  cuadro.style.width = "1px";
  cuadro.style.height = "1px";
  cuadro.style.padding = "0";
  cuadro.style.border = "0";
  cuadro.style.opacity = "0";
  cuadro.style.fontSize = "16px";
  contenedor.appendChild(cuadro);

  let copiado = false;
  try {
    cuadro.focus({ preventScroll: true });
    cuadro.select();
    cuadro.setSelectionRange(0, texto.length);
    copiado = document.execCommand("copy");
  } catch {
    copiado = false;
  } finally {
    contenedor.removeChild(cuadro);
    activo?.focus({ preventScroll: true });
  }
  return copiado;
}

/**
 * Copia el texto al portapapeles.
 *
 * `navigator.clipboard.writeText` se llama DE INMEDIATO, sin ningun `await` antes: Safari solo deja
 * copiar dentro del mismo toque, y cualquier espera en el medio hace que lo rechace. Si no existe
 * o falla, se usa la forma antigua.
 *
 * Devuelve true/false si se resolvio al momento, o una promesa cuando paso por el portapapeles.
 */
export function copiarAlPortapapeles(texto: string): boolean | Promise<boolean> {
  const portapapeles = typeof navigator !== "undefined" ? navigator.clipboard : undefined;
  if (!portapapeles?.writeText) {
    return copiarConRespaldo(texto);
  }
  let escritura: Promise<void>;
  try {
    escritura = portapapeles.writeText(texto);
  } catch {
    return copiarConRespaldo(texto);
  }
  return escritura.then(
    () => true,
    () => copiarConRespaldo(texto),
  );
}
