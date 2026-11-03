// Servicio del Coach con Opus (parte 1, 3-nov-2026): el interruptor, guardar y leer la revisión
// diaria de cada asesora (tabla CoachRevision). Las reglas puras están en reglas.ts.
// No toca el Coach viejo (CoachInforme / CoachAsesora) ni manda mensajes: los avisos los arma
// reglas.ts y los manda otra parte.
import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

import { taparTelefonos, validarRevision, type ChatRevisado, type DatosDeRevision } from "./reglas";

const CLAVE_ACTIVO = (workspaceId: string) => `coach-opus:${workspaceId}`;
const CLAVE_SALTADO = (workspaceId: string) => `coach-opus-saltado:${workspaceId}`;
/** Cuántos días saltados se guardan (los más nuevos). */
const DIAS_SALTADOS_GUARDADOS = 30;

const FECHA_VALIDA = /^\d{4}-\d{2}-\d{2}$/;

/** AAAA-MM-DD y que sea un día que existe (nada de 2026-02-31). */
export function esFechaValida(fecha: string) {
  if (!FECHA_VALIDA.test(fecha)) return false;
  const dia = new Date(`${fecha}T00:00:00Z`);
  return !Number.isNaN(dia.getTime()) && dia.toISOString().slice(0, 10) === fecha;
}

/** ¿Está prendido el Coach con Opus en este negocio? Sin fila está apagado. */
export async function coachOpusActivo(workspaceId: string) {
  const fila = await prisma.appSetting.findUnique({ where: { key: CLAVE_ACTIVO(workspaceId) } });
  return fila?.value === "1";
}

export async function guardarCoachOpusActivo(workspaceId: string, activo: boolean) {
  const value = activo ? "1" : "0";
  await prisma.appSetting.upsert({
    where: { key: CLAVE_ACTIVO(workspaceId) },
    create: { key: CLAVE_ACTIVO(workspaceId), value },
    update: { value },
  });
}

export type RevisionGuardada = {
  id: string;
  workspaceId: string;
  fecha: string;
  userId: string;
  nombre: string;
  modelo: string;
  resumen: string;
  chats: ChatRevisado[];
  chatsLeidos: number;
  avisadoEn: Date | null;
  creadoEn: Date;
  actualizadoEn: Date;
};

export type ResultadoDeGuardar =
  | { apagado: true }
  | { ok: false; errores: string[] }
  | { ok: true; revision: RevisionGuardada };

function aRevision(fila: {
  id: string;
  workspaceId: string;
  fecha: string;
  userId: string;
  nombre: string;
  modelo: string;
  resumen: string;
  chats: Prisma.JsonValue;
  chatsLeidos: number;
  avisadoEn: Date | null;
  creadoEn: Date;
  actualizadoEn: Date;
}): RevisionGuardada {
  return { ...fila, chats: Array.isArray(fila.chats) ? (fila.chats as unknown as ChatRevisado[]) : [] };
}

/**
 * Guarda (o reemplaza) la revisión de una asesora en un día. Si el interruptor está apagado no
 * guarda nada y devuelve { apagado: true }. Si la revisión no pasa las reglas, devuelve los errores.
 * La asesora tiene que ser miembro activo del negocio: nadie guarda revisiones de otro negocio.
 */
