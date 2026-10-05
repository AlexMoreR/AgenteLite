import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/*
  AUDIOS QUE SUENAN EN TODOS LADOS.

  Los audios del chat llegaban en tres formatos y cada navegador fallaba con alguno (medido el
  05-10-2026, una semana):
    - 291 `.webm` grabados desde Chrome: el iPhone no los reproduce.
    - 161 `.ogg` (opus) que manda WhatsApp: iPhones con Safari viejo no los reproducen.
    - 138 `.m4a` grabados desde iPhone: son MP4 FRAGMENTADO, sin la duracion en la cabecera;
      Chrome los muestra en 0:00 y a veces el play no hace nada.

  Se guarda una copia en AAC dentro de un `.m4a` normal, con el indice al principio
  (`+faststart`): es el unico formato que reproducen Chrome, Safari, Android y el iPhone, y el
  navegador sabe la duracion apenas baja la cabecera. Para mandarlo a WhatsApp no cambia nada: WAHA
  lo convierte a nota de voz por su cuenta (`convert: true`).

  Si algo falla -no hay ffmpeg, el archivo esta roto, tarda demasiado- devuelve null y el que llama
  se queda con el original: nunca se pierde un audio por intentar mejorarlo.
*/

const PLAZO_MS = 20_000;

// En una maquina sin ffmpeg (el desarrollo local) se deja de intentar despues del primer fallo.
let noHayFfmpeg = false;

export const EXTENSION_PARA_ESCUCHAR = ".m4a";

export async function convertirAudioParaEscuchar(
  original: Buffer,
  extensionOriginal: string,
): Promise<Buffer | null> {
  if (noHayFfmpeg || original.length === 0) {
    return null;
  }

  const carpeta = await mkdtemp(path.join(os.tmpdir(), "audio-"));
  try {
    // La extension ayuda a ffmpeg a reconocer el contenedor (webm, ogg, mp4 fragmentado).
    const extension = /^\.[a-z0-9]{1,5}$/i.test(extensionOriginal) ? extensionOriginal : ".bin";
    const entrada = path.join(carpeta, `entrada${extension}`);
    const salida = path.join(carpeta, `salida${EXTENSION_PARA_ESCUCHAR}`);
    await writeFile(entrada, original);

    await new Promise<void>((resolve, reject) => {
      execFile(
        "ffmpeg",
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-y",
          "-i",
          entrada,
          "-vn",
          "-ac",
          "1",
          "-c:a",
          "aac",
          "-b:a",
          "64k",
          "-movflags",
          "+faststart",
          salida,
        ],
        { timeout: PLAZO_MS },
        (error) => (error ? reject(error) : resolve()),
      );
    });

    const convertido = await readFile(salida);
    return convertido.length > 0 ? convertido : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      noHayFfmpeg = true;
      console.warn("[audio] no hay ffmpeg: los audios se guardan tal cual llegan");
    } else {
      console.warn("[audio] no se pudo convertir, queda el original", {
        extension: extensionOriginal,
        bytes: original.length,
        error: error instanceof Error ? error.message.slice(0, 200) : String(error),
      });
    }
    return null;
  } finally {
    await rm(carpeta, { recursive: true, force: true }).catch(() => undefined);
  }
}
