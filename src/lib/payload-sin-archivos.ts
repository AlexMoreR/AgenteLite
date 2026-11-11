/**
 * Encontrar y sacar el ARCHIVO en base64 del `rawPayload` de un mensaje.
 *
 * El gateway manda la foto, el audio, el video o el documento entero, en base64, adentro del evento
 * (WAHA en `data.base64`, Evolution API en `data.message.base64`, evogo en `data.Message.base64`).
 * Guardado en la base, ese texto era casi todo el peso de la tabla `Message` (~2 GB de 2,2 GB,
 * 10-nov-2026). Este modulo es puro (sin base ni disco): lo usan la red de `prisma.ts`
 * (mensaje-sin-archivos.ts) y la migracion de los mensajes viejos.
 *
 * Es RAPIDO a proposito: no recorre el JSON entero, mira solo las rutas donde los gateways ponen el
 * archivo (ver `contenedores`). Un mensaje de texto cuesta unas decenas de lecturas de propiedades.
 *
 * Solo se tocan las claves llamadas `base64` (o `Base64`) con mas de 4 KB. La miniatura
 * `jpegThumbnail`, la onda del audio (`waveform`), el id, el ack, el tipo, el mimetype, el nombre y
 * el tamano del archivo quedan como estaban: los usa la pantalla.
 */

/** Mismo umbral que `stripHeavyBase64` (chat-message-loader.ts): menos de esto no es un archivo. */
export const UMBRAL_BASE64 = 4096;

/**
 * La clave de primer nivel donde queda anotado que el archivo se guardo en disco.
 *
 * Ojo con los nombres de adentro: NO usar `url`, `mediaUrl`, `fileName`, `filename`, `mimetype` ni
 * `base64`. Hay lectores que buscan esas claves en TODO el JSON (exportar-conversacion.ts,
 * chat-inbox-media.ts) y tomarian este registro por el mensaje.
 */
export const CLAVE_ARCHIVOS_GUARDADOS = "archivosGuardados";

const CLAVES_BASE64 = ["base64", "Base64"] as const;
const CLAVES_DEL_MENSAJE = ["message", "Message"] as const;
const CLAVES_MIMETYPE = ["mimetype", "Mimetype", "mimeType", "MimeType"] as const;
const CLAVES_NOMBRE = ["fileName", "filename", "FileName", "title", "Title"] as const;
/** Tope de claves que se miran en un `message` (un mensaje real tiene 1 a 4). */
const MAX_CLAVES_DEL_MENSAJE = 40;
/** Tope de elementos si `data` llega como lista (algunos eventos de historial). */
const MAX_ELEMENTOS_DE_LISTA = 20;

type Registro = Record<string, unknown>;

export type ArchivoEnPayload = {
  /** Ruta de claves desde la raiz del payload hasta la clave `base64`. Los indices de lista van como texto. */
  ruta: string[];
  texto: string;
  mimetype: string | null;
  nombre: string | null;
};

export type ArchivoGuardado = {
  /** La ruta donde estaba el base64, con puntos: "evolution.data.base64". */
  ruta: string;
  /** Donde quedo el archivo: `/uploads/chat-media/<sha256>.<ext>`. */
  enlace: string;
  bytes: number;
  sha256: string;
  /** El tipo del archivo (el mimetype). Se llama `tipo` por lo de arriba. */
  tipo: string | null;
  /** Cuando se guardo, en ISO. */
  fecha: string;
};

function esRegistro(valor: unknown): valor is Registro {
  return Boolean(valor) && typeof valor === "object" && !Array.isArray(valor);
}

function leerTexto(registro: Registro | null, claves: readonly string[]): string | null {
  if (!registro) return null;
  for (const clave of claves) {
    const valor = registro[clave];
    if (typeof valor === "string" && valor.trim()) return valor.trim();
  }
  return null;
}

/** El primer bloque `<tipo>Message` de un mensaje (imageMessage, documentMessage, AudioMessage...). */
function bloqueDeMedia(mensaje: Registro | null): Registro | null {
  if (!mensaje) return null;
  let vistas = 0;
  for (const clave in mensaje) {
    if (++vistas > MAX_CLAVES_DEL_MENSAJE) break;
    const valor = mensaje[clave];
    if (/message$/i.test(clave) && esRegistro(valor)) {
      // documentWithCaptionMessage / viewOnceMessage traen el bloque de verdad un nivel mas abajo.
      const interno = esRegistro(valor.message) ? bloqueDeMedia(valor.message) : null;
      return interno ?? valor;
    }
  }
  return null;
}

type Contenedor = { ruta: string[]; objeto: Registro; mimetype: string | null; nombre: string | null };

/**
 * Los objetos donde los gateways ponen el `base64`, con el mimetype y el nombre del archivo que
 * corresponden. Lista fija de rutas, NO un recorrido del JSON:
 *
 *   <raiz> | <raiz>.evolution        (lo que guarda el webhook es `{ source, evolution: payload }`)
 *     . | .data | .data[i]           (el evento, o el registro del historial)
 *       . | .message | .Message      (Evolution API / evogo)
 *         .<tipo>Message [.message.<tipo>Message]
 */
