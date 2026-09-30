import { PDFDocument, PDFFont, PDFImage, PDFName, PDFString, StandardFonts, rgb } from "pdf-lib";

import type { MensajeExportado } from "@/lib/exportar-conversacion";

/**
 * La conversación entera, en un PDF que se puede guardar o mandar por correo.
 *
 * Nace de un pedido concreto: poder bajarse un chat completo —con las fotos adentro y los audios
 * escuchables— sin depender de tener la app abierta y con sesión. Por eso los medios NO son
 * capturas de pantalla: las imágenes van incrustadas en el archivo y cada nota de voz queda como
 * un enlace que abre el audio en el navegador.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * LO QUE NO SE PUEDE, Y POR QUÉ
 *
 * Las tipografías que trae un PDF estándar son WinAnsi (Latin-1): tienen acentos, ñ y ¿, pero NO
 * tienen emojis. Meter un emoji de WhatsApp haría reventar la generación, así que se quitan del
 * texto. Un mensaje que era SOLO emojis queda como "(emoji)" en vez de una línea en blanco.
 *
 * Incrustar emojis pediría cargar una fuente Unicode completa dentro de la imagen de Docker —
 * varios megas— y no vale el cambio para lo que se usa esto.
 * ────────────────────────────────────────────────────────────────────────────────────────────
 */

/** El mensaje es el mismo que usa la descarga con audios: los dos archivos muestran lo mismo. */
export type MensajeParaPdf = MensajeExportado;

export type DatosDelPdf = {
  titulo: string;
  telefono: string | null;
  mensajes: MensajeParaPdf[];
  /** Quién lo descargó, para que el archivo diga de dónde salió. */
  descargadoPor: string | null;
};

const ANCHO = 595.28; // A4
const ALTO = 841.89;
const MARGEN = 42;
const ANCHO_UTIL = ANCHO - MARGEN * 2;

/** Nunca toda la hoja: una burbuja que ocupa el ancho completo se lee peor que una angosta. */
const BURBUJA_MAX = 340;
const RELLENO = 9;

const CUERPO = 9.5;
const INTERLINEA = 12.5;
const META = 7.5;

const VERDE = rgb(0.851, 0.937, 0.812); // lo nuestro, como en la app
const GRIS = rgb(0.949, 0.949, 0.961); // lo del cliente
const BORDE = rgb(0.886, 0.894, 0.91);
const TINTA = rgb(0.106, 0.122, 0.157);
const TENUE = rgb(0.42, 0.447, 0.502);
const ENLACE = rgb(0.086, 0.373, 0.749);

