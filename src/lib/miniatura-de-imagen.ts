/**
 * Miniatura de una foto, sacada del archivo LOCAL antes de subirlo.
 *
 * La grilla de la Biblioteca dibujaba la foto entera como tapa: una foto de celular pesa 3 a 5 MB,
 * y con veinte en pantalla el celular de la asesora bajaba 80 MB para ver cuadritos de 150 px.
 * Igual que la portada de los PDF, se achica en el aparato (es instantaneo) y se sube aparte.
 *
 * Si no sale -formato que el navegador no sabe abrir, HEIC en Android- devuelve null y la tapa
 * cae en la foto original: una miniatura que falta no puede impedir guardar la foto.
 *
 * `calidad` es la del JPG (0 a 1). La Biblioteca usa la de siempre (0,8); la carta de colores pide más
 * para que la muestra conserve el color y la textura.
 */
export async function generarMiniaturaDeImagen(file: File, lado = 480, calidad = 0.8): Promise<File | null> {
  try {
    // createImageBitmap respeta la orientacion EXIF: la foto vertical no sale acostada.
    const imagen = await createImageBitmap(file);
    const escala = Math.min(1, lado / Math.max(imagen.width, imagen.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(imagen.width * escala));
    canvas.height = Math.max(1, Math.round(imagen.height * escala));
    // El lienzo en sRGB: el navegador pasa la foto a sRGB al dibujarla y el JPG sale con el color de la foto.
    const contexto = canvas.getContext("2d", { colorSpace: "srgb" });
    if (!contexto) {
      imagen.close();
      return null;
    }
    // Achicar con el mejor suavizado que tenga el navegador: guarda mejor la textura de la foto.
    contexto.imageSmoothingEnabled = true;
    contexto.imageSmoothingQuality = "high";
    contexto.drawImage(imagen, 0, 0, canvas.width, canvas.height);
    imagen.close();

    const blob = await new Promise<Blob | null>((resolver) =>
      canvas.toBlob((resultado) => resolver(resultado), "image/jpeg", calidad),
    );
    return blob ? new File([blob], "miniatura.jpg", { type: "image/jpeg" }) : null;
  } catch {
    return null;
  }
}