export async function guardarRevision(
  workspaceId: string,
  fecha: string,
  userId: string,
  datos: DatosDeRevision,
): Promise<ResultadoDeGuardar> {
  if (!(await coachOpusActivo(workspaceId))) return { apagado: true };

  const errores: string[] = [];
  if (!esFechaValida(fecha)) errores.push(`La fecha "${fecha}" no es AAAA-MM-DD.`);
  if (!userId?.trim()) errores.push("Falta la asesora (userId).");
  errores.push(...validarRevision(datos));
  if (errores.length) return { ok: false, errores };

  const miembro = await prisma.workspaceMember.findFirst({
    where: { workspaceId, userId, isActive: true },
    select: { id: true },
  });
  if (!miembro) return { ok: false, errores: ["Esa asesora no es del equipo de este negocio."] };

  // Solo los campos conocidos de cada chat: nada extra que mande el modelo se guarda.
  const chats = datos.chats.map((chat) => ({
    chatId: chat.chatId.trim(),
    tipo: chat.tipo,
    quePaso: chat.quePaso,
    momentoCaida: chat.momentoCaida,
    mensajeModelo: chat.mensajeModelo,
    causa: chat.causa,
  }));
  const valores = {
    nombre: datos.nombre.trim(),
    modelo: datos.modelo.trim(),
    resumen: datos.resumen.trim(),
    chats: chats as unknown as Prisma.InputJsonValue,
    chatsLeidos: datos.chatsLeidos,
  };
  const fila = await prisma.coachRevision.upsert({
    where: { workspaceId_fecha_userId: { workspaceId, fecha, userId } },
    create: { workspaceId, fecha, userId, ...valores },
    // Si la revisión cambia, el aviso vuelve a quedar pendiente.
    update: { ...valores, avisadoEn: null },
  });
  return { ok: true, revision: aRevision(fila) };
}

/** La última revisión de esa asesora (o la de ese día, si se pasa la fecha). Null si no hay. */
export async function leerRevision(workspaceId: string, userId: string, fecha?: string) {
  const fila = await prisma.coachRevision.findFirst({
    where: { workspaceId, userId, ...(fecha ? { fecha } : {}) },
    orderBy: { fecha: "desc" },
  });
  return fila ? aRevision(fila) : null;
}

/** Todas las revisiones de un día en el negocio, por nombre de la asesora. */
export async function revisionesDelDia(workspaceId: string, fecha: string) {
  const filas = await prisma.coachRevision.findMany({
    where: { workspaceId, fecha },
    orderBy: { nombre: "asc" },
  });
  return filas.map(aRevision);
}

/** Marca que ya se le mandó el WhatsApp a la asesora. Devuelve false si la revisión no existe. */
export async function marcarAvisada(id: string) {
  const { count } = await prisma.coachRevision.updateMany({ where: { id }, data: { avisadoEn: new Date() } });
  return count > 0;
}

export type DiaSaltado = { fecha: string; motivo: string; en: string };

function leerSaltados(valor: string | undefined): DiaSaltado[] {
  if (!valor) return [];
  try {
    const lista = JSON.parse(valor);
    return Array.isArray(lista) ? lista.filter((d) => d && typeof d.fecha === "string") : [];
  } catch {
    return [];
  }
}

/** Los días que el Coach con Opus no corrió y por qué (los más nuevos primero). */
export async function diasSaltados(workspaceId: string) {
  const fila = await prisma.appSetting.findUnique({ where: { key: CLAVE_SALTADO(workspaceId) } });
  return leerSaltados(fila?.value);
}

/**
 * Anota que un día no se hizo la revisión y por qué (por ejemplo, aizen1 apagado). Se guardan los
 * últimos 30 días; si el día ya estaba anotado, se reemplaza el motivo.
 */
export async function registrarDiaSaltado(workspaceId: string, fecha: string, motivo: string) {
  if (!esFechaValida(fecha)) throw new Error(`La fecha "${fecha}" no es AAAA-MM-DD.`);
  const key = CLAVE_SALTADO(workspaceId);
  const anteriores = await diasSaltados(workspaceId);
  const nuevo: DiaSaltado = {
    fecha,
    motivo: taparTelefonos(String(motivo ?? "")).trim().slice(0, 300) || "sin motivo",
    en: new Date().toISOString(),
  };
  const lista = [nuevo, ...anteriores.filter((d) => d.fecha !== fecha)]
    .sort((a, b) => b.fecha.localeCompare(a.fecha))
    .slice(0, DIAS_SALTADOS_GUARDADOS);
  const value = JSON.stringify(lista);
  await prisma.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
  return nuevo;
}
