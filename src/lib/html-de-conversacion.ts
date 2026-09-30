import type { MensajeExportado } from "@/lib/exportar-conversacion";

/**
 * La conversación como página web descargable, con las notas de voz reproducibles ahí mismo.
 *
 * Existe porque un PDF no puede hacerlo: el formato admite audio adentro, pero Chrome, Edge, el
 * visor del celular y la vista previa de WhatsApp lo ignoran, y las notas de WhatsApp vienen en
 * .ogg, que ni Acrobat lee. Alex pidió poder escuchar los audios sin que se abra otra pestaña
 * (29-09-2026); una página web lo hace en cualquier navegador.
 *
 * Es UN solo archivo, sin nada afuera: las fotos y los audios van adentro en base64, para que se
 * pueda guardar, reenviar y abrir sin internet, aunque después se borre algo del servidor. Lo que
 * no entra -un video, un documento, un audio que pasó el tope- queda enlazado.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * SIN SCRIPTS, Y CON EL CANDADO PUESTO
 *
 * El texto lo escribieron los clientes, y el archivo se abre en el navegador de quien lo baje.
 * Todo se escapa, y además la página declara una política que PROHÍBE ejecutar scripts: aunque se
 * colara algo, el navegador no lo corre. La página no necesita ninguno -el reproductor de audio
 * es el del propio navegador-.
 * ────────────────────────────────────────────────────────────────────────────────────────────
 */

export type DatosDelHtml = {
  titulo: string;
  telefono: string | null;
  mensajes: MensajeExportado[];
  descargadoPor: string | null;
};

const FECHA_DIA = new Intl.DateTimeFormat("es-CO", {
  timeZone: "America/Bogota",
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});
const FECHA_HORA = new Intl.DateTimeFormat("es-CO", {
  timeZone: "America/Bogota",
  hour: "2-digit",
  minute: "2-digit",
});

