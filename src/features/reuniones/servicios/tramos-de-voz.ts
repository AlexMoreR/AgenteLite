/*
  TRAMOS DE VOZ: transcribir solo donde alguien habla (partes puras, sin ffmpeg ni red).

  Cada pista es de UNA persona, así que casi todo es silencio mientras hablan los demás. Se le pide
  a ffmpeg `silencedetect`, se arman los tramos con voz (con un colchón de 0,3 s a cada lado) y solo
  esos tramos se mandan a OpenAI. Cada tramo conserva su hora real de inicio dentro de la pista:
  como la transcripción une las pistas por hora, la hora de cada frase es la del tramo más el
  desfase que devuelve el modelo (si lo devuelve). Así quitar los silencios no corre ningún tiempo.
*/

export type Silencio = { inicioS: number; finS: number };
export type Tramo = { inicioMs: number; finMs: number };

/** Silencios de más de este tiempo (s) se quitan. */
export const SILENCIO_MIN_S = 1;
/** Umbral de silencio de ffmpeg. */
export const SILENCIO_DB = -40;
/** Colchón que se deja a cada lado de la voz (s). */
export const COLCHON_S = 0.3;
/** Dos tramos separados por menos de esto (s) se unen en uno. */
export const UNIR_HUECO_S = 2;
/** Un tramo unido no pasa de esto (s): así cada frase tiene su hora cerca. */
export const TRAMO_MAX_S = 90;
/** Un tramo nunca pasa de esto (s), ni siquiera sin pausas (tope de los modelos de OpenAI). */
export const TRAMO_TOPE_S = 10 * 60;
/** La voz de menos de esto (s) es un golpe o un clic, no se manda. */
export const VOZ_MIN_S = 0.25;

export const MODELO_POR_DEFECTO = "gpt-4o-mini-transcribe";

/** El modelo de transcripción: REUNIONES_MODELO_TRANSCRIPCION, o gpt-4o-mini-transcribe. */
export function modeloDeTranscripcion(valor: string | undefined | null = process.env.REUNIONES_MODELO_TRANSCRIPCION): string {
  const limpio = valor?.trim();
  return limpio ? limpio : MODELO_POR_DEFECTO;
}

/** Solo whisper-1 devuelve segmentos con hora; los gpt-4o-*-transcribe devuelven solo el texto. */
export function devuelveSegmentos(modelo: string): boolean {
  return modelo.startsWith("whisper");
}

/** Los argumentos de ffmpeg para detectar silencios (la salida sale por stderr). */
export function argumentosDeSilencios(entrada: string): string[] {
  return ["-hide_banner", "-nostdin", "-i", entrada, "-vn", "-af", `silencedetect=noise=${SILENCIO_DB}dB:d=${SILENCIO_MIN_S}`, "-f", "null", "-"];
}

