import { prisma } from "@/lib/prisma";

import { nombresDeAsesoras } from "@/features/supervisor/servicios/datos";

import { conteoPorAsesora, fechaBogota, rangoDelDia, type ConteoDeAsesora } from "../dominio/reglas";

/**
 * EL REGISTRO de avisos y reasignaciones (solo lectura): la lista de un día y el conteo por asesora.
 * Lo usan la pantalla del Supervisor (hoy) y la herramienta del MCP `avisos_y_reasignaciones`
 * (por defecto ayer, para el resumen de las 7:30).
 */

export type FilaDelDia = {
  id: string;
  tipo: string;
  conversationId: string;
  numeroDelChat: number | null;
  asesoraId: string;
  asesora: string;
  asesoraNuevaId: string | null;
  asesoraNueva: string | null;
  minutosEsperando: number;
  whatsappEnviado: boolean;
  error: string | null;
  creadoEn: Date;
};

export type RegistroDelDia = {
  fecha: string;
  filas: FilaDelDia[];
  conteo: Array<ConteoDeAsesora & { asesora: string }>;
};

export async function leerRegistroDelDia(workspaceId: string, fecha = fechaBogota(new Date())): Promise<RegistroDelDia | null> {
  const rango = rangoDelDia(fecha);
  if (!rango) return null;
  const filas = await prisma.supervisorAviso.findMany({
    where: { workspaceId, creadoEn: { gte: rango.desde, lt: rango.hasta } },
    orderBy: { creadoEn: "desc" },
    take: 1000,
  });
  const [nombres, conversaciones] = await Promise.all([
    nombresDeAsesoras(workspaceId).catch(() => ({}) as Record<string, string>),
    filas.length
      ? prisma.conversation.findMany({ where: { workspaceId, id: { in: [...new Set(filas.map((f) => f.conversationId))] } }, select: { id: true, numero: true } })
      : Promise.resolve([] as Array<{ id: string; numero: number | null }>),
  ]);
  const numeros = new Map(conversaciones.map((c) => [c.id, c.numero]));
  const nombre = (id: string) => nombres[id] ?? id;
  return {
    fecha,
    filas: filas.map((f) => ({
      id: f.id,
      tipo: f.tipo,
      conversationId: f.conversationId,
      numeroDelChat: numeros.get(f.conversationId) ?? null,
      asesoraId: f.asesoraId,
      asesora: nombre(f.asesoraId),
      asesoraNuevaId: f.asesoraNuevaId,
      asesoraNueva: f.asesoraNuevaId ? nombre(f.asesoraNuevaId) : null,
      minutosEsperando: f.minutosEsperando,
      whatsappEnviado: f.whatsappEnviado,
      error: f.error,
      creadoEn: f.creadoEn,
    })),
    conteo: conteoPorAsesora(filas).map((c) => ({ ...c, asesora: nombre(c.asesoraId) })),
  };
}
