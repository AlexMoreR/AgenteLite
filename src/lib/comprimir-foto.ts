/**
 * Achica una foto del compositor de Chats ANTES de subirla.
 *
 * Una foto de celular pesa 3 a 5 MB y con la señal de la calle tarda minutos en subir. Al cliente
 * le basta una de 1600 px de lado largo, que en JPEG pesa unos cientos de KB.
 *
 * Solo se usa en el compositor (`sendSingleMediaFile` de `chat-conversation-panel.tsx`). La
 * Biblioteca, reenviar, los seguimientos y los flujos suben el archivo intacto: por eso esto NO va
 * dentro de `subirArchivoPorPedazos`.
 *
 * Igual que `miniatura-de-imagen.ts`: `createImageBitmap` respeta la orientacion EXIF (la foto
 * vertical no sale acostada) y el lienzo va en sRGB.
 *
 * Comprimir nunca puede impedir un envio: si algo falla, o el resultado no pesa menos, sale el
 * archivo original.
 */

/** Tipos que se comprimen. GIF (animado), video, documentos y cualquier otro salen tal cual. */
export const TIPOS_DE_FOTO_COMPRIMIBLES = ["image/jpeg", "image/png", "image/webp"] as const;

/** Lado largo maximo de la foto que sale, en px. */
export const LADO_MAXIMO_PX = 1600;

/** Peso hasta el que una foto ya chica sale tal cual, y meta de la compresion. */
export const PESO_MAXIMO_BYTES = 400 * 1024;

/** Calidades del JPEG, de mayor a menor. No se baja de 0,6 para no pixelar. */
export const CALIDADES_JPEG = [0.8, 0.7, 0.6] as const;

export function esFotoComprimible(tipo: string): boolean {
  return (TIPOS_DE_FOTO_COMPRIMIBLES as readonly string[]).includes(tipo.toLowerCase());
}

/**
 * Decide si una foto se comprime: tiene que ser JPEG, PNG o WEBP y pasarse de 400 KB o de
 * 1600 px de lado largo. Si pesa 400 KB o menos y mide 1600 px o menos, sale tal cual.
 */
export function debeComprimirFoto(foto: { tipo: string; peso: number; ancho: number; alto: number }): boolean {
  if (!esFotoComprimible(foto.tipo)) return false;
  return foto.peso > PESO_MAXIMO_BYTES || Math.max(foto.ancho, foto.alto) > LADO_MAXIMO_PX;
}

/** Medidas de salida: lado largo de 1600 px como maximo, sin deformar y sin agrandar nunca. */
export function medidasParaEnviar(ancho: number, alto: number): { ancho: number; alto: number } {
  const escala = Math.min(1, LADO_MAXIMO_PX / Math.max(ancho, alto, 1));
  return {
    ancho: Math.max(1, Math.round(ancho * escala)),
    alto: Math.max(1, Math.round(alto * escala)),
  };
}

/**
 * Nombre del JPEG: la base del original con `.jpg`. Es obligatorio: el servidor elige la extension
 * guardada mirando primero el nombre, y un JPEG llamado `foto.png` quedaria guardado como `.png`.
 */
export function nombreJpg(nombre: string): string {
  const punto = nombre.lastIndexOf(".");
  const base = (punto > 0 ? nombre.slice(0, punto) : nombre).trim();
  return `${base || "foto"}.jpg`;
}

export async function comprimirFotoParaEnviar(file: File): Promise<File> {
  // GIF, video, documentos: ni se abren.
  if (!esFotoComprimible(file.type)) return file;

  let imagen: ImageBitmap | null = null;
  try {
    // createImageBitmap respeta la orientacion EXIF: ancho y alto ya vienen como se ve la foto.
    imagen = await createImageBitmap(file);
    if (!debeComprimirFoto({ tipo: file.type, peso: file.size, ancho: imagen.width, alto: imagen.height })) {
      return file;
    }

    const medidas = medidasParaEnviar(imagen.width, imagen.height);
    const canvas = document.createElement("canvas");
    canvas.width = medidas.ancho;
    canvas.height = medidas.alto;
    // El lienzo en sRGB: el navegador pasa la foto a sRGB al dibujarla y el JPG sale con su color.
    const contexto = canvas.getContext("2d", { colorSpace: "srgb" });
    if (!contexto) return file;

    // Fondo blanco antes de dibujar: el JPEG no tiene transparencia y un PNG transparente saldria negro.
    contexto.fillStyle = "#ffffff";
    contexto.fillRect(0, 0, canvas.width, canvas.height);
    // Achicar con el mejor suavizado que tenga el navegador: guarda mejor la textura de la foto.
    contexto.imageSmoothingEnabled = true;
    contexto.imageSmoothingQuality = "high";
    contexto.drawImage(imagen, 0, 0, canvas.width, canvas.height);
    imagen.close();
    imagen = null;

    let blob: Blob | null = null;
    for (const calidad of CALIDADES_JPEG) {
      blob = await new Promise<Blob | null>((resolver) =>
        canvas.toBlob((resultado) => resolver(resultado), "image/jpeg", calidad),
      );
      if (!blob || blob.size <= PESO_MAXIMO_BYTES) break;
    }
    // Sin resultado, o uno que no pesa menos: mejor el original.
    if (!blob || blob.size >= file.size) return file;

    return new File([blob], nombreJpg(file.name), { type: "image/jpeg", lastModified: file.lastModified });
  } catch {
    return file;
  } finally {
    imagen?.close();
  }
}
