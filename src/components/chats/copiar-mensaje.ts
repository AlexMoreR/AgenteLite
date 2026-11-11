/*
  Copiar el texto de uno o varios mensajes del chat.

  Funciones puras (salvo la del portapapeles) para que la hoja del celular, el menu de la
  computadora y la barra de mensajes marcados copien EXACTAMENTE lo mismo.

  Donde vive el texto: no hay un campo `caption` aparte. El texto que acompaña una foto, un video
  o un documento se guarda en `content`, el mismo campo de los mensajes de texto. Cuando no hay
  texto real, `content` trae otra cosa que NO se copia:
  - la etiqueta del tipo ("Foto", "Video", "Documento"...), ver getMediaPreviewLabel;
  - en un documento, el nombre del archivo (WhatsApp lo manda como si fuera el caption);
  - en un archivo que no se pudo bajar, el aviso "no se pudo descargar".
  Es la misma regla que usa la burbuja para decidir si dibuja el texto debajo del archivo.
*/
import { getMediaPreviewLabel } from "./chat-inbox-format";
import { getDocumentMetaFromMessage } from "./chat-inbox-media";
import type { SharedInboxMessageItem } from "./chat-inbox-types";

const AVISO_DE_ARCHIVO_PERDIDO = "no se pudo descargar";

/** El texto que se copia de un mensaje, o null si no tiene texto real. */
export function textoParaCopiar(message: SharedInboxMessageItem): string | null {
  if (message.deletedAt) return null;
  // La nota de voz y el sticker no traen texto escrito por nadie.
  if (message.type === "AUDIO" || message.type === "STICKER") return null;

  const texto = (message.content ?? "").trim();
  if (!texto) return null;

  const esArchivo = Boolean(message.type) && message.type !== "TEXT";
  if (esArchivo) {
    if (texto === getMediaPreviewLabel(message.type)) return null;
    if (texto.includes(AVISO_DE_ARCHIVO_PERDIDO)) return null;
  }
  if (message.type === "DOCUMENT" && texto === getDocumentMetaFromMessage(message).fileName.trim()) {
    return null;
  }

  return texto;
}

/** Los textos de varios mensajes, uno por linea; los que no tienen texto se saltan. */
export function textoDeVariosParaCopiar(mensajes: SharedInboxMessageItem[]): string | null {
  const lineas = mensajes
    .map((mensaje) => textoParaCopiar(mensaje))
    .filter((linea): linea is string => Boolean(linea));
  return lineas.length > 0 ? lineas.join("\n") : null;
}

/*
  Copia al portapapeles.

  `navigator.clipboard.writeText` se llama DE INMEDIATO, sin ningun await antes: Safari (iPhone)
  solo deja copiar dentro del mismo toque, y cualquier espera hace que lo niegue. Si no existe o
  falla, se usa la forma antigua (un cuadro de texto oculto + execCommand("copy")).

  Devuelve true/false si se resolvio en el acto, o una promesa si fue por la forma normal.
*/
export function copiarAlPortapapeles(texto: string): boolean | Promise<boolean> {
  const clipboard = typeof navigator !== "undefined" ? navigator.clipboard : undefined;
  if (clipboard && typeof clipboard.writeText === "function") {
    try {
      return clipboard.writeText(texto).then(
        () => true,
        () => copiarConRespaldo(texto),
      );
    } catch {
      return copiarConRespaldo(texto);
    }
  }
  return copiarConRespaldo(texto);
}

function copiarConRespaldo(texto: string): boolean {
  if (typeof document === "undefined" || !document.body) return false;

  const enfocadoAntes = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  /*
    El cuadro va DENTRO de la hoja o el menu abierto (si lo hay): esos bloquean el foco fuera de
    ellos y el cuadro no se podria seleccionar.
  */
  const contenedor = enfocadoAntes?.closest<HTMLElement>('[role="dialog"], [role="menu"]') ?? document.body;

  const cuadro = document.createElement("textarea");
  cuadro.value = texto;
  cuadro.setAttribute("readonly", "");
  cuadro.setAttribute("aria-hidden", "true");
  // 16px: con menos, el iPhone acerca la pantalla al enfocar el cuadro.
  cuadro.style.fontSize = "16px";
  cuadro.style.position = "fixed";
  cuadro.style.top = "0";
  cuadro.style.left = "0";
  cuadro.style.width = "1px";
  cuadro.style.height = "1px";
  cuadro.style.opacity = "0";
  cuadro.style.pointerEvents = "none";
  contenedor.appendChild(cuadro);

  let copiado = false;
  try {
    cuadro.focus({ preventScroll: true });
    cuadro.select();
    // El iPhone ignora select(): hay que marcar el rango a mano.
    cuadro.setSelectionRange(0, texto.length);
    copiado = document.execCommand("copy");
  } catch {
    copiado = false;
  } finally {
    cuadro.remove();
    enfocadoAntes?.focus({ preventScroll: true });
  }
  return copiado;
}
