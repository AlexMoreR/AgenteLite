/*
  ¿Se puede leer el archivo de un envio? (notas de voz desde el iPhone, 11-nov-2026)

  Alex no podia mandar notas de voz desde el iPhone: la burbuja quedaba en "No se envió · No se
  pudo subir el audio. No se recibió ningún archivo." y Reintentar fallaba siempre igual. El
  servidor estaba bien. Lo mas probable: la nota se retomo del navegador (envios-guardados.ts,
  IndexedDB) despues de una recarga y Safari devolvio un archivo que dice pesar algo pero no se
  puede leer; el formulario salia sin el archivo adentro.

  Por eso, antes de subir se lee el archivo entero (arrayBuffer) y se mira que tenga bytes. Si no,
  no se sube ni se ofrece Reintentar: ese archivo no va a volver. En el navegador se guardan los
  BYTES (ArrayBuffer + tipo + nombre) y no el Blob, que es lo que Safari pierde.

  Sin imports: se prueba con Node solo (scripts/check-archivo-legible.mjs).
*/

export const MOTIVO_NOTA_PERDIDA = "Esta nota se perdió al recargar la app; grábala de nuevo.";
export const MOTIVO_ARCHIVO_PERDIDO = "Este archivo se perdió al recargar la app; vuelve a elegirlo.";
export const MOTIVO_NOTA_ILEGIBLE = "No se pudo leer la nota de voz; grábala de nuevo.";
export const MOTIVO_ARCHIVO_ILEGIBLE = "No se pudo leer el archivo; vuelve a elegirlo.";

export const MENSAJE_MICROFONO_OCUPADO =
  "El micrófono está en uso (¿llamada en curso?). Corta la llamada o vuelve a intentar.";
export const MENSAJE_MICROFONO_SIN_PERMISO =
  "El navegador no dejó usar el micrófono. Dale permiso en los ajustes y vuelve a intentar.";

/** El motivo de la burbuja roja de un archivo que no se puede leer. */
export function motivoDeArchivoPerdido(tipo: string, alRecargar: boolean): string {
  if (tipo === "AUDIO") {
    return alRecargar ? MOTIVO_NOTA_PERDIDA : MOTIVO_NOTA_ILEGIBLE;
  }
  return alRecargar ? MOTIVO_ARCHIVO_PERDIDO : MOTIVO_ARCHIVO_ILEGIBLE;
}

export type LecturaDeArchivo =
  | { ok: true; bytes: ArrayBuffer }
  | { ok: false; motivo: "no-es-archivo" | "vacio" | "no-se-pudo-leer" };

/*
  Lee el archivo entero. Solo es legible si es un Blob (o File), pesa mas de 0 y lo leido trae
  exactamente lo que dice pesar: Safari puede decir "320 KB" y fallar (o traer 0) al leerlo.
*/
export async function leerArchivoEntero(archivo: unknown): Promise<LecturaDeArchivo> {
  const blob = archivo as Blob | null | undefined;
  if (!blob || typeof blob !== "object" || typeof blob.arrayBuffer !== "function" || typeof blob.size !== "number") {
    return { ok: false, motivo: "no-es-archivo" };
  }
  if (!(blob.size > 0)) {
    return { ok: false, motivo: "vacio" };
  }
  try {
    const bytes = await blob.arrayBuffer();
    if (!bytes || typeof bytes.byteLength !== "number" || bytes.byteLength <= 0 || bytes.byteLength !== blob.size) {
      return { ok: false, motivo: "no-se-pudo-leer" };
    }
    return { ok: true, bytes };
  } catch {
    return { ok: false, motivo: "no-se-pudo-leer" };
  }
}

/** Como se guarda un archivo en el navegador: los bytes y sus datos, no el Blob. */
export type ArchivoGuardado = {
  formato: 1;
  bytes: ArrayBuffer;
  tipo: string;
  nombre: string;
  modificadoEn: number;
};

export function esArchivoGuardado(valor: unknown): valor is ArchivoGuardado {
  const guardado = valor as Partial<ArchivoGuardado> | null | undefined;
  return Boolean(
    guardado &&
      typeof guardado === "object" &&
      guardado.formato === 1 &&
      guardado.bytes &&
      typeof guardado.bytes.byteLength === "number" &&
      typeof guardado.tipo === "string" &&
      typeof guardado.nombre === "string",
  );
}

export function comoArchivoGuardado(
  bytes: ArrayBuffer,
  datos: { tipo: string; nombre: string; modificadoEn?: number },
): ArchivoGuardado {
  return {
    formato: 1,
    bytes,
    tipo: datos.tipo,
    nombre: datos.nombre,
    modificadoEn: typeof datos.modificadoEn === "number" ? datos.modificadoEn : Date.now(),
  };
}

