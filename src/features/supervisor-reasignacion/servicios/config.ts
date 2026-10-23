import { calcularReparto } from "@/lib/channel-collaborators";
import { prisma } from "@/lib/prisma";

import { leerAvisosCrudos, type ConfigDeAvisosCruda } from "@/features/avisos-gravedad/servicios/enrutador";

import {
  claveConfigReasignacion,
  leerConfigReasignacionDeTexto,
  type ConfigReasignacion,
} from "../dominio/reglas";

/**
 * Los ajustes de los avisos y la reasignación del Supervisor: AppSetting
 * `supervisor:reasignacion:<workspaceId>` (JSON). Sin fila, los dos interruptores apagados.
 * Sin caché: la vuelta de cada minuto y la pantalla leen siempre lo último que se guardó.
 */

const PREFIJO = "supervisor:reasignacion:";

export async function leerConfigReasignacion(workspaceId: string): Promise<ConfigReasignacion> {
  const fila = await prisma.appSetting.findUnique({ where: { key: claveConfigReasignacion(workspaceId) } }).catch(() => null);
  return leerConfigReasignacionDeTexto(fila?.value);
}

export async function guardarConfigReasignacion(workspaceId: string, config: ConfigReasignacion): Promise<void> {
  const key = claveConfigReasignacion(workspaceId);
  const value = JSON.stringify(config);
  await prisma.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

export type DatosDeLaTarjeta = {
  config: ConfigReasignacion;
  /** Las líneas administrativas del negocio (de ahí pueden salir los avisos). */
  lineasAdmin: Array<{ id: string; nombre: string; conectada: boolean }>;
  /** Asesoras de las líneas vigiladas sin número en la lista de avisos: no les llega el WhatsApp. */
  sinNumero: string[];
};

/** Lo que muestra la tarjeta de ajustes en la pantalla del Supervisor. */
export async function leerDatosDeLaTarjeta(workspaceId: string): Promise<DatosDeLaTarjeta> {
  const [config, lineas, avisos] = await Promise.all([
    leerConfigReasignacion(workspaceId),
    prisma.whatsAppChannel.findMany({ where: { workspaceId }, select: { id: true, name: true, purpose: true, metadata: true, evolutionInstanceName: true } }),
    leerAvisosCrudos(workspaceId).catch(() => ({}) as ConfigDeAvisosCruda),
  ]);
  const conNumero = new Set(
    (avisos.destinos ?? []).filter((d) => (d.numero ?? "").replace(/\D/g, "").length >= 10).flatMap((d) => [d.userId, d.soloDe].filter((x): x is string => Boolean(x))),
  );
  const vigiladas = lineas.filter((l) => {
    const meta = l.metadata && typeof l.metadata === "object" ? (l.metadata as Record<string, unknown>) : {};
    return meta.agenteV3 === true;
  });
  const asesoras = [...new Set(vigiladas.flatMap((l) => calcularReparto(l.metadata)))].filter((id) => !conNumero.has(id));
  const miembros = asesoras.length
    ? await prisma.workspaceMember.findMany({ where: { workspaceId, isActive: true, userId: { in: asesoras } }, select: { userId: true, user: { select: { name: true, email: true } } } })
    : [];
  return {
    config,
    lineasAdmin: lineas.filter((l) => l.purpose === "ADMIN").map((l) => ({ id: l.id, nombre: l.name, conectada: Boolean(l.evolutionInstanceName) })),
    sinNumero: miembros.map((m) => m.user?.name?.trim() || m.user?.email || m.userId),
  };
}

/** Los negocios con al menos un interruptor prendido (una consulta). */
export async function negociosConReasignacion(): Promise<Array<{ workspaceId: string; config: ConfigReasignacion }>> {
  const filas = await prisma.appSetting.findMany({ where: { key: { startsWith: PREFIJO } }, select: { key: true, value: true } }).catch(() => []);
  return filas
    .map((fila) => ({ workspaceId: fila.key.slice(PREFIJO.length), config: leerConfigReasignacionDeTexto(fila.value) }))
    .filter((n) => n.workspaceId && (n.config.avisosActivos || n.config.reasignacionActiva));
}
