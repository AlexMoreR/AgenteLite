import { CacheConTtl } from "@/lib/cache-en-memoria";
import type { CanalDelNegocio } from "@/lib/canales-del-negocio";
import type { ClientWorkspaceAccess } from "@/lib/client-workspace-access";

/**
 * Las caches de "quien es y que puede ver" que usan las rutas de Chats (list, counts, live, summary).
 *
 * Lo que se guarda (45 s, hasta 500 entradas cada una):
 *  - acceso por usuario: rol, negocio, rol en el negocio, modulos (getClientWorkspaceAccessForUser).
 *  - supervisoras por negocio (AppSetting `equipo:supervisoras:<id>`).
 *  - canales por negocio, con sus colaboradoras y monitoras (de ahi salen las lineas que ve cada
 *    persona y las que solo monitorea).
 *
 * COMO SE MANTIENE AL DIA: `prisma.ts` llama a `invalidarTrasEscritura` despues de CADA escritura
 * que pasa por Prisma (create/update/upsert/delete y sus *Many) sobre User, WorkspaceMember,
 * Workspace, WhatsAppChannel o AppSetting. Asi no depende de acordarse de invalidar en cada accion
 * de administracion (hay mas de 40 lugares que escriben esos modelos). Un cambio hecho desde la app
 * se ve en el pedido siguiente.
 *
 * El TTL queda como red: un cambio hecho POR FUERA de este proceso (un script contra la base, SQL a
 * mano, un borrado en cascada de la base) tarda hasta 45 s en verse.
 */
export const TTL_PERMISOS_MS = 45_000;
const MAX_ENTRADAS = 500;

export const cacheDeAcceso = new CacheConTtl<ClientWorkspaceAccess | null>({ ttlMs: TTL_PERMISOS_MS, maxEntradas: MAX_ENTRADAS });
export const cacheDeSupervisoras = new CacheConTtl<string[]>({ ttlMs: TTL_PERMISOS_MS, maxEntradas: MAX_ENTRADAS });
export const cacheDeCanales = new CacheConTtl<CanalDelNegocio[]>({ ttlMs: TTL_PERMISOS_MS, maxEntradas: MAX_ENTRADAS });

export const PREFIJO_SUPERVISORAS = "equipo:supervisoras:";

const OPERACIONES_DE_ESCRITURA = new Set([
  "create",
  "createMany",
  "createManyAndReturn",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "upsert",
  "delete",
  "deleteMany",
]);

function claveDeAppSetting(args: unknown): string | null {
  if (!args || typeof args !== "object") return null;
  const a = args as { where?: { key?: unknown }; create?: { key?: unknown }; data?: { key?: unknown } };
  for (const candidato of [a.where?.key, a.create?.key, a.data?.key]) {
    if (typeof candidato === "string") return candidato;
  }
  return null;
}

/**
 * Despues de una escritura de Prisma: borra lo que pudo quedar viejo. Es grueso a proposito (vacia
 * la cache entera del modelo): recargar cuesta una consulta, y servir un permiso viejo no.
 */
export function invalidarTrasEscritura(model: string | undefined, operation: string, args?: unknown) {
  if (!model || !OPERACIONES_DE_ESCRITURA.has(operation)) {
    return;
  }
  invalidarModelo(model, operation, args);
  /*
    Y otra vez a los 2 s: dentro de una transaccion la escritura se ve recien al confirmar, y un
    pedido que lea JUSTO en el medio volveria a guardar el dato de antes por 45 s.
  */
  const segunda = setTimeout(() => invalidarModelo(model, operation, args), 2_000);
  segunda.unref?.();
}

function invalidarModelo(model: string, operation: string, args: unknown) {
  switch (model) {
    case "User":
    case "WorkspaceMember":
    case "Workspace":
      cacheDeAcceso.vaciar();
      if (model === "Workspace" && (operation === "delete" || operation === "deleteMany")) {
        cacheDeCanales.vaciar();
        cacheDeSupervisoras.vaciar();
      }
      return;
    case "WhatsAppChannel":
      cacheDeCanales.vaciar();
      return;
    case "AppSetting": {
      const clave = claveDeAppSetting(args);
      if (clave === null) {
        cacheDeSupervisoras.vaciar();
      } else if (clave.startsWith(PREFIJO_SUPERVISORAS)) {
        cacheDeSupervisoras.invalidar(clave.slice(PREFIJO_SUPERVISORAS.length));
      }
      return;
    }
    default:
      return;
  }
}

/** Para las pruebas. */
export function vaciarCachesDePermisos() {
  cacheDeAcceso.vaciar();
  cacheDeSupervisoras.vaciar();
  cacheDeCanales.vaciar();
}
