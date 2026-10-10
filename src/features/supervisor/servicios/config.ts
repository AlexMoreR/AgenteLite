import { prisma } from "@/lib/prisma";

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
