/*
  Carta de colores en el chat (parte 4): reglas puras para mandarla desde la bandeja.

  Va aparte de carta-de-colores.ts porque ese archivo usa node:crypto y no puede viajar al navegador;
  este sí, porque lo usa el cuadro "Colores" del chat. carta-de-colores.ts vuelve a exportar el texto.
*/

/** Texto que acompaña a la carta cuando se manda en el chat. */
export const TEXTO_CARTA_DE_COLORES = "Escríbeme el código del color que te gustó 😊";

/** Un material tal como lo trae listarCartaParaChatAction. */
export type MaterialDeCartaParaChat = { id: string; nombre: string; imagenesUrl: string[] };

/** Lo que la asesora escoge en el cuadro: un material (su id) o "Todos". */
export const ELECCION_TODOS = "__todos__";

/** Una imagen por mandar. Solo la última lleva texto. */
export type ImagenPorMandar = { url: string; texto?: string };

/**
  Arma la lista de imágenes a mandar, en el orden de la pantalla. "Todos" junta las de cada material y se
  salta los que no tienen. Solo la ÚLTIMA lleva TEXTO_CARTA_DE_COLORES. Si no hay nada, devuelve [].
*/
export function imagenesParaMandar(
  materiales: readonly MaterialDeCartaParaChat[],
  eleccion: string,
): ImagenPorMandar[] {
  const elegidos = eleccion === ELECCION_TODOS ? materiales : materiales.filter((m) => m.id === eleccion);
  const urls = elegidos.flatMap((m) => m.imagenesUrl.filter((url) => url.trim().length > 0));
  return urls.map((url, indice) => (indice === urls.length - 1 ? { url, texto: TEXTO_CARTA_DE_COLORES } : { url }));
}

/**
  Manda las imágenes una por una, esperando cada envío. Si una falla (devuelve error o se cae), se para
  ahí y no manda las que faltan. Devuelve cuántas salieron y el error, si hubo.
*/
export async function mandarEnOrden(
  imagenes: readonly ImagenPorMandar[],
  mandar: (imagen: ImagenPorMandar, indice: number) => Promise<{ ok: true } | { error: string }>,
): Promise<{ enviadas: number; error?: string }> {
  let enviadas = 0;
  for (const [indice, imagen] of imagenes.entries()) {
    let resultado: { ok: true } | { error: string };
    try {
      resultado = await mandar(imagen, indice);
    } catch {
      return { enviadas, error: "No se pudo enviar. Revisa la conexión y vuelve a intentarlo." };
    }
    if (!resultado || !("ok" in resultado) || !resultado.ok) {
      const error = resultado && "error" in resultado && resultado.error ? resultado.error : "No se pudo enviar.";
      return { enviadas, error };
    }
    enviadas += 1;
  }
  return { enviadas };
}
