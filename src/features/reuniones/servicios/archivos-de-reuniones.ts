import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

/*
  DÓNDE VIVEN LOS AUDIOS DE LAS REUNIONES.

  En el volumen privado `aizenbot_reuniones`, montado en el CRM en /app/reuniones (REUNIONES_CARPETA)
  y en Egress en /out (LIVEKIT_EGRESS_CARPETA). Nunca en /uploads, que es público. En la base se
  guarda la ruta RELATIVA, que es la misma vista desde los dos contenedores.

  Pesa poco: unos 30 MB por hora de reunión.
*/

const ejecutar = promisify(execFile);

/** Hasta este tamaño un archivo va entero a OpenAI (su tope es 25 MB). */
export const TOPE_OPENAI_BYTES = 25 * 1024 * 1024;
/** Si pasa del tope, se parte en pedazos de 10 minutos. */
export const PEDAZO_SEGUNDOS = 10 * 60;
/** Lo más grande que se puede subir a mano. */
export const TOPE_SUBIDA_BYTES = 500 * 1024 * 1024;

export const EXTENSIONES_DE_AUDIO = ["m4a", "mp3", "wav", "ogg", "webm"] as const;

export function carpetaDeReuniones(): string {
  return path.resolve(process.env.REUNIONES_CARPETA?.trim() || path.join(process.cwd(), "reuniones"));
}

/** La carpeta donde escribe Egress, vista desde SU contenedor. */
export function carpetaDeEgress(): string {
  return (process.env.LIVEKIT_EGRESS_CARPETA?.trim() || "/out").replace(/\/+$/, "");
}

/** La ruta absoluta de un archivo, sin dejar salir de la carpeta de reuniones. */
export function rutaDeArchivo(relativa: string, base = carpetaDeReuniones()): string {
  const absoluta = path.resolve(base, relativa);
  if (absoluta !== base && !absoluta.startsWith(base + path.sep)) {
    throw new Error("Ruta de archivo fuera de la carpeta de reuniones.");
  }
  return absoluta;
}

/** Lo que devuelve Egress (/out/sala/x.ogg) pasado a ruta relativa (sala/x.ogg). */
export function relativaDesdeEgress(archivo: string, base = carpetaDeEgress()): string {
  const limpio = archivo.replace(/\\/g, "/");
  const prefijo = `${base}/`;
  return (limpio.startsWith(prefijo) ? limpio.slice(prefijo.length) : limpio).replace(/^\/+/, "");
}

export function extensionDeAudio(nombre: string): (typeof EXTENSIONES_DE_AUDIO)[number] | null {
  const extension = path.extname(nombre).slice(1).toLowerCase();
  return (EXTENSIONES_DE_AUDIO as readonly string[]).includes(extension)
    ? (extension as (typeof EXTENSIONES_DE_AUDIO)[number])
    : null;
}

export function tipoDeAudio(nombre: string): string {
  switch (path.extname(nombre).slice(1).toLowerCase()) {
    case "mp3":
      return "audio/mpeg";
    case "m4a":
      return "audio/mp4";
    case "wav":
      return "audio/wav";
    case "webm":
      return "audio/webm";
    default:
      return "audio/ogg";
  }
}

export function hayQuePartir(bytes: number): boolean {
  return bytes > TOPE_OPENAI_BYTES;
}

/** Los argumentos de ffmpeg para partir en pedazos de 10 minutos (mp3 mono liviano: ~5 MB cada uno). */
export function argumentosParaPartir(entrada: string, carpetaSalida: string): string[] {
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    entrada,
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-c:a",
    "libmp3lame",
    "-b:a",
    "48k",
    "-f",
    "segment",
    "-segment_time",
    String(PEDAZO_SEGUNDOS),
    "-reset_timestamps",
    "1",
    path.join(carpetaSalida, "pedazo-%03d.mp3"),
  ];
}

export type Pedazo = { ruta: string; desfaseMs: number };

/**
 * Los pedazos a mandar a OpenAI. Un archivo chico va entero; uno grande se parte con ffmpeg en una
 * carpeta temporal (hay que llamar a `limpiar` al terminar).
 */
export async function pedazosDeAudio(ruta: string): Promise<{ pedazos: Pedazo[]; limpiar: () => Promise<void> }> {
  const { size } = await stat(ruta);
  if (!hayQuePartir(size)) {
    return { pedazos: [{ ruta, desfaseMs: 0 }], limpiar: async () => {} };
  }
  const carpeta = await mkdtemp(path.join(os.tmpdir(), "reunion-"));
  const limpiar = () => rm(carpeta, { recursive: true, force: true });
  try {
    await ejecutar("ffmpeg", argumentosParaPartir(ruta, carpeta), { timeout: 10 * 60_000 });
    const nombres = (await readdir(carpeta)).filter((nombre) => nombre.startsWith("pedazo-")).sort();
    if (!nombres.length) {
      throw new Error("ffmpeg no dejó ningún pedazo.");
    }
    return {
      pedazos: nombres.map((nombre, indice) => ({ ruta: path.join(carpeta, nombre), desfaseMs: indice * PEDAZO_SEGUNDOS * 1000 })),
      limpiar,
    };
  } catch (error) {
    await limpiar();
    const codigo = (error as { code?: string }).code;
    throw new Error(codigo === "ENOENT" ? "Falta ffmpeg en el servidor para partir el audio." : `No se pudo partir el audio: ${String((error as Error).message).slice(0, 200)}`);
  }
}