/** El File de vuelta, con su nombre y tipo. */
export function archivoDesdeGuardado(guardado: ArchivoGuardado, nombreDeRespaldo: string): File {
  return new File([guardado.bytes], guardado.nombre || nombreDeRespaldo, {
    type: guardado.tipo,
    lastModified: guardado.modificadoEn,
  });
}

/*
  Nombre y tipo de la nota de voz. Safari y el iPhone graban `audio/mp4` (a veces lo dicen
  `video/mp4` o no dicen nada): va como `nota.m4a` / `audio/mp4`, que es lo que acepta la subida.
  Sin tipo, en un equipo Apple se asume `audio/mp4`; en los demas, `audio/webm` como antes.
*/
export function tipoDeNotaDeVoz(mimeDelGrabador: string, esApple: boolean): { tipo: string; extension: string } {
  const base = (mimeDelGrabador || "").split(";")[0].trim().toLowerCase();
  if (!base) {
    return esApple ? { tipo: "audio/mp4", extension: "m4a" } : { tipo: "audio/webm", extension: "webm" };
  }
  if (base.includes("mp4") || base.includes("m4a") || base.includes("aac")) return { tipo: "audio/mp4", extension: "m4a" };
  if (base.includes("ogg") || base.includes("opus")) return { tipo: base.startsWith("audio/") ? base : "audio/ogg", extension: "ogg" };
  if (base.includes("mpeg") || base.includes("mp3")) return { tipo: "audio/mpeg", extension: "mp3" };
  if (base.includes("wav")) return { tipo: "audio/wav", extension: "wav" };
  return { tipo: base.startsWith("audio/") ? base : "audio/webm", extension: "webm" };
}

/*
  "Subir audio" (Alex, 12-nov-2026: "no tengo la opción de subir audio"): un audio que ya existe
  -una nota de voz guardada, un mp3, un audio de WhatsApp (.opus)- sale como nota de voz.

  El tipo del archivo no es confiable: Windows suele entregar el .m4a como "audio/x-m4a", el .opus
  sin tipo, y algunos celulares mandan "application/octet-stream". Se mira el tipo y, si no dice
  nada, la extension. Devuelve el tipo que acepta el servidor (upload-audio) o null si no es audio.
*/
export const ACCEPT_AUDIOS = "audio/*,.mp3,.m4a,.aac,.ogg,.opus,.oga,.wav,.webm";
export const MAXIMO_AUDIO_BYTES = 16 * 1024 * 1024;

export function tipoDeAudioElegido(nombre: string, tipoDelArchivo: string): { tipo: string; extension: string } | null {
  const base = (tipoDelArchivo || "").split(";")[0].trim().toLowerCase();
  const extension = (/\.([a-z0-9]+)$/i.exec(nombre || "")?.[1] ?? "").toLowerCase();
  // Un tipo de audio conocido manda; "audio/amr" y similares no los acepta el servidor.
  if (base.startsWith("audio/") && /mp4|m4a|aac|ogg|opus|mpeg|mp3|wav|webm/.test(base)) {
    return tipoDeNotaDeVoz(base, false);
  }
  switch (extension) {
    case "mp3":
      return { tipo: "audio/mpeg", extension: "mp3" };
    case "m4a":
    case "aac":
      return { tipo: "audio/mp4", extension: "m4a" };
    case "ogg":
    case "oga":
    case "opus":
      return { tipo: "audio/ogg", extension: "ogg" };
    case "wav":
      return { tipo: "audio/wav", extension: "wav" };
    case "webm":
      return { tipo: "audio/webm", extension: "webm" };
    default:
      return null;
  }
}

/** El error del servidor cuando el formulario llego sin el archivo (upload-audio/route.ts). */
export function esFaltaDeArchivo(error: string | null | undefined): boolean {
  return /no se recibi[oó] ning[uú]n archivo/i.test(error ?? "");
}

/*
  Si fallo el microfono al empezar: sin permiso es una cosa; ocupado (una llamada de WhatsApp lo
  tiene tomado, NotReadableError / AbortError en Safari) u otra falla, es el aviso de llamada.
*/
export function mensajeDeFallaDelMicrofono(error: unknown): string {
  const nombre = (error as { name?: unknown } | null | undefined)?.name;
  if (nombre === "NotAllowedError" || nombre === "SecurityError") {
    return MENSAJE_MICROFONO_SIN_PERMISO;
  }
  return MENSAJE_MICROFONO_OCUPADO;
}
