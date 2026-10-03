/**
 * Miniatura de una foto, sacada del archivo LOCAL antes de subirlo.
 *
 * La grilla de la Biblioteca dibujaba la foto entera como tapa: una foto de celular pesa 3 a 5 MB,
 * y con veinte en pantalla el celular de la asesora bajaba 80 MB para ver cuadritos de 150 px.
 * Igual que la portada de los PDF, se achica en el aparato (es instantaneo) y se sube aparte.
 *
 * Si no sale -formato que el navegador no sabe abrir, HEIC en Android- devuelve null y la tapa
 * cae en la foto original: una miniatura que falta no puede impedir guardar la foto.
 */
export async function generarMiniaturaDeImagen(file: File, lado = 480): Promise<File | null> {
  try {
    // createImageBitmap respeta la orientacion EXIF: la foto vertical no sale acostada.
    const imagen = await createImageBitmap(file);
    const escala = Math.min(1, lado / Math.max(imagen.width, imagen.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(imagen.width * escala));
    canvas.height = Math.max(1, Math.round(imagen.height * escala));
    const contexto = canvas.getContext("2d");
    if (!contexto) {
      imagen.close();
      return null;
    }
    contexto.drawImage(imagen, 0, 0, canvas.width, canvas.height);
    imagen.close();

    const blob = await new Promise<Blob | null>((resolver) =>
      canvas.toBlob((resultado) => resolver(resultado), "image/jpeg", 0.8),
    );
    return blob ? new File([blob], "miniatura.jpg", { type: "image/jpeg" }) : null;
  } catch {
    return null;
  }
}
