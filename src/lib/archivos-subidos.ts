import { open, type FileHandle } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

/*
  Servir un archivo de `public/uploads` (la ruta src/app/uploads/[...path]/route.ts).

  - Por partes (stream): un PDF de 24 MB ya no son 24 MB de memoria por pedido.
  - ETag y Last-Modified: el navegador pregunta "¿cambio?" y recibe un 304 sin bajar nada.
  - Range (un solo rango): 206. Sin esto Safari/iPhone no reproduce video ni deja adelantar un audio.
  - HEAD: los mismos encabezados sin cuerpo (lo usa la verificacion de la migracion).
  - Cache-Control segun el NOMBRE del archivo, no la carpeta:
      nombre unico (sha256 o marca de tiempo + uuid, ver esNombreUnico): `public, max-age=31536000,
      immutable`. Ese nombre nunca se reusa con otro contenido.
      cualquier otro (fotos de perfil, carta de colores, productos que se reemplazan con el mismo
      nombre): `private, max-age=0, must-revalidate` + ETag, asi un reemplazo se ve enseguida.

  Sin sesion a proposito: WAHA y Evolution descargan estos archivos por su URL publica al enviarlos
  (agent-actions.ts). La proteccion es el nombre imposible de adivinar.
*/

/*
  De que tipo es cada archivo.

  Estaban solo las imagenes, y todo lo demas salia como "application/octet-stream", que para un
  navegador significa "no se que es esto, bajalo". De ahi que un PDF se descargara en vez de
  abrirse: no era la burbuja del chat, era esta lista. Lo mismo valia para los audios y los
  videos que manda un cliente.
*/
const CONTENT_TYPES: Record<string, string> = {
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
  // Audios: los de WhatsApp son .oga/.ogg; los que se graban desde la app, .webm o .m4a.
  ".oga": "audio/ogg",
  ".ogg": "audio/ogg",
  ".opus": "audio/ogg",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".amr": "audio/amr",
  ".wav": "audio/wav",
  ".webm": "video/webm",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".3gp": "video/3gpp",
  ".txt": "text/plain; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".zip": "application/zip",
};

export function tipoDeContenido(rutaDelArchivo: string): string {
  return CONTENT_TYPES[path.extname(rutaDelArchivo).toLowerCase()] ?? "application/octet-stream";
}

export const CACHE_NOMBRE_UNICO = "public, max-age=31536000, immutable";
export const CACHE_REVALIDAR = "private, max-age=0, must-revalidate";

const NOMBRE_POR_HASH = /^[0-9a-f]{64}\.[A-Za-z0-9]{1,10}$/;
const NOMBRE_POR_HORA_Y_UUID = /^\d{13}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[A-Za-z0-9]{1,10}$/i;

/**
 * Nombres que nacen unicos y nunca se pisan con otro contenido: `<sha256>.<ext>`
 * (chat-media-storage) y `<Date.now()>-<uuid>.<ext>` (api/cliente/chats/upload-media).
 */
export function esNombreUnico(nombre: string): boolean {
  return NOMBRE_POR_HASH.test(nombre) || NOMBRE_POR_HORA_Y_UUID.test(nombre);
}

export function cacheControlPara(nombre: string): string {
  return esNombreUnico(nombre) ? CACHE_NOMBRE_UNICO : CACHE_REVALIDAR;
}

/**
 * La ruta en disco del pedido, o null si se sale de la carpeta. Compara con el separador: con un
 * `startsWith` a secas, `public/uploads-otra/...` pasaba por `public/uploads`.
 */
export function resolverRutaSubida(raiz: string, segmentos: string[]): string | null {
  if (!Array.isArray(segmentos) || segmentos.length === 0) return null;
  if (segmentos.some((segmento) => typeof segmento !== "string" || !segmento || segmento.includes("\0"))) return null;
  const base = path.resolve(raiz);
  const candidata = path.resolve(base, ...segmentos);
  if (!candidata.startsWith(base + path.sep)) return null;
  return candidata;
}

export function etagDe(tamano: number, modificadoMs: number): string {
  return `W/"${tamano.toString(16)}-${Math.floor(modificadoMs).toString(16)}"`;
}

