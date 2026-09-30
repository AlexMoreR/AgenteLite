import { readFile } from "node:fs/promises";
import path from "node:path";

import { Prisma } from "@prisma/client";

import { getPublicBaseUrl } from "@/lib/app-url";
import { prisma } from "@/lib/prisma";

/**
 * LAS NOTAS DE VOZ, PASADAS A TEXTO.
 *
 * Pedido de Alex (29-09-2026): para saber qué pasó en un chat había que escuchar audio por audio,
 * y para revisar cómo atiende una asesora -María Camila- había que escuchar todos los suyos.
 *
 * Se transcriben TODAS, las del cliente y las nuestras, apenas aparecen: no hay que tocar ningún
 * botón. Lo hace el reloj del servidor (`/api/cron/follows`, cada minuto) y no la entrada de
 * mensajes, a propósito:
 *  - Un solo lugar cubre todos los caminos por donde entra o sale un audio (el webhook de cada
 *    gateway, lo que manda la asesora desde el CRM, lo que sale desde el celular, los flujos). Si
 *    se colgara de cada uno, el día que aparezca un camino nuevo sus audios quedarían sin texto.
 *  - No se toca el recorrido de un mensaje entrante: si OpenAI tarda o se cae, no demora ni rompe
 *    nada de lo que ya funciona. El costo es que el texto aparece un minuto después del audio.
 *
 * Cuesta poco: medido el 29-09-2026, en 30 días hubo unos 1.400 audios distintos (~US$3 al mes).
 * Los audios de los flujos se repiten cientos de veces -es el mismo archivo para cada lead-, así
 * que un archivo ya transcrito no se vuelve a pagar: se copia el texto.
 *
 * El agente ya transcribía los audios del CLIENTE para entenderlos, pero ese texto se usaba en el
 * momento y se tiraba. Esto es aparte y no lo reemplaza.
 */

/** Cuántos audios por vuelta del reloj. A 1 por segundo aprox., el historial de un mes sale en ~1,5 h. */
const POR_VUELTA = 15;

/** Cuántos a la vez contra OpenAI. */
const EN_PARALELO = 5;

/** Hasta dónde se mira hacia atrás. Lo más nuevo va primero: un audio de hoy no espera al historial. */
const DIAS_HACIA_ATRAS = 30;

/** Tope de OpenAI para un archivo de audio: 25 MB. Una nota de voz nunca se acerca. */
const MAXIMO_BYTES = 24 * 1024 * 1024;

/** Para apagarlo sin desplegar, si algún día hace falta: `transcripcion-de-audios:apagada` = "si". */
const CLAVE_APAGADO = "transcripcion-de-audios:apagada";

/*
  Frases que Whisper "escucha" en un audio en silencio o con puro ruido.

  Es un defecto conocido del modelo en español: aprendió de videos subtitulados y, cuando no hay
  voz, completa con el crédito de los subtítulos. Guardarlas haría creer que el cliente dijo eso.
*/
const ALUCINACIONES = [
  /subt[ií]tulos (realizados )?por la comunidad de amara/i,
  /^¡?gracias por ver( el v[ií]deo)?!?\.?$/i,
  /^suscr[ií]bete/i,
  /^\.+$/,
];

type Pendiente = { id: string; mediaUrl: string };

/** Los fallos que valen un reintento (red, OpenAI saturado) frente a los que no (audio que no está). */
class FalloPasajero extends Error {}

function carpetaDeUploads() {
  return path.join(process.cwd(), "public", "uploads");
}

/**
 * Los bytes del audio.
 *
 * Primero del disco: casi todos están en `/uploads`, y leerlos de ahí no sale a la red. La URL
 * puede venir relativa (`/uploads/chat-media/x.ogg`) o absoluta hacia nuestro propio servidor
 * (así los guardan los flujos). Si no está en el disco, se pide por HTTP.
 */
