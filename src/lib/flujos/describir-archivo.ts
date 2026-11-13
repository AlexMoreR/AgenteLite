/*
  Se movió de flow-send-actions.ts (parte 2 de «Flujos: que se envíen completos…»): ahora lo usa
  procesarEnvioDeFlujo, que manda el flujo desde el servidor. Sin cambios en lo que hace.
*/
/*
  QUE ARCHIVO ES: el tipo real y su nombre, sacados de la direccion.

  Esto mandaba `application/octet-stream` y un nombre inventado ("image.file") para toda foto y
  todo video. WhatsApp recibia el mensaje -le daba su id y hasta lo marcaba como entregado-, pero
  al llegar al telefono no lo podia dibujar: le habiamos dicho que era un archivo de tipo
  desconocido. En el chat del cliente no aparecia nada (Alex, 28-09-2026).

  El video se salvaba de casualidad: su ruta de WAHA lleva `convert: true`, asi que WAHA lo
  re-codifica y le pone el tipo correcto por su cuenta. Las fotos no pasan por ahi, y por eso
  llegaba el video y no las fotos, que es exactamente lo que se veia.

  El camino automatico -el del agente- nunca tuvo el problema porque manda "image/jpeg" a mano.
  Aca se saca de la extension, que ademas conserva el nombre de verdad del archivo.
*/
const MIME_POR_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  pdf: "application/pdf",
};

/** Si la direccion no dice nada, se usa lo mismo que manda el agente para ese tipo. */
const MIME_POR_DEFECTO: Record<string, string> = {
  image: "image/jpeg",
  video: "video/mp4",
  document: "application/pdf",
};

export function describirArchivo(
  kind: string,
  url: string,
  nombreDelPaso?: string | null,
): { mime: string; nombre: string } {
  const ultimoTramo = decodeURIComponent(url.split("?")[0].split("/").pop() ?? "");
  const extension = ultimoTramo.includes(".") ? (ultimoTramo.split(".").pop() ?? "").toLowerCase() : "";
  const mime = MIME_POR_EXTENSION[extension] ?? MIME_POR_DEFECTO[kind] ?? "application/octet-stream";

  const nombre =
    nombreDelPaso?.trim() ||
    ultimoTramo ||
    (kind === "image" ? "foto.jpg" : kind === "video" ? "video.mp4" : "documento.pdf");

  return { mime, nombre };
}
