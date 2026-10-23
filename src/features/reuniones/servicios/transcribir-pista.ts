import { readFile } from "node:fs/promises";
import path from "node:path";

import { pedazosDeAudio, tipoDeAudio } from "@/features/reuniones/servicios/archivos-de-reuniones";

/*
  PASAR A TEXTO UNA PISTA de una reunión con la API de OpenAI.

  whisper-1, en español y con la hora de cada frase (verbose_json con segmentos): gpt-4o-transcribe
  no devuelve las horas, y sin ellas no se pueden unir las pistas por hora. Cuesta unos 0,36 USD por
  hora de audio por pista.

  Código propio a propósito: src/lib/transcripcion-de-audios.ts es de los audios de los chats y no
  se toca. Acá se filtran con la misma idea las frases que whisper-1 inventa en los silencios.
*/

export type Frase = { inicioMs: number; finMs: number; texto: string };

type Segmento = { start?: number; end?: number; text?: string; no_speech_prob?: number };

const INVENTADAS = [
  /subt[ií]tulos (realizados )?por la comunidad de amara/i,
  /^¡?gracias por ver( el v[ií]deo)?!?\.?$/i,
  /^suscr[ií]bete/i,
  /^¡?no olvides suscribirte/i,
  /^\.+$/,
  /^…+$/,
];

/** Los segmentos de whisper-1 pasados a frases, sin las inventadas y corridos por el desfase del pedazo. */
export function limpiarSegmentos(segmentos: Segmento[], desfaseMs = 0): Frase[] {
  const frases: Frase[] = [];
  for (const segmento of segmentos) {
    const texto = (segmento.text ?? "").replace(/\s+/g, " ").trim();
    if (!texto || INVENTADAS.some((patron) => patron.test(texto))) {
      continue;
    }
    // Casi seguro que ahí no habló nadie: es de las que se inventa en los silencios.
    if ((segmento.no_speech_prob ?? 0) > 0.8) {
      continue;
    }
    const inicio = Math.max(0, Math.round((segmento.start ?? 0) * 1000));
    const fin = Math.max(inicio, Math.round((segmento.end ?? segmento.start ?? 0) * 1000));
    frases.push({ inicioMs: inicio + desfaseMs, finMs: fin + desfaseMs, texto });
  }
  return frases;
}

async function transcribirArchivo(ruta: string, apiKey: string): Promise<Segmento[]> {
  const bytes = await readFile(ruta);
  const nombre = path.basename(ruta);
  const formulario = new FormData();
  formulario.append("file", new Blob([new Uint8Array(bytes)], { type: tipoDeAudio(nombre) }), nombre);
  formulario.append("model", "whisper-1");
  formulario.append("language", "es");
  formulario.append("response_format", "verbose_json");
  formulario.append("timestamp_granularities[]", "segment");

  const respuesta = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formulario,
    cache: "no-store",
    signal: AbortSignal.timeout(5 * 60_000),
  });
  if (!respuesta.ok) {
    const detalle = (await respuesta.text().catch(() => "")).slice(0, 200);
    if (respuesta.status === 401) {
      throw new Error("La clave de OpenAI no sirve (401).");
    }
    throw new Error(`OpenAI respondió ${respuesta.status} al transcribir: ${detalle}`);
  }
  const datos = (await respuesta.json()) as { segments?: Segmento[] };
  return datos.segments ?? [];
}

/** Las frases de un archivo de audio (si pesa más de 25 MB, se parte en pedazos de 10 minutos). */
export async function transcribirPista(ruta: string, apiKey: string): Promise<Frase[]> {
  const { pedazos, limpiar } = await pedazosDeAudio(ruta);
  try {
    const frases: Frase[] = [];
    for (const pedazo of pedazos) {
      frases.push(...limpiarSegmentos(await transcribirArchivo(pedazo.ruta, apiKey), pedazo.desfaseMs));
    }
    return frases;
  } finally {
    await limpiar();
  }
}
