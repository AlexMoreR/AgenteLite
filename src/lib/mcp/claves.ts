import { createHash, randomBytes } from "node:crypto";

import { prisma } from "@/lib/prisma";

/*
  Claves para conectar Claude al CRM por MCP.

  Cada clave pertenece a UN negocio: todo lo que Claude lee con ella sale de ese workspace y de
  ningun otro. Es la condicion para ofrecerlo a otros negocios (Alex, 14-sep-2026).

  Se guarda solo la HUELLA (sha256), nunca la clave: quien lea la base no puede usarla. La clave se
  muestra una sola vez, al crearla. Vive en AppSetting para no migrar la base de produccion.
*/

const PREFIJO_CLAVE = "aizen_mcp_";
const PREFIJO_AJUSTE = "mcp:clave:";

export type ClaveMcp = {
  /** Los primeros 12 caracteres de la huella: sirve para listar y revocar sin exponer nada. */
  id: string;
  workspaceId: string;
  userId: string;
  nombre: string;
  creadaEl: string;
  ultimoUso: string | null;
};

type ClaveGuardada = Omit<ClaveMcp, "id">;

function huella(clave: string) {
  return createHash("sha256").update(clave).digest("hex");
}

function leer(valor: string): ClaveGuardada | null {
  try {
    const dato = JSON.parse(valor) as Partial<ClaveGuardada>;
    if (typeof dato.workspaceId !== "string" || typeof dato.userId !== "string") {
      return null;
    }
    return {
      workspaceId: dato.workspaceId,
      userId: dato.userId,
      nombre: typeof dato.nombre === "string" ? dato.nombre : "Claude",
      creadaEl: typeof dato.creadaEl === "string" ? dato.creadaEl : new Date(0).toISOString(),
      ultimoUso: typeof dato.ultimoUso === "string" ? dato.ultimoUso : null,
    };
  } catch {
    return null;
  }
}

/** Crea una clave y la devuelve UNA vez. Despues solo queda su huella. */
export async function crearClaveMcp(input: { workspaceId: string; userId: string; nombre: string }) {
  const clave = `${PREFIJO_CLAVE}${randomBytes(32).toString("hex")}`;
  const guardada: ClaveGuardada = {
    workspaceId: input.workspaceId,
    userId: input.userId,
    nombre: input.nombre.trim().slice(0, 60) || "Claude",
    creadaEl: new Date().toISOString(),
    ultimoUso: null,
  };
  await prisma.appSetting.create({
    data: { key: `${PREFIJO_AJUSTE}${huella(clave)}`, value: JSON.stringify(guardada) },
  });
  return clave;
}

/** A que negocio y persona pertenece la clave, o null si no existe o fue revocada. */
export async function validarClaveMcp(clave: string | null | undefined) {
  if (!clave || !clave.startsWith(PREFIJO_CLAVE) || clave.length > 200) {
    return null;
  }
  const key = `${PREFIJO_AJUSTE}${huella(clave)}`;
  const fila = await prisma.appSetting.findUnique({ where: { key } });
  const guardada = fila ? leer(fila.value) : null;
  if (!guardada) {
    return null;
  }

  // La persona tiene que seguir activa en ese negocio: una asesora que se va se lleva su acceso.
  const miembro = await prisma.workspaceMember.findFirst({
    where: { workspaceId: guardada.workspaceId, userId: guardada.userId, isActive: true },
    select: { role: true },
  });
  if (!miembro) {
    return null;
  }

  // El ultimo uso se anota como mucho una vez por hora: no hace falta escribir en cada consulta.
  const haceUnaHora = Date.now() - 60 * 60 * 1000;
  if (!guardada.ultimoUso || new Date(guardada.ultimoUso).getTime() < haceUnaHora) {
    await prisma.appSetting
      .update({ where: { key }, data: { value: JSON.stringify({ ...guardada, ultimoUso: new Date().toISOString() }) } })
      .catch(() => undefined);
  }

  return { workspaceId: guardada.workspaceId, userId: guardada.userId };
}

export async function listarClavesMcp(workspaceId: string): Promise<ClaveMcp[]> {
  const filas = await prisma.appSetting.findMany({
    where: { key: { startsWith: PREFIJO_AJUSTE } },
    select: { key: true, value: true },
  });
  return filas
    .map((fila) => {
      const guardada = leer(fila.value);
      return guardada ? { ...guardada, id: fila.key.slice(PREFIJO_AJUSTE.length, PREFIJO_AJUSTE.length + 12) } : null;
    })
    .filter((clave): clave is ClaveMcp => Boolean(clave && clave.workspaceId === workspaceId))
    .sort((a, b) => b.creadaEl.localeCompare(a.creadaEl));
}

export async function revocarClaveMcp(workspaceId: string, id: string) {
  if (!/^[0-9a-f]{12}$/.test(id)) {
    return false;
  }
  const filas = await prisma.appSetting.findMany({
    where: { key: { startsWith: `${PREFIJO_AJUSTE}${id}` } },
    select: { key: true, value: true },
  });
  const suya = filas.filter((fila) => leer(fila.value)?.workspaceId === workspaceId);
  if (suya.length !== 1) {
    return false;
  }
  await prisma.appSetting.delete({ where: { key: suya[0].key } });
  return true;
}
