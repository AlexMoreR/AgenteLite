import { getMediaPreviewLabel } from "./chat-inbox-format";
import { getDocumentMetaFromMessage } from "./chat-inbox-media";
import type { SharedInboxMessageItem } from "./chat-inbox-types";

/*
  Copiar el texto de un mensaje del chat.

  El texto que acompaña una foto, un video o un documento NO vive en un campo aparte: va en
  `content`, el mismo de los mensajes de texto. Pero cuando no hay texto, `content` trae otra
  cosa que no sirve pegar: la etiqueta del tipo ("Foto", "Documento"...), el nombre del archivo
  en un documento o el aviso de que el archivo no se pudo descargar. La burbuja usa esa misma
  regla para decidir si dibuja el texto debajo de la foto.
*/
export function textoParaCopiar(message: SharedInboxMessageItem): string | null {
  if (message.deletedAt) return null;
  if (message.type === "AUDIO" || message.type === "STICKER") return null;

  const texto = (message.content ?? "").trim();
  if (!texto) return null;
  if (texto.includes("no se pudo descargar")) return null;
  if (texto === getMediaPreviewLabel(message.type)) return null;
  if (message.type === "DOCUMENT" && texto === getDocumentMetaFromMessage(message).fileName.trim()) {
    return null;
  }
  return texto;
}

/** Une el texto de varios mensajes, uno por linea; los que no tienen texto se saltan. */
export function textoDeVariosParaCopiar(mensajes: SharedInboxMessageItem[]): string | null {
  const texto = mensajes
    .map(textoParaCopiar)
    .filter((linea): linea is string => Boolean(linea))
    .join("\n");
  return texto || null;
}

/*
  Respaldo para navegadores sin `navigator.clipboard` (o cuando lo rechaza): un cuadro de texto
  oculto y `execCommand('copy')`, que si sirve en iPhone.

  - Letra de 16px: con menos, Safari acerca la pantalla al enfocar el cuadro.
  - `setSelectionRange`: en iPhone `select()` solo no marca el texto.
  - Va dentro de la hoja abierta (si hay una): la hoja atrapa el foco, y un cuadro afuera no se
    podria seleccionar.
*/
function copiarConCuadroOculto(texto: string): boolean {
  if (typeof document === "undefined") return false;
  const cuadro = document.createElement("textarea");
  cuadro.value = texto;
  cuadro.setAttribute("readonly", "");
  cuadro.setAttribute("aria-hidden", "true");
  cuadro.style.position = "fixed";
  cuadro.style.top = "0";
  cuadro.style.left = "0";
  cuadro.style.opacity = "0";
  cuadro.style.fontSize = "16px";
  cuadro.style.pointerEvents = "none";

  const enfocado = document.activeElement as HTMLElement | null;
  const contenedor = document.querySelector<HTMLElement>('[role="dialog"]') ?? document.body;
  contenedor.appendChild(cuadro);
  try {
    cuadro.focus();
    cuadro.select();
    cuadro.setSelectionRange(0, texto.length);
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    cuadro.remove();
    enfocado?.focus?.();
  }
}

/*
  Copia el texto al portapapeles.

  `navigator.clipboard.writeText` se llama DE INMEDIATO, sin ningun await antes: Safari solo deja
  copiar dentro del mismo toque, y un await en el medio lo pierde. Si no existe o falla, se usa el
  cuadro oculto. Devuelve si se pudo copiar.
*/
export function copiarAlPortapapeles(texto: string): boolean | Promise<boolean> {
  const portapapeles = typeof navigator !== "undefined" ? navigator.clipboard : undefined;
  if (!portapapeles?.writeText) {
    return copiarConCuadroOculto(texto);
  }
  try {
    return portapapeles.writeText(texto).then(
      () => true,
      () => copiarConCuadroOculto(texto),
    );
  } catch {
    return copiarConCuadroOculto(texto);
  }
}