function contenedores(raiz: Registro): Contenedor[] {
  const salida: Contenedor[] = [];
  const bases: Array<{ ruta: string[]; objeto: Registro }> = [];

  const agregarBase = (ruta: string[], objeto: unknown) => {
    if (esRegistro(objeto)) bases.push({ ruta, objeto });
  };
  const raices: Array<{ ruta: string[]; objeto: Registro }> = [{ ruta: [], objeto: raiz }];
  if (esRegistro(raiz.evolution)) raices.push({ ruta: ["evolution"], objeto: raiz.evolution });

  for (const { ruta, objeto } of raices) {
    agregarBase(ruta, objeto);
    const data = objeto.data;
    if (Array.isArray(data)) {
      data.slice(0, MAX_ELEMENTOS_DE_LISTA).forEach((item, indice) => agregarBase([...ruta, "data", String(indice)], item));
    } else {
      agregarBase([...ruta, "data"], data);
    }
  }

  for (const base of bases) {
    const mensajes = CLAVES_DEL_MENSAJE.map((clave) => ({ clave, objeto: base.objeto[clave] })).filter(
      (m): m is { clave: (typeof CLAVES_DEL_MENSAJE)[number]; objeto: Registro } => esRegistro(m.objeto),
    );
    const media = bloqueDeMedia(mensajes[0]?.objeto ?? null);
    const mimetypeDeLaBase = leerTexto(media, CLAVES_MIMETYPE) ?? leerTexto(base.objeto, CLAVES_MIMETYPE);
    const nombreDeLaBase = leerTexto(media, CLAVES_NOMBRE) ?? leerTexto(base.objeto, CLAVES_NOMBRE);

    salida.push({ ruta: base.ruta, objeto: base.objeto, mimetype: mimetypeDeLaBase, nombre: nombreDeLaBase });

    for (const mensaje of mensajes) {
      const rutaDelMensaje = [...base.ruta, mensaje.clave];
      salida.push({ ruta: rutaDelMensaje, objeto: mensaje.objeto, mimetype: mimetypeDeLaBase, nombre: nombreDeLaBase });
      let vistas = 0;
      for (const clave in mensaje.objeto) {
        if (++vistas > MAX_CLAVES_DEL_MENSAJE) break;
        const bloque = mensaje.objeto[clave];
        if (!/message$/i.test(clave) || !esRegistro(bloque)) continue;
        salida.push({
          ruta: [...rutaDelMensaje, clave],
          objeto: bloque,
          mimetype: leerTexto(bloque, CLAVES_MIMETYPE) ?? mimetypeDeLaBase,
          nombre: leerTexto(bloque, CLAVES_NOMBRE) ?? nombreDeLaBase,
        });
        if (esRegistro(bloque.message)) {
          let vistasInternas = 0;
          for (const claveInterna in bloque.message) {
            if (++vistasInternas > MAX_CLAVES_DEL_MENSAJE) break;
            const interno = (bloque.message as Registro)[claveInterna];
            if (!/message$/i.test(claveInterna) || !esRegistro(interno)) continue;
            salida.push({
              ruta: [...rutaDelMensaje, clave, "message", claveInterna],
              objeto: interno,
              mimetype: leerTexto(interno, CLAVES_MIMETYPE) ?? mimetypeDeLaBase,
              nombre: leerTexto(interno, CLAVES_NOMBRE) ?? nombreDeLaBase,
            });
          }
        }
      }
    }
  }

  return salida;
}

/**
 * Los archivos en base64 que trae un payload, en las rutas conocidas. Lista vacia si no hay
 * (el 99 % de los mensajes: texto). Nunca lanza.
 */
export function buscarArchivosEnPayload(valor: unknown): ArchivoEnPayload[] {
  if (!esRegistro(valor)) return [];
  const encontrados: ArchivoEnPayload[] = [];
  const vistas = new Set<string>();
  try {
    for (const contenedor of contenedores(valor)) {
      for (const clave of CLAVES_BASE64) {
        const texto = contenedor.objeto[clave];
        if (typeof texto !== "string" || texto.length <= UMBRAL_BASE64) continue;
        const ruta = [...contenedor.ruta, clave];
        const id = ruta.join("\u0000");
        if (vistas.has(id)) continue;
        vistas.add(id);
        encontrados.push({ ruta, texto, mimetype: contenedor.mimetype, nombre: contenedor.nombre });
      }
    }
  } catch {
    return [];
  }
  return encontrados;
}

/**
 * Una copia del payload SIN esas claves `base64` y con el registro `archivosGuardados` en la raiz
 * (se suma a uno que ya hubiera). No modifica el original: el webhook sigue usando el payload que
 * tiene en memoria para la IA, la transcripcion y el `mediaUrl`. Solo se copian los objetos que
 * estan en el camino de cada ruta; el resto se comparte.
 */