async function leerAudio(mediaUrl: string): Promise<{ bytes: Buffer; extension: string } | null> {
  let ruta = mediaUrl.trim();

  if (ruta.startsWith("data:")) {
    const coma = ruta.indexOf(",");
    if (coma < 0 || !ruta.slice(0, coma).includes("base64")) {
      return null;
    }
    const bytes = Buffer.from(ruta.slice(coma + 1), "base64");
    return bytes.length > 0 ? { bytes, extension: "ogg" } : null;
  }

  const base = getPublicBaseUrl();
  let absoluta: string | null = null;

  if (/^https?:\/\//i.test(ruta)) {
    let url: URL;
    try {
      url = new URL(ruta);
    } catch {
      return null;
    }
    const host = url.hostname.toLowerCase();
    // Los del CDN de WhatsApp están cifrados: bajarlos no sirve.
    if (host === "whatsapp.net" || host.endsWith(".whatsapp.net")) {
      return null;
    }
    const esNuestro = base && (() => {
      try {
        return new URL(base).hostname.toLowerCase() === host;
      } catch {
        return false;
      }
    })();
    if (esNuestro && url.pathname.startsWith("/uploads/")) {
      ruta = decodeURIComponent(url.pathname);
    } else {
      absoluta = url.toString();
    }
  }

  const extension = (path.extname(absoluta ? new URL(absoluta).pathname : ruta).slice(1) || "ogg").toLowerCase();

  if (!absoluta && ruta.startsWith("/uploads/")) {
    // Solo dentro de /public/uploads: un ".." en la URL no puede leer otra cosa del servidor.
    const carpeta = carpetaDeUploads();
    const archivo = path.normalize(path.join(carpeta, ruta.slice("/uploads/".length)));
    if (!archivo.startsWith(carpeta + path.sep)) {
      return null;
    }
    try {
      const bytes = await readFile(archivo);
      return bytes.length > 0 && bytes.length <= MAXIMO_BYTES ? { bytes, extension } : null;
    } catch {
      // No está en ESTE disco (la base es compartida con otros entornos): se intenta por HTTP.
      absoluta = base ? `${base}${ruta}` : null;
    }
  } else if (!absoluta && ruta.startsWith("/")) {
    // Una ruta de Evolution: el proxy le pone la apikey.
    absoluta = base ? `${base}/api/media/proxy?url=${encodeURIComponent(ruta)}` : null;
  }

  if (!absoluta) {
    return null;
  }

  let respuesta: Response;
  try {
    respuesta = await fetch(absoluta, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
  } catch {
    throw new FalloPasajero("no se pudo bajar el audio");
  }
  if (respuesta.status >= 500) {
    throw new FalloPasajero(`el audio respondio ${respuesta.status}`);
  }
  if (!respuesta.ok) {
    return null;
  }
  const bytes = Buffer.from(await respuesta.arrayBuffer());
  return bytes.length > 0 && bytes.length <= MAXIMO_BYTES ? { bytes, extension } : null;
}

const TIPO_POR_EXTENSION: Record<string, string> = {
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
  mp3: "audio/mpeg",
  mpeg: "audio/mpeg",
  m4a: "audio/mp4",
  mp4: "audio/mp4",
  aac: "audio/aac",
  wav: "audio/wav",
  webm: "audio/webm",
};

async function pasarATexto(audio: { bytes: Buffer; extension: string }, apiKey: string): Promise<string> {
  // Whisper decide el formato por la extensión del nombre: una nota de voz sin extensión conocida
  // se manda como .ogg, que es lo que casi siempre es.
  const extension = TIPO_POR_EXTENSION[audio.extension] ? audio.extension : "ogg";
  const formulario = new FormData();
  formulario.append("model", "whisper-1");
  // Decirle el idioma mejora la precisión y evita que un audio corto se lea como portugués.
  formulario.append("language", "es");
  formulario.append("response_format", "json");
  formulario.append(
    "file",
    new Blob([new Uint8Array(audio.bytes)], { type: TIPO_POR_EXTENSION[extension] }),
    `nota.${extension === "opus" ? "ogg" : extension}`,
  );

  let respuesta: Response;
  try {
    respuesta = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formulario,
      cache: "no-store",
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw new FalloPasajero("OpenAI no respondio");
  }

  // Saturado o caído: se reintenta en la próxima vuelta. Un 400 es el archivo, y no va a cambiar.
  if (respuesta.status === 429 || respuesta.status >= 500) {
    throw new FalloPasajero(`OpenAI respondio ${respuesta.status}`);
  }
  if (!respuesta.ok) {
    return "";
  }

  const datos = (await respuesta.json()) as { text?: string };
  const texto = datos.text?.trim() ?? "";
  return ALUCINACIONES.some((patron) => patron.test(texto)) ? "" : texto;
}

async function transcribirUno(pendiente: Pendiente, apiKey: string, yaHechos: Map<string, string>) {
  try {
    // El mismo archivo ya se transcribió (el audio de un flujo, mandado a otro lead): se copia.
    let texto = yaHechos.get(pendiente.mediaUrl);
    if (texto === undefined) {
      const previo = await prisma.message.findFirst({
        where: { mediaUrl: pendiente.mediaUrl, transcripcion: { not: null }, id: { not: pendiente.id } },
        select: { transcripcion: true },
      });
      texto = previo?.transcripcion ?? undefined;
    }

    if (texto === undefined) {
      const audio = await leerAudio(pendiente.mediaUrl);
      // Sin audio no hay nada que transcribir, y reintentarlo no lo va a hacer aparecer.
      texto = audio ? await pasarATexto(audio, apiKey) : "";
      yaHechos.set(pendiente.mediaUrl, texto);
    }

    /*
      "" es "se intentó y no hay voz (o no estaba el audio)": queda así y no se reintenta. Se
      guarda vacío y no null para que la pantalla lo distinga de "todavía no se transcribió".
    */
    await prisma.message.update({
      where: { id: pendiente.id },
      data: { transcripcion: texto, transcritoEn: new Date() },
    });
    return texto ? "transcrito" : "sin_voz";
  } catch (error) {
    if (error instanceof FalloPasajero) {
      // Se suelta para que lo tome la próxima vuelta del reloj.
      await prisma.message
        .update({ where: { id: pendiente.id }, data: { transcritoEn: null } })
        .catch(() => {});
      return "reintentar";
    }
    console.error("[transcripcion] fallo", {
      messageId: pendiente.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return "fallo";
  }
}

export async function transcribirAudiosPendientes(): Promise<Record<string, number> | null> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return null;
  }

  const apagado = await prisma.appSetting.findUnique({ where: { key: CLAVE_APAGADO } });
  if (apagado?.value === "si") {
    return null;
  }

  const desde = new Date(Date.now() - DIAS_HACIA_ATRAS * 24 * 60 * 60 * 1000);

  /*
    Se TOMAN antes de trabajarlos: marcar `transcritoEn` en la misma sentencia que los elige hace
    que dos vueltas del reloj que se pisan (una que tardó más de un minuto) no paguen dos veces el
    mismo audio. SKIP LOCKED hace que la segunda se salte los que la primera está marcando.
  */
  const tomados = await prisma.$queryRaw<Pendiente[]>(Prisma.sql`
    UPDATE "Message"
       SET "transcritoEn" = NOW()
     WHERE "id" IN (
       SELECT "id" FROM "Message"
        WHERE "type" = 'AUDIO'
          AND "transcritoEn" IS NULL
          AND "deletedAt" IS NULL
          AND "mediaUrl" IS NOT NULL
          AND "createdAt" >= ${desde}
        ORDER BY "createdAt" DESC
        LIMIT ${POR_VUELTA}
        FOR UPDATE SKIP LOCKED
     )
    RETURNING "id", "mediaUrl"
  `);

  if (tomados.length === 0) {
    return { tomados: 0 };
  }

  const yaHechos = new Map<string, string>();
  const resultado: Record<string, number> = { tomados: tomados.length };

  for (let i = 0; i < tomados.length; i += EN_PARALELO) {
    const tanda = await Promise.all(
      tomados.slice(i, i + EN_PARALELO).map((pendiente) => transcribirUno(pendiente, apiKey, yaHechos)),
    );
    for (const estado of tanda) {
      resultado[estado] = (resultado[estado] ?? 0) + 1;
    }
  }

  console.log("[transcripcion] vuelta", resultado);
  return resultado;
}
