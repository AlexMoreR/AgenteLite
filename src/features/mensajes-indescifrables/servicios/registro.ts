import { prisma } from "@/lib/prisma";

import {
  CLAVE_DEL_LATIDO,
  LARGO_MINIMO_DEL_ID,
  claveDelModo,
  fechaAceptable,
  leerModo,
  revisarEnDe,
  type LoteDeIndescifrables,
  type Modo,
} from "../dominio/reglas";

/**
 * LA COLA de los mensajes indescifrables (servicio). Las reglas están en ../dominio/reglas.ts.
 *
 * Entra por dos lados: el vigilante del log de WAHA (POST /api/interno/mensajes-indescifrables) y el
 * webhook de WAHA, que avisa "este sí llegó" con los eventos que no dejan Message (reacciones,
 * ediciones y borrados, mensajes sin texto ni archivo). Idempotente por (channelId, idCrudo): el
 * vigilante puede mandar el mismo evento dos veces al reiniciarse y no pasa nada.
 */

const cacheDelModo = new Map<string, { modo: Modo; vence: number }>();

/** El modo del negocio, guardado 60 s en memoria: el webhook lo pregunta en cada reacción. */
export async function leerModoDelNegocio(workspaceId: string, ahora = Date.now()): Promise<Modo> {
  const guardado = cacheDelModo.get(workspaceId);
  if (guardado && guardado.vence > ahora) return guardado.modo;
  const fila = await prisma.appSetting.findUnique({ where: { key: claveDelModo(workspaceId) }, select: { value: true } });
  const modo = leerModo(fila?.value);
  cacheDelModo.set(workspaceId, { modo, vence: ahora + 60_000 });
  return modo;
}

export type ResultadoDelLote = {
  recibidos: number;
  guardados: number;
  /** De hace más de 24 h o del futuro. */
  fueraDeTiempo: number;
  /** La sesión no es de ninguna línea del CRM. */
  sinLinea: number;
  /** El negocio de la línea está en APAGADO. */
  apagados: number;
};

export async function registrarLote(lote: LoteDeIndescifrables, ahora = new Date()): Promise<ResultadoDelLote> {
  if (lote.latido) {
    const valor = ahora.toISOString();
    await prisma.appSetting.upsert({ where: { key: CLAVE_DEL_LATIDO }, create: { key: CLAVE_DEL_LATIDO, value: valor }, update: { value: valor } });
  }
  const resultado: ResultadoDelLote = { recibidos: lote.eventos.length, guardados: 0, fueraDeTiempo: 0, sinLinea: 0, apagados: 0 };
  const vigentes = lote.eventos.filter((evento) => fechaAceptable(new Date(evento.ocurridoEn), ahora));
  resultado.fueraDeTiempo = lote.eventos.length - vigentes.length;
  if (vigentes.length === 0) return resultado;

  const canales = await prisma.whatsAppChannel.findMany({
    where: { evolutionInstanceName: { in: [...new Set(vigentes.map((evento) => evento.sesion))] } },
    select: { id: true, workspaceId: true, evolutionInstanceName: true },
  });
  const porSesion = new Map(canales.map((canal) => [canal.evolutionInstanceName as string, canal]));
  const modos = new Map<string, Modo>();
  for (const workspaceId of new Set(canales.map((canal) => canal.workspaceId))) {
    modos.set(workspaceId, await leerModoDelNegocio(workspaceId, ahora.getTime()));
  }

  const filas = [];
  for (const evento of vigentes) {
    const canal = porSesion.get(evento.sesion);
    if (!canal) {
      resultado.sinLinea += 1;
      continue;
    }
    if (modos.get(canal.workspaceId) === "APAGADO") {
      resultado.apagados += 1;
      continue;
    }
    const ocurridoEn = new Date(evento.ocurridoEn);
    filas.push({
      workspaceId: canal.workspaceId,
      channelId: canal.id,
      idCrudo: evento.idCrudo,
      lid: evento.lid,
      ocurridoEn,
      revisarEn: revisarEnDe(ocurridoEn),
    });
  }
  if (filas.length > 0) {
    const { count } = await prisma.mensajeIndescifrable.createMany({ data: filas, skipDuplicates: true });
    resultado.guardados = count;
  }
  if (resultado.sinLinea > 0) console.warn("[indescifrables] eventos de una sesión sin línea en el CRM", { sinLinea: resultado.sinLinea });
  return resultado;
}

/**
 * El webhook vio pasar un evento de WAHA con este id que no deja Message: el mensaje SÍ llegó.
 *
 * Si el evento le gana al vigilante (la fila todavía no existe), se deja la fila ya en LLEGO: cuando el
 * vigilante la mande, `skipDuplicates` la deja como está y nunca se da por perdida. Nunca lanza.
 */
export async function marcarLlegoPorWebhook(input: { sesion: string; idCrudo: string }, ahora = new Date()): Promise<void> {
  try {
    if (!/^[A-Za-z0-9]+$/.test(input.idCrudo) || input.idCrudo.length < LARGO_MINIMO_DEL_ID) return;
    const canal = await prisma.whatsAppChannel.findUnique({
      where: { evolutionInstanceName: input.sesion },
      select: { id: true, workspaceId: true },
    });
    if (!canal || (await leerModoDelNegocio(canal.workspaceId, ahora.getTime())) === "APAGADO") return;
    const { count } = await prisma.mensajeIndescifrable.updateMany({
      where: { channelId: canal.id, idCrudo: input.idCrudo, estado: { in: ["PENDIENTE", "REVISANDO"] } },
      data: { estado: "LLEGO", resueltoEn: ahora },
    });
    if (count > 0) {
      console.log("[indescifrables] llegó por el webhook", { sesion: input.sesion, idCrudo: input.idCrudo });
      return;
    }
    await prisma.mensajeIndescifrable.createMany({
      data: [{ workspaceId: canal.workspaceId, channelId: canal.id, idCrudo: input.idCrudo, ocurridoEn: ahora, revisarEn: ahora, estado: "LLEGO", resueltoEn: ahora }],
      skipDuplicates: true,
    });
  } catch (error) {
    console.warn("[indescifrables] no se pudo marcar como llegado", error instanceof Error ? error.message : String(error));
  }
}