export function quitarArchivosDelPayload<T>(valor: T, guardados: Array<ArchivoGuardado & { rutaClaves: string[] }>): T {
  if (!esRegistro(valor) || guardados.length === 0) return valor;
  const raiz: Registro = { ...valor };

  for (const guardado of guardados) {
    let actual: Registro | unknown[] = raiz;
    let valido = true;
    for (let i = 0; i < guardado.rutaClaves.length - 1; i += 1) {
      const clave = guardado.rutaClaves[i];
      const siguiente: unknown = Array.isArray(actual) ? actual[Number(clave)] : (actual as Registro)[clave];
      if (!siguiente || typeof siguiente !== "object") {
        valido = false;
        break;
      }
      const copia: Registro | unknown[] = Array.isArray(siguiente) ? [...siguiente] : { ...(siguiente as Registro) };
      if (Array.isArray(actual)) actual[Number(clave)] = copia;
      else (actual as Registro)[clave] = copia;
      actual = copia;
    }
    const ultima = guardado.rutaClaves.at(-1);
    if (valido && ultima !== undefined && esRegistro(actual)) {
      delete actual[ultima];
    }
  }

  const previos = Array.isArray(raiz[CLAVE_ARCHIVOS_GUARDADOS]) ? (raiz[CLAVE_ARCHIVOS_GUARDADOS] as unknown[]) : [];
  raiz[CLAVE_ARCHIVOS_GUARDADOS] = [
    ...previos,
    ...guardados.map(({ ruta, enlace, bytes, sha256, tipo, fecha }) => ({ ruta, enlace, bytes, sha256, tipo, fecha })),
  ];
  return raiz as T;
}

/**
 * Los bytes de un base64 (con o sin prefijo `data:...;base64,`), comprobando que el texto sea
 * base64 de verdad y que el largo cuadre: `bytes = floor(largo * 3 / 4) - relleno`. Si no cuadra
 * devuelve null (un base64 roto no se guarda ni se quita: queda como estaba).
 */
export function decodificarBase64(texto: string): { bytes: Buffer; mimetype: string | null } | null {
  let cuerpo = texto;
  let mimetype: string | null = null;
  if (/^data:/i.test(cuerpo.slice(0, 5))) {
    const coma = cuerpo.indexOf(",");
    if (coma < 0) return null;
    const cabecera = cuerpo.slice(5, coma);
    if (!/;base64/i.test(cabecera)) return null;
    mimetype = cabecera.split(";")[0]?.trim() || null;
    cuerpo = cuerpo.slice(coma + 1);
  }
  if (/\s/.test(cuerpo)) cuerpo = cuerpo.replace(/\s+/g, "");
  if (!cuerpo || !/^[A-Za-z0-9+/\-_]+={0,2}$/.test(cuerpo)) return null;
  const relleno = cuerpo.endsWith("==") ? 2 : cuerpo.endsWith("=") ? 1 : 0;
  // Sin relleno (base64url) el largo se completa a multiplo de 4.
  const largo = relleno ? cuerpo.length : Math.ceil(cuerpo.length / 4) * 4;
  if (cuerpo.length % 4 === 1) return null;
  const esperados = Math.floor((largo * 3) / 4) - (relleno || largo - cuerpo.length);
  const bytes = Buffer.from(cuerpo, cuerpo.includes("-") || cuerpo.includes("_") ? "base64url" : "base64");
  if (bytes.length === 0 || bytes.length !== esperados) return null;
  return { bytes, mimetype };
}

/** La ruta como la entiende Postgres en `#-` y `#>>`: `{evolution,data,base64}`. */
export function rutaComoTextoDePostgres(ruta: string[]): string {
  return `{${ruta.map((parte) => (/^[A-Za-z0-9_]+$/.test(parte) ? parte : `"${parte.replace(/(["\\])/g, "\\$1")}"`)).join(",")}}`;
}

/**
 * Las rutas que se recortan al LEER (chat-message-loader.ts, ultimo-mensaje-de-chats.ts): las de
 * los tres gateways y las del historial. Borrar una ruta que no existe no hace nada.
 */
export const RUTAS_DE_ARCHIVO_CONOCIDAS: string[][] = [
  ["evolution", "data", "base64"],
  ["evolution", "data", "message", "base64"],
  ["evolution", "data", "Message", "base64"],
  ["evolution", "message", "base64"],
  ["evolution", "Message", "base64"],
  ["evolution", "base64"],
];

/** Desde que peso se recorta en SQL. `pg_column_size` no descomprime: lee el tamano guardado. */
export const PESO_PARA_RECORTAR_EN_SQL = 65536;

/**
 * Expresion SQL que devuelve la columna sin el base64 en las rutas conocidas, solo para las filas
 * pesadas (las demas salen tal cual, sin trabajo extra). Asi el archivo no viaja de la base a Node.
 * `columna` es una expresion fija del codigo (nunca un dato de afuera), p. ej. `m."rawPayload"`.
 */
export function sqlPayloadSinArchivos(columna: string): string {
  const recortado = RUTAS_DE_ARCHIVO_CONOCIDAS.reduce(
    (expresion, ruta) => `(${expresion} #- '${rutaComoTextoDePostgres(ruta)}')`,
    columna,
  );
  return `CASE WHEN pg_column_size(${columna}) > ${PESO_PARA_RECORTAR_EN_SQL} THEN ${recortado} ELSE ${columna} END`;
}