function escapar(valor: string) {
  return valor
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Solo enlaces http(s): un `javascript:` escrito en un mensaje no puede terminar en un href. */
function urlSegura(valor: string | null) {
  if (!valor || !/^https?:\/\//i.test(valor)) {
    return null;
  }
  return escapar(valor);
}

/**
 * El tipo real del archivo, mirando sus primeros bytes.
 *
 * El proxy de medios a veces lo entrega como `application/octet-stream`, y un `<audio>` con ese
 * tipo no suena: el navegador no sabe qué decodificador usar.
 */
function tipoReal(bytes: Uint8Array, declarado: string | null, familia: "audio" | "image") {
  const empieza = (...firma: number[]) => firma.every((byte, i) => bytes[i] === byte);
  const texto = (desde: number, largo: number) => String.fromCharCode(...bytes.slice(desde, desde + largo));

  if (familia === "audio") {
    if (texto(0, 4) === "OggS") return "audio/ogg";
    if (texto(0, 3) === "ID3" || empieza(0xff, 0xfb) || empieza(0xff, 0xf3) || empieza(0xff, 0xf2)) return "audio/mpeg";
    if (texto(4, 4) === "ftyp") return "audio/mp4";
    if (texto(0, 4) === "RIFF") return "audio/wav";
    if (empieza(0xff, 0xf1) || empieza(0xff, 0xf9)) return "audio/aac";
  } else {
    if (empieza(0xff, 0xd8, 0xff)) return "image/jpeg";
    if (empieza(0x89, 0x50, 0x4e, 0x47)) return "image/png";
    if (texto(0, 4) === "RIFF" && texto(8, 4) === "WEBP") return "image/webp";
    if (texto(0, 3) === "GIF") return "image/gif";
  }

  return declarado && declarado.startsWith(`${familia}/`) ? declarado : null;
}

function comoDataUrl(bytes: Uint8Array, tipo: string) {
  return `data:${tipo};base64,${Buffer.from(bytes).toString("base64")}`;
}

function duracion(segundos: number | null) {
  if (!segundos || !Number.isFinite(segundos) || segundos <= 0) {
    return "";
  }
  const minutos = Math.floor(segundos / 60);
  const resto = Math.floor(segundos % 60);
  return `${minutos}:${String(resto).padStart(2, "0")}`;
}

function enlace(url: string | null, texto: string) {
  const segura = urlSegura(url);
  if (!segura) {
    return `<span class="sin-medio">${escapar(texto)} (no disponible)</span>`;
  }
  return `<a class="enlace" href="${segura}" target="_blank" rel="noopener noreferrer">${escapar(texto)}</a>`;
}

/** Lo que va arriba del texto: la foto, el reproductor o el enlace. */
function medio(mensaje: MensajeExportado): string {
  const { tipo, medioBytes, medioTipo, medioUrl } = mensaje;

  if (tipo === "IMAGE" || tipo === "STICKER") {
    const real = medioBytes ? tipoReal(medioBytes, medioTipo, "image") : null;
    if (medioBytes && real) {
      return `<img class="${tipo === "STICKER" ? "sticker" : "foto"}" src="${comoDataUrl(medioBytes, real)}" alt="Imagen">`;
    }
    // No se pudo meter adentro: se muestra desde el servidor. Necesita internet, pero sigue
    // viéndose en la burbuja en vez de ser un enlace más.
    const segura = urlSegura(medioUrl);
    return segura ? `<img class="foto" src="${segura}" alt="Imagen" loading="lazy">` : "";
  }

  if (tipo === "AUDIO") {
    const etiqueta = ["Nota de voz", duracion(mensaje.audioSegundos)].filter(Boolean).join(" · ");
    const real = medioBytes ? tipoReal(medioBytes, medioTipo, "audio") : null;
    if (medioBytes && real) {
      return `<div class="audio"><span class="etiqueta">${escapar(etiqueta)}</span><audio controls preload="none" src="${comoDataUrl(medioBytes, real)}"></audio></div>`;
    }
    // Pasó el tope o no bajó: se reproduce igual desde el servidor, ahí mismo, con internet.
    const segura = urlSegura(medioUrl);
    return segura
      ? `<div class="audio"><span class="etiqueta">${escapar(etiqueta)} · necesita internet</span><audio controls preload="none" src="${segura}"></audio></div>`
      : `<span class="sin-medio">${escapar(etiqueta)} (no disponible)</span>`;
  }

  if (tipo === "VIDEO") {
    return enlace(medioUrl, "Video · Abrir");
  }

  if (tipo === "DOCUMENT") {
    return enlace(medioUrl, `${mensaje.archivoNombre || "Documento"} · Abrir`);
  }

  return "";
}

const ESTILOS = `
:root {
  --fondo: #efeae2;
  --tarjeta: #ffffff;
  --cliente: #ffffff;
  --nuestro: #d9fdd3;
  --tinta: #111b21;
  --tenue: #667781;
  --borde: #e2e5e9;
  --enlace: #027eb5;
  --pastilla: #ffffffd9;
}
@media (prefers-color-scheme: dark) {
  :root {
    --fondo: #0b141a;
    --tarjeta: #111b21;
    --cliente: #202c33;
    --nuestro: #005c4b;
    --tinta: #e9edef;
    --tenue: #8696a0;
    --borde: #2a3942;
    --enlace: #53bdeb;
    --pastilla: #182229;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--fondo);
  color: var(--tinta);
  font: 14.5px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
main { max-width: 760px; margin: 0 auto; padding: 16px 16px 40px; }
header {
  background: var(--tarjeta);
  border: 1px solid var(--borde);
  border-radius: 8px;
  padding: 14px 16px;
  margin-bottom: 16px;
}
h1 { margin: 0 0 4px; font-size: 18px; text-wrap: balance; }
header p { margin: 0; color: var(--tenue); font-size: 12.5px; }
.dia {
  display: block;
  width: fit-content;
  margin: 18px auto 10px;
  padding: 4px 12px;
  background: var(--pastilla);
  border-radius: 8px;
  color: var(--tenue);
  font-size: 12px;
}
.fila { display: flex; margin: 3px 0; }
.fila.nuestro { justify-content: flex-end; }
.burbuja {
  max-width: min(78%, 480px);
  padding: 6px 9px 7px;
  border-radius: 8px;
  background: var(--cliente);
  box-shadow: 0 1px 0.5px rgba(11, 20, 26, 0.13);
  overflow-wrap: anywhere;
}
.nuestro .burbuja { background: var(--nuestro); }
.quien { display: block; margin-bottom: 2px; color: var(--tenue); font-size: 11.5px; font-weight: 600; }
.texto { white-space: pre-wrap; }
.foto { display: block; max-width: 100%; max-height: 360px; border-radius: 6px; margin: 2px 0 4px; }
.sticker { display: block; width: 140px; height: auto; margin: 2px 0; }
.audio { display: flex; flex-direction: column; gap: 4px; margin: 2px 0 4px; }
.audio audio { width: 280px; max-width: 100%; height: 40px; }
.etiqueta { color: var(--tenue); font-size: 12px; }
.transcripcion {
  margin: 2px 0 4px;
  padding-top: 4px;
  border-top: 1px solid var(--borde);
  font-style: italic;
  white-space: pre-wrap;
  font-size: 13.5px;
}
.enlace {
  display: inline-block;
  margin: 2px 0 4px;
  padding: 3px 9px;
  border: 1px solid var(--borde);
  border-radius: 6px;
  color: var(--enlace);
  text-decoration: none;
  font-size: 13px;
}
.enlace:hover { text-decoration: underline; }
.enlace:focus-visible { outline: 2px solid var(--enlace); outline-offset: 2px; }
.sin-medio { color: var(--tenue); font-size: 12.5px; font-style: italic; }
footer { margin-top: 24px; color: var(--tenue); font-size: 12px; text-align: center; }
@media print {
  body { background: #fff; }
  .burbuja { box-shadow: none; border: 1px solid #ddd; }
  audio { display: none; }
}
`;

export function construirHtmlDeConversacion(datos: DatosDelHtml): string {
  const primero = datos.mensajes[0];
  const ultimo = datos.mensajes[datos.mensajes.length - 1];
  const rango = primero && ultimo ? `${FECHA_DIA.format(primero.cuando)} al ${FECHA_DIA.format(ultimo.cuando)}` : "";

  const cuerpo: string[] = [];
  let diaDibujado = "";

  for (const mensaje of datos.mensajes) {
    const dia = FECHA_DIA.format(mensaje.cuando);
    if (dia !== diaDibujado) {
      diaDibujado = dia;
      cuerpo.push(`<span class="dia">${escapar(dia)}</span>`);
    }

    const texto = mensaje.texto?.trim() ?? "";
    // En un documento el "texto" suele ser el nombre del archivo, que ya sale en su enlace.
    const repetido = mensaje.tipo === "DOCUMENT" && texto && texto === mensaje.archivoNombre;
    const quien = `${mensaje.delCliente ? datos.titulo : "Nosotros"} · ${FECHA_HORA.format(mensaje.cuando)}`;

    cuerpo.push(
      `<div class="fila ${mensaje.delCliente ? "cliente" : "nuestro"}"><div class="burbuja">` +
        `<span class="quien">${escapar(quien)}</span>` +
        medio(mensaje) +
        (mensaje.tipo === "AUDIO" && mensaje.transcripcion
          ? `<div class="transcripcion">${escapar(mensaje.transcripcion)}</div>`
          : "") +
        (texto && !repetido ? `<div class="texto">${escapar(texto)}</div>` : "") +
        `</div></div>`,
    );
  }

  const subtitulo = [
    datos.telefono ? `WhatsApp ${datos.telefono}` : "WhatsApp",
    `${datos.mensajes.length} mensajes`,
    rango,
  ]
    .filter(Boolean)
    .join(" · ");

  const pie = [`Descargado el ${FECHA_DIA.format(new Date())}`, datos.descargadoPor ? `por ${datos.descargadoPor}` : ""]
    .filter(Boolean)
    .join(" ");

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: https:; media-src data: https:; style-src 'unsafe-inline'">
<meta name="robots" content="noindex">
<title>${escapar(`Conversación con ${datos.titulo}`)}</title>
<style>${ESTILOS}</style>
</head>
<body>
<main>
<header>
<h1>${escapar(datos.titulo)}</h1>
<p>${escapar(subtitulo)}</p>
</header>
${cuerpo.join("\n")}
<footer>${escapar(pie)}</footer>
</main>
</body>
</html>
`;
}
