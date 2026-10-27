import { calcularReparto } from "@/lib/channel-collaborators";
import { prisma } from "@/lib/prisma";

import { numeroDeAvisosDeLaPersona } from "@/features/avisos-gravedad/servicios/enrutador";

import { conteoPorAsesora, rangoDelDiaBogota, type ConteoDeAsesora } from "../dominio/reglas";

/** El registro de avisos y reasignaciones de un día (hora de Colombia), con nombres. Solo lectura. */

export type FilaDelRegistro = {
  id: string;
  tipo: string;
  conversationId: string;
  asesoraId: string | null;
  asesora: string | null;
  asesoraNuevaId: string | null;
  asesoraNueva: string | null;
  minutosEsperando: number | null;
  whatsappEnviado: boolean;
  error: string | null;
  creadoEn: Date;
};

export type RegistroDelDia = {
  fecha: string;
  filas: FilaDelRegistro[];
  conteo: Array<ConteoDeAsesora & { asesora: string }>;
  total: number;
};

const TOPE_DE_FILAS = 300;

export async function leerRegistroDelDia(workspaceId: string, fecha: string): Promise<RegistroDelDia | null> {
  const rango = rangoDelDiaBogota(fecha);
  if (!rango) return null;
  const donde = { workspaceId, creadoEn: { gte: rango.desde, lt: rango.hasta } };
  const [filas, total] = await Promise.all([
    prisma.supervisorAviso.findMany({ where: donde, orderBy: { creadoEn: "desc" }, take: TOPE_DE_FILAS }),
    prisma.supervisorAviso.count({ where: donde }),
  ]);
  // El conteo se hace sobre TODO el día, no sobre las filas que caben en la lista.
  const paraContar =
    total > filas.length
      ? await prisma.supervisorAviso.findMany({ where: donde, select: { tipo: true, asesoraId: true, asesoraNuevaId: true } })
      : filas;
  const ids = [...new Set(paraContar.flatMap((f) => [f.asesoraId, f.asesoraNuevaId]).filter((id): id is string => Boolean(id)))];
  const usuarios = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } }) : [];
  const nombres = new Map(usuarios.map((u) => [u.id, u.name?.trim() || u.email || "Asesora"]));
  const nombre = (id: string | null) => (id ? (nombres.get(id) ?? "Asesora") : null);
  return {
    fecha,
    total,
    filas: filas.map((f) => ({
      id: f.id,
      tipo: f.tipo,
      conversationId: f.conversationId,
      asesoraId: f.asesoraId,
      asesora: nombre(f.asesoraId),
      asesoraNuevaId: f.asesoraNuevaId,
      asesoraNueva: nombre(f.asesoraNuevaId),
      minutosEsperando: f.minutosEsperando,
      whatsappEnviado: f.whatsappEnviado,
      error: f.error,
      creadoEn: f.creadoEn,
    })),
    conteo: conteoPorAsesora(paraContar).map((c) => ({ ...c, asesora: nombre(c.asesoraId) ?? "Asesora" })),
  };
}

/** Asesoras de las líneas del V3 que no tienen número de avisos en Mi empresa → Equipo (no recibirían el WhatsApp). */
export async function asesorasSinNumeroDeAvisos(workspaceId: string): Promise<string[]> {
  const canales = await prisma.whatsAppChannel.findMany({
    where: { workspaceId, metadata: { path: ["agenteV3"], equals: true } },
    select: { metadata: true },
  });
  const ids = [...new Set(canales.flatMap((canal) => calcularReparto(canal.metadata)))];
  if (!ids.length) return [];
  const sinNumero: string[] = [];
  for (const id of ids) {
    if (!(await numeroDeAvisosDeLaPersona(workspaceId, id).catch(() => null))) sinNumero.push(id);
  }
  const usuarios = await prisma.user.findMany({ where: { id: { in: sinNumero } }, select: { id: true, name: true, email: true } });
  return usuarios.map((u) => u.name?.trim() || u.email || "Asesora");
}
