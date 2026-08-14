/**
 * La PORTADA de un PDF: la primera pagina convertida en una imagen chica.
 *
 * Sin esto la biblioteca muestra un icono rojo igual para todos, y los ocho catalogos de Magilus
 * empiezan con la misma palabra ("CATALOGO ..."): elegir uno obliga a abrirlos de a uno. Con la
 * tapa a la vista se reconocen de un vistazo, que es como funciona Drive.
 *
 * Se genera EN EL NAVEGADOR y ANTES de subir, sobre el archivo que la persona acaba de elegir. Es
 * la diferencia entre leer 15 MB del disco del celular —instantaneo— y bajarlos de internet para
 * poder dibujarlos, que con la señal de la calle seria justo el problema que vinimos a resolver.
 */

const ANCHO_PORTADA = 400;

export async function generarPortadaDePdf(file: File): Promise<File | null> {
  try {
    // Import dinamico: pdf.js pesa, y no tiene por que viajar al celular de alguien que solo
    // entra a leer chats. Solo se descarga cuando se agrega un archivo a la biblioteca.
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url,
    ).toString();

    const documento = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
    const pagina = await documento.getPage(1);

    const escalaOriginal = pagina.getViewport({ scale: 1 });
    const escala = ANCHO_PORTADA / escalaOriginal.width;
    const viewport = pagina.getViewport({ scale: escala });

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const contexto = canvas.getContext("2d");
    if (!contexto) {
      return null;
    }

    await pagina.render({ canvasContext: contexto, viewport }).promise;

    const blob = await new Promise<Blob | null>((resolver) =>
      canvas.toBlob((resultado) => resolver(resultado), "image/jpeg", 0.75),
    );
    if (!blob) {
      return null;
    }

    return new File([blob], "portada.jpg", { type: "image/jpeg" });
  } catch {
    // Un PDF protegido o roto no tiene por que impedir guardarlo: se queda sin tapa y listo.
    return null;
  }
}
