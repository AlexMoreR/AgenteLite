import { prisma } from "@/lib/prisma";

import { numeroDeAvisosDeLaPersona } from "@/features/avisos-gravedad/servicios/enrutador";

import { conteoPorAsesora, rangoDelDiaBogota, type ConteoDeAsesora } from "../dominio/reglas";

/**
 * El registro de avisos y reasignaciones (tabla `SupervisorAviso`): la lista del día y el conteo por
 * asesora que usa el dueño y el resumen de las 7:30 (por el MCP). Solo lee.
 */

export type FilaDelRegistro = {
  id: string;
  tipo: string;
  conversationId: string;
  numero: number | null;
  asesoraId: string | null;
  asesora: string | null;
  asesoraNuevaId: string | null;
  asesoraNueva: string | null;
  minutosEsperando: number;
  whatsappEnviado: boolean;
  error: string | null;
  creadoEn: Date;
};

export type RegistroDelDia = {
  fecha: string;
  filas: FilaDelRegistro[];
  conteo: Array<ConteoDeAsesora & { asesora: string }>;
  totales: { avisos: number; reasignaciones: number; sinCandidata: number; whatsappFallidos: number };
};

/** null = la fecha no es válida o todavía no existe la tabla (falta la migración). */
export async function leerRegistroDelDia(workspaceId: string, fecha: string): Promise<RegistroDelDia | null> {
  const rango = rangoDelDiaBogota(fecha);
  if (!rango) return null;
  const crudas = await prisma.supervisorAviso
    .findMany({ where: { workspaceId, creadoEn: { gte: rango.desde, lt: rango.hasta } }, orderBy: { creadoEn: "desc" }, take: 500 })
    .catch(() => null);
  if (!crudas) return null;
  const idsDeUsuarios = [...new Set(crudas.flatMap((f) => [f.asesoraId, f.asesoraNuevaId]).filter((id): id is string => Boolean(id)))];
  const [usuarios, chats] = await Promise.all([
    idsDeUsuarios.length ? prisma.user.findMany({ where: { id: { in: idsDeUsuarios } }, select: { id: true, name: true, email: true } }) : Promise.resolve([]),
    crudas.length
      ? prisma.conversation.findMany({ where: { workspaceId, id: { in: [...new Set(crudas.map((f) => f.conversationId))] } }, select: { id: true, numero: true } })
      : Promise.resolve([]),
  ]);
  const nombres = new Map(usuarios.map((u) => [u.id, u.name?.trim() || u.email || "Sin nombre"]));
  const numeros = new Map(chats.map((c) => [c.id, c.numero]));
  const filas: FilaDelRegistro[] = crudas.map((f) => ({
    id: f.id,
    tipo: f.tipo,
    conversationId: f.conversationId,
    numero: numeros.get(f.conversationId) ?? null,
    asesoraId: f.asesoraId,
    asesora: f.asesoraId ? (nombres.get(f.asesoraId) ?? null) : null,
    asesoraNuevaId: f.asesoraNuevaId,
    asesoraNueva: f.asesoraNuevaId ? (nombres.get(f.asesoraNuevaId) ?? null) : null,
    minutosEsperando: f.minutosEsperando,
    whatsappEnviado: f.whatsappEnviado,
    error: f.error,
    creadoEn: f.creadoEn,
  }));
  return {
    fecha,
    filas,
    conteo: conteoPorAsesora(crudas).map((c) => ({ ...c, asesora: nombres.get(c.asesoraId) ?? "Sin nombre" })),
    totales: {
      avisos: filas.filter((f) => f.tipo !== "REASIGNACION" && f.tipo !== "SIN_CANDIDATA").length,
      reasignaciones: filas.filter((f) => f.tipo === "REASIGNACION").length,
      sinCandidata: filas.filter((f) => f.tipo === "SIN_CANDIDATA").length,
      whatsappFallidos: filas.filter((f) => f.tipo !== "SIN_CANDIDATA" && !f.whatsappEnviado).length,
    },
  };
}

/** Las líneas del negocio (para elegir desde cuál salen los avisos). */
export async function leerLineasParaAvisos(workspaceId: string): Promise<Array<{ id: string; nombre: string; esAdmin: boolean }>> {
  const lineas = await prisma.whatsAppChannel
    .findMany({ where: { workspaceId, isActive: true }, select: { id: true, name: true, purpose: true }, orderBy: { name: "asc" } })
    .catch(() => []);
  return lineas.map((l) => ({ id: l.id, nombre: l.name, esAdmin: l.purpose === "ADMIN" }));
}

/** Las asesoras con chats abiertos recientes que no tienen número de avisos (no reciben el WhatsApp). */
export async function asesorasSinNumeroDeAvisos(workspaceId: string, ahora = new Date()): Promise<string[]> {
  const grupos = await prisma.conversation
    .groupBy({
      by: ["assignedToUserId"],
      where: { workspaceId, status: "OPEN", assignedToUserId: { not: null }, lastMessageAt: { gte: new Date(ahora.getTime() - 3 * 86_400_000) } },
    })
    .catch(() => []);
  const sin: string[] = [];
  for (const grupo of grupos) {
    const userId = grupo.assignedToUserId;
    if (!userId) continue;
    if (await numeroDeAvisosDeLaPersona(workspaceId, userId).catch(() => null)) continue;
    const usuario = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } }).catch(() => null);
    sin.push(usuario?.name?.trim() || usuario?.email || userId);
  }
  return sin;
}
