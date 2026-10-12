import { prisma } from "@/lib/prisma";

import { interpretarRevalidacion } from "../dominio/revalidacion";

/**
 * EL INTERRUPTOR DEL SUPERVISOR. APAGADO POR DEFECTO.
 *
 * - `supervisor:activo:<workspaceId>` = "true" lo prende para ese negocio. Sin fila, o con
 *   cualquier otro valor, el Supervisor no corre: ni consultas pesadas, ni escrituras, ni avisos.
 * - `supervisor:libro-visto:<workspaceId>`: la última versión del libro V3 que el Supervisor ya
 *   revisó con el Change Guardian (para notar el cambio siguiente).
 *
 * Prenderlo en producción requiere autorización de Alexander (y antes, la migración de
 * SupervisorAlerta).
 */

export const PREFIJO_INTERRUPTOR = "supervisor:activo:";
export const claveInterruptorSupervisor = (workspaceId: string) => `${PREFIJO_INTERRUPTOR}${workspaceId}`;
export const claveLibroVisto = (workspaceId: string) => `supervisor:libro-visto:${workspaceId}`;

/**
 * REVALIDACIÓN DE INCIDENTES VIEJOS (dominio/revalidacion.ts): `supervisor:revalidacion:<workspaceId>`.
 *
 * - "false" / "0" / "no" / "off" / "apagado" → apagada: exactamente lo de antes.
 * - Cualquier otro valor ("true") → prendida.
 * - Sin fila → REVALIDACION_POR_DEFECTO. Prendida por defecto (pedido de Alexander del 11-oct-2026):
 *   así la primera vuelta de cada hora después de publicar revalida y cierra sola la alerta de la
 *   v182, sin escribir nada a mano en la base. Para apagarla basta crear la fila con "false".
 */
export const claveRevalidacion = (workspaceId: string) => `supervisor:revalidacion:${workspaceId}`;

export async function revalidacionActiva(workspaceId: string): Promise<boolean> {
  try {
    const fila = await prisma.appSetting.findUnique({ where: { key: claveRevalidacion(workspaceId) } });
    return interpretarRevalidacion(fila?.value);
  } catch {
    // Si no se puede leer, lo de antes (no decidir sin saber).
    return false;
  }
}

/** Los negocios con el Supervisor prendido. Una sola consulta barata (por clave). */
export async function negociosConSupervisor(): Promise<string[]> {
  try {
    const filas = await prisma.appSetting.findMany({
      where: { key: { startsWith: PREFIJO_INTERRUPTOR } },
      select: { key: true, value: true },
    });
    return filas
      .filter((fila) => (fila.value ?? "").trim().toLowerCase() === "true")
      .map((fila) => fila.key.slice(PREFIJO_INTERRUPTOR.length))
      .filter(Boolean);
  } catch {
    return [];
  }
}

export async function supervisorActivo(workspaceId: string): Promise<boolean> {
  const fila = await prisma.appSetting.findUnique({ where: { key: claveInterruptorSupervisor(workspaceId) } }).catch(() => null);
  return (fila?.value ?? "").trim().toLowerCase() === "true";
}
