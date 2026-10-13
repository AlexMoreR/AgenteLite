import { CacheConTtl } from "@/lib/cache-en-memoria";
import { prisma } from "@/lib/prisma";

/**
 * Quién ve el módulo Recuperación (Alex, 13-10-2026): el dueño o un administrador del negocio (igual
 * que el Supervisor en el menú) y LA supervisora del Supervisor accionable
 * (`supervisor:accionable:<ws>`.supervisoraId). Las asesoras no.
 *
 * La supervisora se lee directo de AppSetting (sin cargar el servicio del accionable) con un minuto
 * de memoria: el menú lo pregunta en cada página.
 */

const supervisoras = new CacheConTtl<string | null>({ ttlMs: 60_000, maxEntradas: 50 });

export function esJefeDelNegocio(access: { isOwner: boolean; role: string; membershipRole: string }): boolean {
  return access.isOwner || access.role === "ADMIN" || access.membershipRole === "OWNER" || access.membershipRole === "ADMIN";
}

async function supervisoraDelAccionable(workspaceId: string): Promise<string | null> {
  return supervisoras.obtener(workspaceId, async () => {
    const fila = await prisma.appSetting.findUnique({ where: { key: `supervisor:accionable:${workspaceId}` } }).catch(() => null);
    try {
      const valor = fila?.value ? (JSON.parse(fila.value) as { supervisoraId?: unknown }) : null;
      return typeof valor?.supervisoraId === "string" && valor.supervisoraId.trim() ? valor.supervisoraId.trim() : null;
    } catch {
      return null;
    }
  });
}

export async function puedeVerRecuperacion(access: {
  workspaceId: string;
  userId: string;
  isOwner: boolean;
  role: string;
  membershipRole: string;
}): Promise<boolean> {
  if (esJefeDelNegocio(access)) return true;
  return (await supervisoraDelAccionable(access.workspaceId)) === access.userId;
}
