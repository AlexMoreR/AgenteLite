import { readFile } from "node:fs/promises";
import path from "node:path";

import { CALL_RESULTS, CRM_LOST_REASONS } from "@/features/crm/domain/crm-config";
import { prisma } from "@/lib/prisma";

/*
  La grabacion de la llamada, pasada a texto y resumida (pedido de Alex, 14-sep-2026: "las llamadas
  quedan grabadas, se puede sacar tipo texto y sacar resumen de como quedo").

  La IA SUGIERE el resultado y la asesora lo confirma en "¿Como quedo?": el resultado mueve la etapa
  del lead (Ganado, Perdido, Tibio) y equivocarse ahi es mover un cliente por error. Con la sugerencia
  puesta, confirmar es un toque.

  Se guarda en AppSetting (`llamada:transcripcion:<intento>`) para no migrar la base.
*/

export type SugerenciaDeLlamada = {
  transcripcion: string;
  resumen: string;
  resultado: string | null;
  motivoPerdida: string | null;
  /** "2026-09-20" si en la llamada quedaron en volver a hablar un dia. */
  proximoContacto: string | null;
  creadaEl: string;
};

const PREFIJO = "llamada:transcripcion:";
// Tope de OpenAI para audio: 25 MB. Las grabaciones son WAV 16 kHz mono (~32 KB por segundo): unos 13 minutos.
const MAXIMO_BYTES_AUDIO = 24 * 1024 * 1024;

export async function leerSugerenciaDeLlamada(attemptId: string): Promise<SugerenciaDeLlamada | null> {
  const fila = await prisma.appSetting.findUnique({ where: { key: `${PREFIJO}${attemptId}` } });
  if (!fila) {
    return null;
  }
  try {
    return JSON.parse(fila.value) as SugerenciaDeLlamada;
  } catch {
    return null;
  }
}

async function pasarATexto(audio: Buffer, apiKey: string) {
  const formulario = new FormData();
  formulario.append("model", "whisper-1");
  formulario.append("language", "es");
  formulario.append("response_format", "json");
  formulario.append("file", new Blob([new Uint8Array(audio)], { type: "audio/wav" }), "llamada.wav");

  const respuesta = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formulario,
    cache: "no-store",
    signal: AbortSignal.timeout(180_000),
  });
  if (!respuesta.ok) {
    throw new Error(`La transcripcion respondio ${respuesta.status}`);
  }
  const datos = (await respuesta.json()) as { text?: string };
  return datos.text?.trim() ?? "";
}

function hoyEnBogota() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date());
}

async function resumir(transcripcion: string, apiKey: string) {
  const resultados = CALL_RESULTS.map((opcion) => `- ${opcion.value}: ${opcion.label}`).join("\n");
  const motivos = CRM_LOST_REASONS.map((opcion) => `- ${opcion.value}: ${opcion.label}`).join("\n");
  const sistema = [
    "Sos el asistente de un equipo de ventas por telefono de un negocio en Colombia.",
    "Te paso la transcripcion automatica de UNA llamada entre una asesora y un cliente. No separa quien habla y puede tener errores de audio.",
    "Devolve SOLO un JSON con estas claves:",
    '- "resumen": una o dos frases en español, maximo 200 caracteres: que quiere el cliente y en que quedaron. Sin saludos ni relleno.',
    `- "resultado": el valor que mejor describe como quedo la llamada, de esta lista (solo el valor):\n${resultados}`,
    `- "motivo_perdida": solo si resultado es "perdido", el valor de esta lista; si no, null:\n${motivos}`,
    `- "proximo_contacto": si acordaron volver a hablar un dia concreto, la fecha "AAAA-MM-DD" (hoy es ${hoyEnBogota()}); si no, null.`,
    'Si la transcripcion esta vacia o no se entiende, resultado "sin_definir" y el resumen lo dice.',
    "No inventes nada que no este en la llamada.",
  ].join("\n");

  const respuesta = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "gpt-4.1-mini",
      temperature: 0,
      max_tokens: 300,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: sistema },
        { role: "user", content: transcripcion.slice(0, 30_000) || "(vacia)" },
      ],
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(60_000),
  });
  if (!respuesta.ok) {
    throw new Error(`El resumen respondio ${respuesta.status}`);
  }
  const cuerpo = (await respuesta.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const datos = JSON.parse(cuerpo.choices?.[0]?.message?.content ?? "{}") as Record<string, unknown>;

  const resultado = CALL_RESULTS.some((opcion) => opcion.value === datos.resultado) ? String(datos.resultado) : null;
  const motivo =
    resultado === "perdido" && CRM_LOST_REASONS.some((opcion) => opcion.value === datos.motivo_perdida)
      ? String(datos.motivo_perdida)
      : null;
  const fecha =
    typeof datos.proximo_contacto === "string" && /^\d{4}-\d{2}-\d{2}$/.test(datos.proximo_contacto)
      ? datos.proximo_contacto
      : null;

  return {
    resumen: typeof datos.resumen === "string" ? datos.resumen.trim().slice(0, 280) : "",
    resultado,
    motivoPerdida: motivo,
    proximoContacto: fecha,
  };
}

/**
 * Pasa a texto la grabacion de un intento y deja la sugerencia guardada. Si ya estaba, la devuelve.
 *
 * Devuelve null cuando no hay nada que escuchar (sin grabacion, archivo borrado o demasiado largo) o
 * falta la clave de OpenAI.
 */
export async function transcribirYResumirLlamada(attemptId: string): Promise<SugerenciaDeLlamada | null> {
  const guardada = await leerSugerenciaDeLlamada(attemptId);
  if (guardada) {
    return guardada;
  }

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const intento = await prisma.callAttempt.findUnique({ where: { id: attemptId }, select: { recordingUrl: true } });
  const url = intento?.recordingUrl ?? "";
  // Solo archivos propios de la carpeta de grabaciones: el valor sale de la base, pero se lee del disco.
  if (!apiKey || !/^\/uploads\/grabaciones\/[A-Za-z0-9_-]+\.wav$/.test(url)) {
    return null;
  }

  const audio = await readFile(path.join(process.cwd(), "public", url)).catch(() => null);
  if (!audio || audio.length <= 44 || audio.length > MAXIMO_BYTES_AUDIO) {
    return null;
  }

  const transcripcion = await pasarATexto(audio, apiKey);
  const resumen = await resumir(transcripcion, apiKey);
  const sugerencia: SugerenciaDeLlamada = {
    transcripcion: transcripcion.slice(0, 20_000),
    ...resumen,
    creadaEl: new Date().toISOString(),
  };

  await prisma.appSetting.upsert({
    where: { key: `${PREFIJO}${attemptId}` },
    create: { key: `${PREFIJO}${attemptId}`, value: JSON.stringify(sugerencia) },
    update: { value: JSON.stringify(sugerencia) },
  });
  return sugerencia;
}