function sinDebil(etiqueta: string) {
  return etiqueta.trim().replace(/^W\//, "");
}

/** If-None-Match: lista de etiquetas o `*`, comparacion debil. */
export function coincideEtag(cabecera: string | null, etag: string): boolean {
  if (!cabecera) return false;
  if (cabecera.trim() === "*") return true;
  const propia = sinDebil(etag);
  return cabecera.split(",").some((parte) => sinDebil(parte) === propia);
}

export type Rango = { desde: number; hasta: number };

/**
 * Un solo rango `bytes=a-b | a- | -n`. null = no hay Range que atender (sin cabecera, mal escrito o
 * con varios rangos: se manda el archivo entero, que la norma permite). "fuera" = no hay ningun byte
 * pedido dentro del archivo (416).
 */
export function leerRango(cabecera: string | null, tamano: number): Rango | "fuera" | null {
  if (!cabecera) return null;
  const encontrado = /^\s*bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*$/i.exec(cabecera);
  if (!encontrado) return null;
  const [, inicioTexto, finTexto] = encontrado;
  if (!inicioTexto && !finTexto) return null;

  if (!inicioTexto) {
    const ultimos = Number(finTexto);
    if (!Number.isSafeInteger(ultimos)) return null;
    if (ultimos === 0 || tamano === 0) return "fuera";
    return { desde: Math.max(0, tamano - ultimos), hasta: tamano - 1 };
  }

  const desde = Number(inicioTexto);
  const hastaPedido = finTexto ? Number(finTexto) : tamano - 1;
  if (!Number.isSafeInteger(desde) || !Number.isSafeInteger(hastaPedido)) return null;
  if (finTexto && hastaPedido < desde) return null;
  if (desde >= tamano) return "fuera";
  return { desde, hasta: Math.min(hastaPedido, tamano - 1) };
}

/** If-Range: con la misma etiqueta (o una fecha no anterior al archivo) se atiende el rango; si no, archivo entero. */
function ifRangeVale(cabecera: string | null, etag: string, modificadoSegundos: number): boolean {
  if (!cabecera) return true;
  const valor = cabecera.trim();
  if (valor.startsWith('"') || valor.startsWith("W/")) return sinDebil(valor) === sinDebil(etag);
  const fecha = Date.parse(valor);
  return Number.isFinite(fecha) && Math.floor(fecha / 1000) >= modificadoSegundos;
}

function noEncontrado() {
  return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
}

/**
 * La respuesta para `GET` o `HEAD` de un archivo de `raiz` (la carpeta `public/uploads`).
 */
export async function servirArchivoSubido(
  request: Request,
  segmentos: string[],
  opciones: { raiz: string; soloEncabezados?: boolean },
): Promise<Response> {
  const ruta = resolverRutaSubida(opciones.raiz, segmentos);
  if (!ruta) return noEncontrado();

  let archivo: FileHandle | null = null;
  try {
    archivo = await open(ruta, "r");
    const datos = await archivo.stat();
    if (!datos.isFile()) {
      await archivo.close();
      return noEncontrado();
    }

    const nombre = path.basename(ruta);
    const tamano = datos.size;
    const modificadoSegundos = Math.floor(datos.mtimeMs / 1000);
    const etag = etagDe(tamano, datos.mtimeMs);
    const encabezados = new Headers({
      "Content-Type": tipoDeContenido(ruta),
      "Cache-Control": cacheControlPara(nombre),
      ETag: etag,
      "Last-Modified": new Date(modificadoSegundos * 1000).toUTCString(),
      "Accept-Ranges": "bytes",
      "X-Content-Type-Options": "nosniff",
    });
    if (path.extname(nombre).toLowerCase() === ".svg") {
      // Un SVG abierto directo en el dominio podria correr codigo: se sirve sin permisos.
      encabezados.set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    }

    // ¿Ya lo tiene el navegador? If-None-Match manda sobre If-Modified-Since.
    const siNoCoincide = request.headers.get("if-none-match");
    const siModificadoDesde = request.headers.get("if-modified-since");
    const sinCambios = siNoCoincide
      ? coincideEtag(siNoCoincide, etag)
      : Boolean(siModificadoDesde) &&
        Number.isFinite(Date.parse(siModificadoDesde!)) &&
        Math.floor(Date.parse(siModificadoDesde!) / 1000) >= modificadoSegundos;
    if (sinCambios) {
      await archivo.close();
      const de304 = new Headers();
      for (const clave of ["Cache-Control", "ETag", "Last-Modified", "Content-Security-Policy"]) {
        const valor = encabezados.get(clave);
        if (valor) de304.set(clave, valor);
      }
      return new Response(null, { status: 304, headers: de304 });
    }

    let estado = 200;
    let desde = 0;
    let hasta = tamano - 1;
    const rango = ifRangeVale(request.headers.get("if-range"), etag, modificadoSegundos)
      ? leerRango(request.headers.get("range"), tamano)
      : null;
    if (rango === "fuera") {
      await archivo.close();
      encabezados.set("Content-Range", `bytes */${tamano}`);
      encabezados.set("Content-Length", "0");
      encabezados.delete("Content-Type");
      return new Response(null, { status: 416, headers: encabezados });
    }
    if (rango) {
      estado = 206;
      desde = rango.desde;
      hasta = rango.hasta;
      encabezados.set("Content-Range", `bytes ${desde}-${hasta}/${tamano}`);
    }
    const largo = tamano === 0 ? 0 : hasta - desde + 1;
    encabezados.set("Content-Length", String(largo));

    if (opciones.soloEncabezados || largo === 0) {
      await archivo.close();
      return new Response(null, { status: estado, headers: encabezados });
    }

    // El archivo se cierra solo al terminar de mandarlo o si el navegador corta.
    const lectura = archivo.createReadStream({ start: desde, end: hasta, autoClose: true });
    archivo = null;
    return new Response(Readable.toWeb(lectura) as unknown as ReadableStream<Uint8Array>, { status: estado, headers: encabezados });
  } catch {
    await archivo?.close().catch(() => {});
    return noEncontrado();
  }
}
