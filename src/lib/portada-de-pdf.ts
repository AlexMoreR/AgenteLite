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

/*
  Lo mismo, pero para un PDF que ya esta en internet: el de una burbuja del chat.

  WhatsApp no muestra un icono rojo: muestra el PRINCIPIO de la primera hoja, cuantas paginas
  tiene y cuanto pesa. Con eso, una tanda de hojas de vida se reconoce sin abrir ninguna — que es
  exactamente lo que hace Ingrid todo el dia.

  Se guarda lo ya dibujado en memoria: la lista del chat se vuelve a pintar con cada mensaje que
  entra, y sin esto cada repintado se bajaria el PDF de nuevo.
*/
const PESO_MAXIMO_PARA_LA_TAPA = 20 * 1024 * 1024;

export type TapaDePdf = {
  imagen: string;
  paginas: number;
  bytes: number;
};

const tapasEnMemoria = new Map<string, Promise<TapaDePdf | null>>();

export function tapaDePdfDesdeUrl(url: string): Promise<TapaDePdf | null> {
  const guardada = tapasEnMemoria.get(url);
  if (guardada) {
    return guardada;
  }

  const tarea = (async (): Promise<TapaDePdf | null> => {
    try {
      const respuesta = await fetch(url);
      if (!respuesta.ok) {
        return null;
      }

      /*
        Un archivo enorme no se dibuja.

        La tapa es una comodidad; bajarse 80 MB con los datos del celular para mostrar una
        miniatura de 200 pixeles no lo es. Esos se quedan con la tarjeta de siempre.
      */
      const largoDeclarado = Number(respuesta.headers.get("content-length") ?? "0");
      if (largoDeclarado > PESO_MAXIMO_PARA_LA_TAPA) {
        return null;
      }

      const datos = await respuesta.arrayBuffer();
      if (datos.byteLength > PESO_MAXIMO_PARA_LA_TAPA) {
        return null;
      }

      /*
        El peso se anota ANTES de dibujar.

        pdf.js le entrega el buffer a su worker y de este lado queda vacio: leer `byteLength`
        despues devuelve 0, y la tarjeta diria "0 B" en todos los archivos.
      */
      const peso = datos.byteLength;

      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url,
      ).toString();

      const documento = await pdfjs.getDocument({ data: datos }).promise;
      const pagina = await documento.getPage(1);

      const original = pagina.getViewport({ scale: 1 });
      const escala = ANCHO_PORTADA / original.width;
      const viewport = pagina.getViewport({ scale: escala });

      const canvas = document.createElement("canvas");
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const contexto = canvas.getContext("2d");
      if (!contexto) {
        return null;
      }

      await pagina.render({ canvasContext: contexto, viewport }).promise;

      return {
        imagen: canvas.toDataURL("image/jpeg", 0.72),
        paginas: documento.numPages,
        bytes: peso,
      };
    } catch {
      // Un PDF protegido, roto o que ya no esta: se queda con la tarjeta de siempre.
      return null;
    }
  })();

  tapasEnMemoria.set(url, tarea);
  return tarea;
}
