// Del archivo sin Node: este módulo lo usa el cuadro del chat, que corre en el navegador.
import { TEXTO_CARTA_DE_COLORES } from "./carta-de-colores-texto";

/*
  Carta de colores en el chat (parte 4 de «Carta de colores digital dentro del CRM»).

  Arma la lista de imágenes que se mandan cuando la asesora pulsa "Enviar" en el cuadro "Colores"
  del chat. Es una regla pura (sin React ni servidor) para poder probarla sola.
*/

/** Lo que devuelve `listarCartaParaChatAction()`: los materiales que ya tienen imágenes, en orden. */
export type MaterialDeCartaParaChat = { id: string; nombre: string; imagenesUrl: string[] };

/** La opción "Todos" del cuadro: manda la carta completa. */
export const OPCION_TODOS = "todos";

export type ImagenDeCartaParaEnviar = {
  url: string;
  fileName: string;
  /** Solo la última imagen lleva el texto, para que el cliente lo lea después de ver los colores. */
  caption?: string;
};

/** El nombre del archivo: lo último de la ruta ("/uploads/carta-colores/prana-ab12-1.png" → "prana-ab12-1.png"). */
function nombreDeArchivo(url: string) {
  return url.split("/").filter(Boolean).pop() || "carta-de-colores.png";
}

/**
 * Las imágenes a mandar, en el orden de la pantalla.
 *
 * - Con un material: sus imágenes.
 * - Con "Todos": las de cada material, uno detrás de otro; los que no tienen imagen se saltan.
 * - Si no se eligió nada o lo elegido ya no está, sale vacío (no se manda nada).
 *
 * Solo la ÚLTIMA lleva `TEXTO_CARTA_DE_COLORES` como texto.
 */
export function imagenesDeCartaParaEnviar(
  materiales: readonly MaterialDeCartaParaChat[],
  elegido: string | null,
): ImagenDeCartaParaEnviar[] {
  if (!elegido) return [];
  const usados = elegido === OPCION_TODOS ? materiales : materiales.filter((material) => material.id === elegido);
  const urls = usados.flatMap((material) => material.imagenesUrl.filter((url) => typeof url === "string" && url.length > 0));
  return urls.map((url, indice) => ({
    url,
    fileName: nombreDeArchivo(url),
    ...(indice === urls.length - 1 ? { caption: TEXTO_CARTA_DE_COLORES } : {}),
  }));
}
