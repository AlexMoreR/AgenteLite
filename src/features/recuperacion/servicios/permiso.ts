import { CacheConTtl } from "@/lib/cache-en-memoria";
import { esJefeDelNegocio } from "@/lib/permisos-del-crm";
import { prisma } from "@/lib/prisma";

export { esJefeDelNegocio };

/**
 * Quién ve el módulo Recuperación: desde el 26-10-2026 solo el dueño o un administrador del negocio
 * (antes también LA supervisora del Supervisor accionable, hoy Ingrid). Las demás cuentas no.
 *
 * `esLaSupervisora` sigue existiendo para otros usos; se lee de AppSetting con un minuto de memoria.
 */

const supervisoras = new CacheConTtl<string | null>({ ttlMs: 60_000, maxEntradas: 50 });

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

/** La supervisora configurada en el Supervisor accionable (hoy Ingrid). */
export async function esLaSupervisora(workspaceId: string, userId: string): Promise<boolean> {
  return (await supervisoraDelAccionable(workspaceId)) === userId;
}

export async function puedeVerRecuperacion(access: {
  workspaceId: string;
  userId: string;
  isOwner: boolean;
  role: string;
  membershipRole: string;
}): Promise<boolean> {
  return esJefeDelNegocio(access);
}