function segundosDeReloj(texto: string): number | null {
  const m = /^(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/.exec(texto);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
}

/**
 * Lo que dice ffmpeg (stderr) con silencedetect: los silencios y lo que dura el archivo.
 * La duración sale de "Duration: hh:mm:ss" o, si el contenedor no la trae (ogg de Egress), del
 * último "time=hh:mm:ss" del avance.
 */
export function parsearSilencios(salida: string): { duracionS: number | null; silencios: Silencio[] } {
  const silencios: Silencio[] = [];
  let abierto: number | null = null;
  for (const m of salida.matchAll(/silence_(start|end): (-?\d+(?:\.\d+)?)/g)) {
    const valor = Math.max(0, Number(m[2]));
    if (m[1] === "start") {
      abierto = valor;
    } else {
      silencios.push({ inicioS: abierto ?? 0, finS: valor });
      abierto = null;
    }
  }
  let duracionS: number | null = null;
  const duracion = /Duration: (\d+:\d{2}:\d{2}(?:\.\d+)?)/.exec(salida);
  if (duracion) {
    duracionS = segundosDeReloj(duracion[1]);
  }
  if (duracionS === null) {
    const tiempos = [...salida.matchAll(/time=(\d+:\d{2}:\d{2}(?:\.\d+)?)/g)];
    if (tiempos.length) {
      duracionS = segundosDeReloj(tiempos[tiempos.length - 1][1]);
    }
  }
  // Un silencio que sigue abierto al final del archivo llega hasta el final.
  if (abierto !== null && duracionS !== null && duracionS > abierto) {
    silencios.push({ inicioS: abierto, finS: duracionS });
  }
  return { duracionS, silencios };
}

/**
 * Los tramos con voz: lo que queda entre silencios, con colchón, unidos si casi se tocan y partidos
 * si son larguísimos. Las horas son las REALES dentro de la pista (ms desde su inicio).
 */
export function armarTramos(silencios: Silencio[], duracionS: number): Tramo[] {
  if (!(duracionS > 0)) {
    return [];
  }
  const ordenados = silencios
    .map((s) => ({ inicioS: Math.max(0, Math.min(s.inicioS, duracionS)), finS: Math.max(0, Math.min(s.finS, duracionS)) }))
    .filter((s) => s.finS > s.inicioS)
    .sort((a, b) => a.inicioS - b.inicioS);

  // La voz es lo que queda entre silencios.
  const voz: Array<[number, number]> = [];
  let cursor = 0;
  for (const s of ordenados) {
    if (s.inicioS > cursor) {
      voz.push([cursor, s.inicioS]);
    }
    cursor = Math.max(cursor, s.finS);
  }
  if (cursor < duracionS) {
    voz.push([cursor, duracionS]);
  }

  const conColchon = voz
    .filter(([inicio, fin]) => fin - inicio >= VOZ_MIN_S)
    .map(([inicio, fin]): [number, number] => [Math.max(0, inicio - COLCHON_S), Math.min(duracionS, fin + COLCHON_S)]);

  // Unir los que casi se tocan, sin pasar de TRAMO_MAX_S.
  const unidos: Array<[number, number]> = [];
  for (const [inicio, fin] of conColchon) {
    const ultimo = unidos[unidos.length - 1];
    if (ultimo && inicio - ultimo[1] <= UNIR_HUECO_S && fin - ultimo[0] <= TRAMO_MAX_S) {
      ultimo[1] = Math.max(ultimo[1], fin);
    } else {
      unidos.push([inicio, fin]);
    }
  }

  // Partir lo larguísimo (voz sin pausas).
  const tramos: Tramo[] = [];
  for (const [inicio, fin] of unidos) {
    for (let desde = inicio; desde < fin - 1e-9; desde += TRAMO_TOPE_S) {
      const hasta = Math.min(fin, desde + TRAMO_TOPE_S);
      tramos.push({ inicioMs: Math.round(desde * 1000), finMs: Math.round(hasta * 1000) });
    }
  }
  return tramos;
}

/** Los argumentos de ffmpeg para sacar un tramo como mp3 mono 16 kHz liviano. */
export function argumentosDeTramo(entrada: string, tramo: Tramo, salida: string): string[] {
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-nostdin",
    "-y",
    "-ss",
    (tramo.inicioMs / 1000).toFixed(3),
    "-t",
    ((tramo.finMs - tramo.inicioMs) / 1000).toFixed(3),
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
    "32k",
    salida,
  ];
}

/** Cuánto audio se manda de verdad (s) y qué parte del total es. */
export function resumenDeAhorro(tramos: Tramo[], duracionS: number): { enviadoS: number; fraccion: number } {
  const enviadoS = tramos.reduce((suma, t) => suma + (t.finMs - t.inicioMs) / 1000, 0);
  return { enviadoS, fraccion: duracionS > 0 ? enviadoS / duracionS : 1 };
}

/**
 * El mapeo de tiempos: lo que devuelve el modelo para un tramo, puesto en la hora real de la pista.
 *  - Con segmentos (whisper-1): cada segmento queda en tramo.inicioMs + su inicio.
 *  - Sin segmentos (gpt-4o-*-transcribe): una sola frase que ocupa el tramo entero.
 */
export type SegmentoConHora = { inicioMs: number; finMs: number; texto: string };

export function frasesDelTramo(tramo: Tramo, texto: string, segmentos?: SegmentoConHora[] | null): SegmentoConHora[] {
  if (segmentos && segmentos.length) {
    return segmentos.map((s) => ({
      inicioMs: tramo.inicioMs + s.inicioMs,
      finMs: Math.min(tramo.finMs, tramo.inicioMs + s.finMs),
      texto: s.texto,
    }));
  }
  const limpio = texto.replace(/\s+/g, " ").trim();
  return limpio ? [{ inicioMs: tramo.inicioMs, finMs: tramo.finMs, texto: limpio }] : [];
}
