import { stat } from "node:fs/promises";

import type { EstadoReunion, Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { revisarSiTermino } from "@/features/reuniones/servicios/avisos-de-livekit";
import { nombresDeUsuariosPara } from "@/features/reuniones/servicios/nombres-de-usuarios";
import { nombreVisible } from "@/features/reuniones/servicios/nombres-de-participantes";
import { rutaDeArchivo } from "@/features/reuniones/servicios/archivos-de-reuniones";
import { actaEnTexto, hacerActa } from "@/features/reuniones/servicios/hacer-acta";
import { leerConfigLivekit, salaAbierta } from "@/features/reuniones/servicios/livekit";
import { transcribirPista, type Frase } from "@/features/reuniones/servicios/transcribir-pista";
import { transcripcionEnTexto, unirPistas } from "@/features/reuniones/servicios/unir-pistas";

/*
  LA COLA DE LAS REUNIONES: transcripción y acta.

  Corre en el reloj del servidor que ya existe (/api/cron/follows, cada minuto), en el servidor del
  CRM, con la API de OpenAI (aizen1 no sirve: sin GPU, 1 hora de audio tardaba 47 minutos con la CPU
  al 100 %).

  - Una reunión a la vez, la que lleva más tiempo esperando.
  - Por cada pista: solo los tramos con voz (ffmpeg quita los silencios) con gpt-4o-mini-transcribe (REUNIONES_MODELO_TRANSCRIPCION).
    Una pista ya transcrita no se vuelve a mandar en un reintento: no se paga dos veces.
  - Se unen las pistas por hora con el nombre de quien habló y gpt-4o-mini hace el acta.
  - Si algo falla, se reintenta (cada vez un poco más tarde) hasta 3 veces; después queda en Error
    con el motivo, y en la pantalla está "Reintentar".
  - Sin OPENAI_API_KEY la reunión se queda "En cola" con el aviso "Falta la clave de OpenAI", sin
    gastar intentos: arranca sola cuando Alexander ponga la clave.

  Además, cada minuto revisa las reuniones con más de 30 minutos "En vivo" y le pregunta a LiveKit
  si la sala sigue abierta: si se perdió el aviso del cierre, la reunión no se queda colgada.
*/

export const MAXIMO_DE_INTENTOS = 3;
export const AVISO_SIN_CLAVE = "Falta la clave de OpenAI";
const MINUTO = 60_000;
/** Si una reunión lleva más que esto "Transcribiendo", el proceso que la tenía se murió. */
const TRABAJO_COLGADO_MS = 60 * MINUTO;
/** Una grabación que no avisó que terminó, pasado esto desde el cierre de la sala, se da por perdida. */
const GRABACION_PERDIDA_MS = 15 * MINUTO;

let corriendo = false;

/** Cuánto esperar antes de reintentar: 5 minutos después del 1.er fallo, 10 después del 2.º. */
export function esperaParaReintentar(intentos: number): number {
  return intentos * 5 * MINUTO;
}

export function claveDeOpenAI(): string | null {
  return process.env.OPENAI_API_KEY?.trim() || null;
}

/** Reuniones "En vivo" hace más de 30 minutos cuya sala ya no existe en LiveKit. */
async function revisarReunionesColgadas() {
  const config = leerConfigLivekit();
  if (!config) {
    return;
  }
  const ahora = Date.now();
  const hace30 = new Date(ahora - 30 * MINUTO);
  const vivas = await prisma.reunion.findMany({
    where: {
      OR: [
        { estado: "EN_VIVO", empezoEn: { lt: hace30 } },
        // Si se perdieron los avisos de entrada y de cierre, puede quedar "Esperando" con pistas grabando.
        { estado: "ESPERANDO", updatedAt: { lt: hace30 }, pistas: { some: { estado: "GRABANDO" } } },
      ],
    },
    select: { id: true, sala: true, terminoEn: true },
    take: 10,
  });
  for (const reunion of vivas) {
    try {
      if (!reunion.terminoEn && (await salaAbierta(config, reunion.sala))) {
        continue;
      }
      const terminoEn = reunion.terminoEn ?? new Date(ahora);
      if (!reunion.terminoEn) {
        await prisma.reunion.update({ where: { id: reunion.id }, data: { terminoEn } });
        await prisma.reunionParticipante.updateMany({ where: { reunionId: reunion.id, salioEn: null }, data: { salioEn: terminoEn } });
      }
      if (ahora - terminoEn.getTime() > GRABACION_PERDIDA_MS) {
        // Se perdió el aviso del fin de la grabación: si el archivo está en el disco, se usa igual.
        const perdidas = await prisma.reunionPista.findMany({
          where: { reunionId: reunion.id, estado: "GRABANDO" },
          select: { id: true, archivo: true },
        });
        for (const pista of perdidas) {
          const tamano = pista.archivo ? await stat(rutaDeArchivo(pista.archivo)).then((datos) => datos.size).catch(() => 0) : 0;
          await prisma.reunionPista.update({
            where: { id: pista.id },
            data: tamano > 0 ? { estado: "LISTA", bytes: Math.min(tamano, 2_147_483_647), terminaEn: terminoEn } : { estado: "ERROR", terminaEn: terminoEn },
          });
        }
      }
      await revisarSiTermino(reunion.id);
    } catch (error) {
      console.error("[reuniones] no se pudo revisar la sala", reunion.sala, error);
    }
  }
}

/** Una reunión que se quedó "Transcribiendo" o "Haciendo acta" porque el proceso se reinició vuelve a la cola. */
async function soltarTrabajosColgados() {
  const colgadas = { estado: { in: ["TRANSCRIBIENDO", "HACIENDO_ACTA"] as EstadoReunion[] }, updatedAt: { lt: new Date(Date.now() - TRABAJO_COLGADO_MS) } };
  const motivoError = "Se cortó a mitad de camino (el servidor se reinició).";
  // Si ya era el último intento, queda en Error: una reunión que tumba el servidor no se repite sin fin.
  await prisma.reunion.updateMany({
    where: { ...colgadas, intentos: { gte: MAXIMO_DE_INTENTOS - 1 } },
    data: { estado: "ERROR", intentos: { increment: 1 }, motivoError },
  });
  await prisma.reunion.updateMany({
    where: colgadas,
    data: { estado: "EN_COLA", intentos: { increment: 1 }, motivoError },
  });
}

async function siguienteEnLaCola() {
  const candidatas = await prisma.reunion.findMany({
    // Salvaguarda: una reunión sin grabar nunca se toma (no tiene audio).
    where: { estado: "EN_COLA", sinGrabar: false },
    orderBy: [{ terminoEn: "asc" }, { createdAt: "asc" }],
    select: { id: true, intentos: true, updatedAt: true, aviso: true },
    take: 20,
  });
  const ahora = Date.now();
  return candidatas.find((una) => ahora - una.updatedAt.getTime() >= esperaParaReintentar(una.intentos)) ?? null;
}

async function procesarReunion(reunionId: string, apiKey: string) {
  const reunion = await prisma.reunion.findUniqueOrThrow({
    where: { id: reunionId },
    select: {
      titulo: true,
      empezoEn: true,
      pistas: {
        where: { estado: { in: ["LISTA", "TRANSCRITA"] } },
        orderBy: { empiezaEn: "asc" },
        select: { id: true, archivo: true, estado: true, empiezaEn: true, transcripcion: true, participante: { select: { nombre: true, identidad: true, userId: true } } },
      },
    },
  });
  if (!reunion.pistas.length) {
    throw new SinAudio();
  }

  const nombres = await nombresDeUsuariosPara(reunion.pistas.flatMap((pista) => (pista.participante ? [pista.participante] : [])));
  const pistas: Array<{ nombre: string; empiezaEn: Date | null; frases: Frase[] }> = [];
  for (const pista of reunion.pistas) {
    let frases = pista.estado === "TRANSCRITA" && Array.isArray(pista.transcripcion) ? (pista.transcripcion as Frase[]) : null;
    if (!frases) {
      if (!pista.archivo) {
        continue;
      }
      const ruta = rutaDeArchivo(pista.archivo);
      await stat(ruta).catch(() => {
        throw new Error(`No se encontró el archivo de audio ${pista.archivo}.`);
      });
      frases = await transcribirPista(ruta, apiKey);
      await prisma.reunionPista.update({
        where: { id: pista.id },
        data: { transcripcion: frases as unknown as Prisma.InputJsonValue, estado: "TRANSCRITA" },
      });
      // Señal de vida: una reunión larga no se confunde con un trabajo colgado.
      await prisma.reunion.update({ where: { id: reunionId }, data: { updatedAt: new Date() } });
    }
    // En un audio subido no se separa quién habló.
    pistas.push({ nombre: pista.participante ? nombreVisible(pista.participante, nombres) : "Audio", empiezaEn: pista.empiezaEn, frases });
  }

  const frases = unirPistas(pistas, reunion.empezoEn);
  const texto = transcripcionEnTexto(frases);
  await prisma.reunion.update({
    where: { id: reunionId },
    data: { estado: "HACIENDO_ACTA", transcripcion: frases as unknown as Prisma.InputJsonValue, textoTranscripcion: texto },
  });

  const acta = await hacerActa({ titulo: reunion.titulo, transcripcion: texto }, apiKey);
  await prisma.reunion.update({
    where: { id: reunionId },
    data: {
      estado: "LISTA",
      acta: acta as unknown as Prisma.InputJsonValue,
      textoActa: actaEnTexto(acta),
      aviso: null,
      motivoError: null,
    },
  });
}

class SinAudio extends Error {
  constructor() {
    super("La reunión no tiene audio grabado.");
  }
}

/** Una vuelta de la cola (la llama el reloj del servidor cada minuto). */
export async function procesarColaDeReuniones() {
  if (corriendo) {
    return;
  }
  corriendo = true;
  try {
    await revisarReunionesColgadas();
    await soltarTrabajosColgados();

    // Una a la vez, también entre procesos.
    const ocupada = await prisma.reunion.count({ where: { estado: { in: ["TRANSCRIBIENDO", "HACIENDO_ACTA"] } } });
    if (ocupada) {
      return;
    }
    const siguiente = await siguienteEnLaCola();
    if (!siguiente) {
      return;
    }

    const apiKey = claveDeOpenAI();
    if (!apiKey) {
      if (siguiente.aviso !== AVISO_SIN_CLAVE) {
        await prisma.reunion.updateMany({ where: { estado: "EN_COLA", aviso: { not: AVISO_SIN_CLAVE } }, data: { aviso: AVISO_SIN_CLAVE } });
      }
      return;
    }

    // Se toma solo si sigue en cola (otro proceso pudo tomarla en el medio).
    const tomada = await prisma.reunion.updateMany({
      where: { id: siguiente.id, estado: "EN_COLA" },
      data: { estado: "TRANSCRIBIENDO", aviso: null },
    });
    if (!tomada.count) {
      return;
    }

    try {
      await procesarReunion(siguiente.id, apiKey);
    } catch (error) {
      const motivo = (error instanceof Error ? error.message : String(error)).slice(0, 500);
      const intentos = error instanceof SinAudio ? MAXIMO_DE_INTENTOS : siguiente.intentos + 1;
      console.error("[reuniones] falló la transcripción", siguiente.id, motivo);
      await prisma.reunion.update({
        where: { id: siguiente.id },
        data:
          intentos >= MAXIMO_DE_INTENTOS
            ? { estado: "ERROR", intentos, motivoError: motivo }
            : { estado: "EN_COLA", intentos, motivoError: motivo },
      });
    }
  } finally {
    corriendo = false;
  }
}