// Con la zona fija: el contenedor hoy corre en hora de Colombia, pero si algun dia arranca en UTC
// cada mensaje de la noche saldria con 5 horas de mas y en el dia siguiente.
const FECHA_CORTA = new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", hour: "2-digit", minute: "2-digit" });
const FECHA_DIA = new Intl.DateTimeFormat("es-CO", {
  timeZone: "America/Bogota",
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

/**
 * Deja el texto en lo que una fuente estándar sabe dibujar.
 *
 * Las comillas y guiones "bonitos" que mete el teclado del celular se cambian por los de máquina
 * de escribir (existen en Latin-1 pero quedan raros mezclados); todo lo que no entra —emojis,
 * alfabetos no latinos— se cae. Sin esto pdf-lib lanza una excepción y no sale ningún archivo.
 */
export function aTextoDePdf(valor: string): string {
  return valor
    .replace(/\r\n?/g, "\n")
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/[   ]/g, " ")
    .replace(/\t/g, "  ")
    // Lo que queda fuera de Latin-1 imprimible no se puede dibujar: fuera.
    .replace(/[^\n\x20-\x7E\xA1-\xFF]/g, "")
    // El hueco que dejaron los emojis borrados.
    .replace(/[ ]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Parte el texto en líneas que entran en `ancho`, respetando los saltos que el cliente escribió. */
function partirEnLineas(texto: string, fuente: PDFFont, tamano: number, ancho: number): string[] {
  const lineas: string[] = [];

  for (const parrafo of texto.split("\n")) {
    if (!parrafo.trim()) {
      lineas.push("");
      continue;
    }

    let actual = "";
    for (const palabra of parrafo.split(/\s+/)) {
      const probando = actual ? `${actual} ${palabra}` : palabra;
      if (fuente.widthOfTextAtSize(probando, tamano) <= ancho) {
        actual = probando;
        continue;
      }

      if (actual) {
        lineas.push(actual);
        actual = "";
      }

      // Una palabra sola más ancha que la burbuja (un link largo, por ejemplo): se corta a lo bruto.
      if (fuente.widthOfTextAtSize(palabra, tamano) > ancho) {
        let pedazo = "";
        for (const letra of palabra) {
          if (fuente.widthOfTextAtSize(pedazo + letra, tamano) > ancho) {
            lineas.push(pedazo);
            pedazo = letra;
          } else {
            pedazo += letra;
          }
        }
        actual = pedazo;
      } else {
        actual = palabra;
      }
    }

    if (actual) {
      lineas.push(actual);
    }
  }

  return lineas.length > 0 ? lineas : [""];
}

function duracion(segundos: number | null): string {
  if (!segundos || !Number.isFinite(segundos) || segundos <= 0) {
    return "";
  }
  const minutos = Math.floor(segundos / 60);
  const resto = Math.floor(segundos % 60);
  return ` (${minutos}:${String(resto).padStart(2, "0")})`;
}

/** Qué dice la tarjeta del medio, según el tipo de mensaje. */
function etiquetaDelMedio(mensaje: MensajeParaPdf): string | null {
  switch (mensaje.tipo) {
    case "AUDIO":
      return `Nota de voz${duracion(mensaje.audioSegundos)} - Escuchar`;
    case "VIDEO":
      return "Video - Abrir";
    case "DOCUMENT":
      return `${mensaje.archivoNombre || "Documento"} - Abrir`;
    case "IMAGE":
    case "STICKER":
      // Solo si no se pudo incrustar: ahí el enlace es lo único que queda.
      return "Imagen - Abrir";
    default:
      return null;
  }
}

/**
 * La hoja en la que se está dibujando, con el cursor y los enlaces pendientes.
 *
 * Los enlaces de un PDF no son parte del dibujo: son anotaciones aparte que se le cuelgan a la
 * página. Se juntan mientras se dibuja y se escriben todas de una cuando la hoja se cierra,
 * porque escribirlas de a una pisaría las anteriores.
 */
class Hoja {
  private doc: PDFDocument;
  private pagina: ReturnType<PDFDocument["addPage"]>;
  private anotaciones: ReturnType<PDFDocument["context"]["register"]>[] = [];
  y = ALTO - MARGEN;

  constructor(doc: PDFDocument) {
    this.doc = doc;
    this.pagina = doc.addPage([ANCHO, ALTO]);
  }

  get actual() {
    return this.pagina;
  }

  /** Lo que queda de hoja hacia abajo, dejando el pie libre. */
  get disponible() {
    return this.y - (MARGEN + 14);
  }

  saltar(alto: number) {
    if (alto <= this.disponible) {
      return;
    }
    this.cerrar();
    this.pagina = this.doc.addPage([ANCHO, ALTO]);
    this.y = ALTO - MARGEN;
  }

  enlace(url: string, x: number, y: number, ancho: number, alto: number) {
    this.anotaciones.push(
      this.doc.context.register(
        this.doc.context.obj({
          Type: "Annot",
          Subtype: "Link",
          Rect: [x, y, x + ancho, y + alto],
          // Sin marco: el recuadro amarillo que dibujan algunos lectores ensucia la burbuja.
          Border: [0, 0, 0],
          A: {
            Type: "Action",
            S: "URI",
            URI: PDFString.of(url),
          },
        }),
      ),
    );
  }

  cerrar() {
    if (this.anotaciones.length === 0) {
      return;
    }
    this.pagina.node.set(PDFName.of("Annots"), this.doc.context.obj(this.anotaciones));
    this.anotaciones = [];
  }
}

/** JPEG y PNG son los únicos formatos que un PDF sabe llevar adentro sin convertir. */
function formatoDeImagen(bytes: Uint8Array): "jpg" | "png" | null {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "jpg";
  }
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "png";
  }
  return null;
}

export async function construirPdfDeConversacion(datos: DatosDelPdf): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const normal = await doc.embedFont(StandardFonts.Helvetica);
  const negrita = await doc.embedFont(StandardFonts.HelveticaBold);
  // En cursiva va lo que se dijo en un audio: se distingue de lo que se escribio.
  const cursiva = await doc.embedFont(StandardFonts.HelveticaOblique);

  doc.setTitle(aTextoDePdf(`Conversacion con ${datos.titulo}`) || "Conversacion");
  doc.setCreator("Aizenbot");

  const hoja = new Hoja(doc);

  // ── Encabezado ────────────────────────────────────────────────────────────────────────────
  const nombre = aTextoDePdf(datos.titulo) || "Sin nombre";
  hoja.actual.drawText(nombre, { x: MARGEN, y: hoja.y - 14, size: 16, font: negrita, color: TINTA });
  hoja.y -= 22;

  const primero = datos.mensajes[0];
  const ultimo = datos.mensajes[datos.mensajes.length - 1];
  const rango =
    primero && ultimo
      ? `${FECHA_DIA.format(primero.cuando)} al ${FECHA_DIA.format(ultimo.cuando)}`
      : "sin mensajes";
  const subtitulo = aTextoDePdf(
    [
      datos.telefono ? `WhatsApp ${datos.telefono}` : "WhatsApp",
      `${datos.mensajes.length} mensajes`,
      rango,
    ].join("  -  "),
  );
  hoja.actual.drawText(subtitulo, { x: MARGEN, y: hoja.y - 9, size: 8.5, font: normal, color: TENUE });
  hoja.y -= 16;

  hoja.actual.drawRectangle({ x: MARGEN, y: hoja.y, width: ANCHO_UTIL, height: 0.8, color: BORDE });
  hoja.y -= 18;

  // Cada imagen se incrusta UNA vez aunque el mismo archivo aparezca en varios mensajes.
  const imagenes = new Map<string, PDFImage | null>();
  let diaDibujado = "";

  for (const mensaje of datos.mensajes) {
    // ── Separador de día ────────────────────────────────────────────────────────────────────
    const dia = FECHA_DIA.format(mensaje.cuando);
    if (dia !== diaDibujado) {
      diaDibujado = dia;
      hoja.saltar(30);
      const etiqueta = aTextoDePdf(dia);
      const anchoEtiqueta = normal.widthOfTextAtSize(etiqueta, META) + 16;
      const x = MARGEN + (ANCHO_UTIL - anchoEtiqueta) / 2;
      hoja.actual.drawRectangle({
        x,
        y: hoja.y - 14,
        width: anchoEtiqueta,
        height: 14,
        color: GRIS,
        borderColor: BORDE,
        borderWidth: 0.5,
      });
      hoja.actual.drawText(etiqueta, { x: x + 8, y: hoja.y - 10, size: META, font: normal, color: TENUE });
      hoja.y -= 24;
    }

    // ── Contenido de la burbuja ─────────────────────────────────────────────────────────────
    const anchoTexto = BURBUJA_MAX - RELLENO * 2;

    let imagen: PDFImage | null = null;
    // Solo fotos: ahora el mensaje puede traer tambien los bytes de un audio (los usa la descarga
    // con audios), y esos no se dibujan.
    const esFoto = mensaje.tipo === "IMAGE" || mensaje.tipo === "STICKER";
    if (esFoto && mensaje.medioBytes && mensaje.medioBytes.length > 0) {
      const clave = mensaje.medioUrl || mensaje.id;
      if (imagenes.has(clave)) {
        imagen = imagenes.get(clave) ?? null;
      } else {
        const formato = formatoDeImagen(mensaje.medioBytes);
        try {
          imagen = formato === "jpg" ? await doc.embedJpg(mensaje.medioBytes) : formato === "png" ? await doc.embedPng(mensaje.medioBytes) : null;
        } catch {
          // Una imagen rota no puede costar el PDF entero: se sigue con su enlace.
          imagen = null;
        }
        imagenes.set(clave, imagen);
      }
    }

    let anchoImagen = 0;
    let altoImagen = 0;
    if (imagen) {
      const escala = Math.min(anchoTexto / imagen.width, 240 / imagen.height, 1);
      anchoImagen = imagen.width * escala;
      altoImagen = imagen.height * escala;
    }

    const textoLimpio = mensaje.texto ? aTextoDePdf(mensaje.texto) : "";
    // Un mensaje que era solo emojis queda vacío después de limpiarlo: decirlo es mejor que
    // dejar una burbuja en blanco que parece un error.
    const cuerpo = textoLimpio || (mensaje.texto && mensaje.texto.trim() && !imagen ? "(emoji)" : "");
    const lineas = cuerpo ? partirEnLineas(cuerpo, normal, CUERPO, anchoTexto) : [];

    /*
      El enlace del medio.

      Un audio, un video o un documento lo llevan siempre: es la única forma de abrirlos desde el
      PDF. Una imagen solo lo lleva si no se pudo incrustar —un sticker webp, una foto que no bajó—
      porque cuando se ve la foto el enlace sobra (igual la propia foto queda clickeable).
    */
    const etiqueta = mensaje.medioUrl && !imagen ? etiquetaDelMedio(mensaje) : null;
    const conEnlace = Boolean(mensaje.medioUrl && etiqueta);
    const altoEnlace = conEnlace ? 16 : 0;

    /*
      Lo que se dice en la nota de voz. En el PDF pesa más que en ningún otro lado: el audio no
      suena adentro del archivo, así que el texto es lo único que se puede leer de él.

      Con tope de líneas: un audio de diez minutos haría una burbuja más alta que la hoja, que no
      se puede partir. El texto completo está en la descarga con audios.
    */
    const MAX_LINEAS_TRANSCRIPCION = 45;
    const transcripcion = mensaje.tipo === "AUDIO" && mensaje.transcripcion ? aTextoDePdf(mensaje.transcripcion) : "";
    let lineasTranscripcion = transcripcion ? partirEnLineas(`"${transcripcion}"`, cursiva, CUERPO, anchoTexto) : [];
    if (lineasTranscripcion.length > MAX_LINEAS_TRANSCRIPCION) {
      lineasTranscripcion = [...lineasTranscripcion.slice(0, MAX_LINEAS_TRANSCRIPCION), "[...]"];
    }
    const altoTranscripcion = lineasTranscripcion.length ? lineasTranscripcion.length * INTERLINEA + 3 : 0;

    const altoBurbuja =
      RELLENO +
      10 + // la línea de quién y a qué hora
      (altoImagen ? altoImagen + 6 : 0) +
      lineas.length * INTERLINEA +
      altoEnlace +
      altoTranscripcion +
      RELLENO;

    hoja.saltar(altoBurbuja + 6);

    const anchoContenido = Math.max(
      anchoImagen,
      ...lineas.map((linea) => normal.widthOfTextAtSize(linea, CUERPO)),
      ...lineasTranscripcion.map((linea) => cursiva.widthOfTextAtSize(linea, CUERPO)),
      conEnlace ? normal.widthOfTextAtSize(aTextoDePdf(etiqueta!), 8.5) + 14 : 0,
      110,
    );
    const anchoBurbuja = Math.min(BURBUJA_MAX, anchoContenido + RELLENO * 2);
    const x = mensaje.delCliente ? MARGEN : MARGEN + ANCHO_UTIL - anchoBurbuja;
    const arriba = hoja.y;

    hoja.actual.drawRectangle({
      x,
      y: arriba - altoBurbuja,
      width: anchoBurbuja,
      height: altoBurbuja,
      color: mensaje.delCliente ? GRIS : VERDE,
      borderColor: BORDE,
      borderWidth: 0.5,
    });

    let cursor = arriba - RELLENO;

    const quien = aTextoDePdf(
      `${mensaje.delCliente ? datos.titulo : "Nosotros"}  ${FECHA_CORTA.format(mensaje.cuando)}`,
    );
    hoja.actual.drawText(quien, { x: x + RELLENO, y: cursor - 7, size: META, font: negrita, color: TENUE });
    cursor -= 10;

    if (imagen) {
      hoja.actual.drawImage(imagen, {
        x: x + RELLENO,
        y: cursor - altoImagen - 4,
        width: anchoImagen,
        height: altoImagen,
      });
      // La foto también abre el original en grande.
      if (mensaje.medioUrl) {
        hoja.enlace(mensaje.medioUrl, x + RELLENO, cursor - altoImagen - 4, anchoImagen, altoImagen);
      }
      cursor -= altoImagen + 6;
    }

    for (const linea of lineas) {
      hoja.actual.drawText(linea, { x: x + RELLENO, y: cursor - CUERPO, size: CUERPO, font: normal, color: TINTA });
      cursor -= INTERLINEA;
    }

    if (conEnlace && mensaje.medioUrl) {
      const texto = aTextoDePdf(etiqueta!);
      const anchoEnlace = normal.widthOfTextAtSize(texto, 8.5) + 14;
      hoja.actual.drawRectangle({
        x: x + RELLENO,
        y: cursor - 13,
        width: anchoEnlace,
        height: 13,
        color: rgb(1, 1, 1),
        borderColor: BORDE,
        borderWidth: 0.5,
      });
      hoja.actual.drawText(texto, { x: x + RELLENO + 7, y: cursor - 9.5, size: 8.5, font: normal, color: ENLACE });
      hoja.enlace(mensaje.medioUrl, x + RELLENO, cursor - 13, anchoEnlace, 13);
      cursor -= altoEnlace;
    }

    if (lineasTranscripcion.length > 0) {
      cursor -= 3;
      for (const linea of lineasTranscripcion) {
        hoja.actual.drawText(linea, { x: x + RELLENO, y: cursor - CUERPO, size: CUERPO, font: cursiva, color: TINTA });
        cursor -= INTERLINEA;
      }
    }

    hoja.y = arriba - altoBurbuja - 6;
  }

  hoja.cerrar();

  // ── Pie ───────────────────────────────────────────────────────────────────────────────────
  const paginas = doc.getPages();
  const pie = aTextoDePdf(
    [
      `Descargado el ${FECHA_DIA.format(new Date())}`,
      datos.descargadoPor ? `por ${datos.descargadoPor}` : "",
    ]
      .filter(Boolean)
      .join(" "),
  );
  paginas.forEach((pagina, indice) => {
    pagina.drawText(pie, { x: MARGEN, y: MARGEN - 16, size: 7, font: normal, color: TENUE });
    const numero = `${indice + 1} / ${paginas.length}`;
    pagina.drawText(numero, {
      x: ANCHO - MARGEN - normal.widthOfTextAtSize(numero, 7),
      y: MARGEN - 16,
      size: 7,
      font: normal,
      color: TENUE,
    });
  });

  return doc.save();
}
