import { readFile } from "node:fs/promises";
import path from "node:path";

import { carpetaTemporalDeTramos, detectarTramosDeVoz, extraerTramo, pedazosDeAudio, tipoDeAudio } from "@/features/reuniones/servicios/archivos-de-reuniones";
import { devuelveSegmentos, frasesDelTramo, modeloDeTranscripcion, resumenDeAhorro, type Tramo } from "@/features/reuniones/servicios/tramos-de-voz";

/*
  PASAR A TEXTO UNA PISTA de una reunión con la API de OpenAI.

  Solo se manda la voz: ffmpeg quita los silencios (tramos-de-voz.ts) y cada tramo con voz va a
  OpenAI como mp3 mono liviano, con su hora real de inicio en la pista. Así la unión de pistas por
  hora y la hora de cada frase no se corren aunque se hayan quitado los silencios.

  Modelo: REUNIONES_MODELO_TRANSCRIPCION, por defecto gpt-4o-mini-transcribe (USD 0,003 por minuto,
  la mitad de whisper-1). Ese modelo no devuelve horas: cada tramo sale como una frase con la hora
  de inicio del tramo. Con REUNIONES_MODELO_TRANSCRIPCION=whisper-1 se piden los segmentos con hora
  (verbose_json) y cada uno se suma a la hora del tramo.

  Código propio a propósito: src/lib/transcripcion-de-audios.ts es de los audios de los chats y no
  se toca. Acá se filtran con la misma idea las frases que el modelo inventa en los silencios.
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

export const esInventada = (texto: string) => INVENTADAS.some((patron) => patron.test(texto));

/** Los segmentos de whisper-1 pasados a frases, sin las inventadas y corridos por el desfase del pedazo. */
export function limpiarSegmentos(segmentos: Segmento[], desfaseMs = 0): Frase[] {
  const frases: Frase[] = [];
  for (const segmento of segmentos) {
    const texto = (segmento.text ?? "").replace(/\s+/g, " ").trim();
    if (!texto || esInventada(texto)) {
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

async function transcribirArchivo(ruta: string, apiKey: string, modelo: string): Promise<{ texto: string; segmentos: Segmento[] }> {
  const bytes = await readFile(ruta);
  const nombre = path.basename(ruta);
  const conSegmentos = devuelveSegmentos(modelo);
  const formulario = new FormData();
  formulario.append("file", new Blob([new Uint8Array(bytes)], { type: tipoDeAudio(nombre) }), nombre);
  formulario.append("model", modelo);
  formulario.append("language", "es");
  if (conSegmentos) {
    formulario.append("response_format", "verbose_json");
    formulario.append("timestamp_granularities[]", "segment");
  } else {
    formulario.append("response_format", "json");
  }

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
  const datos = (await respuesta.json()) as { text?: string; segments?: Segmento[] };
  return { texto: datos.text ?? "", segmentos: datos.segments ?? [] };
}

/** Las frases de un trozo de audio que empieza en `inicioMs` de la pista (con la hora real). */
async function frasesDeUnTrozo(ruta: string, apiKey: string, modelo: string, tramo: Tramo): Promise<Frase[]> {
  const { texto, segmentos } = await transcribirArchivo(ruta, apiKey, modelo);
  if (devuelveSegmentos(modelo)) {
    return limpiarSegmentos(segmentos, tramo.inicioMs);
  }
  return frasesDelTramo(tramo, texto).filter((frase) => !esInventada(frase.texto));
}

/**
 * Las frases de una pista, con la hora real dentro de ella. Quita los silencios con ffmpeg y manda
 * solo los tramos con voz; si ffmpeg no está o falla, cae al camino de antes (el archivo entero, o en
 * pedazos de 10 minutos si pasa de 25 MB).
 */
export async function transcribirPista(ruta: string, apiKey: string): Promise<Frase[]> {
  const modelo = modeloDeTranscripcion();
  const deteccion = await detectarTramosDeVoz(ruta).catch((error) => {
    console.error("[reuniones] no se pudieron detectar los silencios; se manda el audio completo", error);
    return null;
  });

  if (deteccion) {
    const { carpeta, limpiar } = await carpetaTemporalDeTramos();
    try {
      const ahorro = resumenDeAhorro(deteccion.tramos, deteccion.duracionS);
      console.info(
        `[reuniones] ${path.basename(ruta)}: ${Math.round(ahorro.enviadoS)} s con voz de ${Math.round(deteccion.duracionS)} s (${Math.round(ahorro.fraccion * 100)} %), modelo ${modelo}`,
      );
      const frases: Frase[] = [];
      for (const [indice, tramo] of deteccion.tramos.entries()) {
        const archivo = await extraerTramo(ruta, tramo, carpeta, indice);
        frases.push(...(await frasesDeUnTrozo(archivo, apiKey, modelo, tramo)));
      }
      return frases;
    } finally {
      await limpiar();
    }
  }

  const { pedazos, limpiar } = await pedazosDeAudio(ruta);
  try {
    const frases: Frase[] = [];
    for (const pedazo of pedazos) {
      frases.push(...(await frasesDeUnTrozo(pedazo.ruta, apiKey, modelo, { inicioMs: pedazo.desfaseMs, finMs: pedazo.desfaseMs })));
    }
    return frases;
  } finally {
    await limpiar();
  }
}
