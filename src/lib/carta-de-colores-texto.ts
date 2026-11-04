/*
  Texto que acompaña a la carta de colores cuando se manda en el chat.

  Vive en un archivo aparte, sin nada de Node, para que el cuadro "Colores" del chat (que corre en el
  navegador) lo pueda usar: carta-de-colores.ts usa node:crypto y no se puede llevar al navegador.
  carta-de-colores.ts lo vuelve a exportar con el mismo nombre.
*/
export const TEXTO_CARTA_DE_COLORES = "Escríbeme el código del color que te gustó 😊";
