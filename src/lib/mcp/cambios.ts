import { prisma } from "@/lib/prisma";

/*
  El historial de lo que Claude cambió, con su vuelta atrás.

  Es la condición con la que Alex aceptó que el MCP escriba (18-sep-2026): que aplique directo,
  pero que todo se pueda deshacer en un clic. Sin esto, una corrección mal entendida se lleva por
  delante el guion que está vendiendo y no queda registro de qué decía antes.

  Guarda el ANTES completo de lo tocado, no una descripción: deshacer no puede depender de que
  alguien interprete bien un texto. Vive en AppSetting, una fila por negocio, para no migrar la
  base de producción.
*/

const PREFIJO = "mcp:cambios:";
const MAXIMO = 60;

export type CambioDelMcp = {
  id: string;
  at: string;
  /** Lo que se cambió, en palabras del negocio: "Guion del paso PRODUCTO del Combo Camillas". */
  titulo: string;
  /** Qué tabla y qué fila, para poder volver atrás sin adivinar. */
  tabla: "ProductFunnelStage" | "ProductStageFollowUp" | "FollowRule" | "Agent";
  filaId: string;
  accion: "editar" | "crear" | "borrar";
  /** Los campos como estaban. En "crear" va vacío; en "borrar", la fila entera. */
  antes: Record<string, unknown>;
  /** Los campos como quedaron. Solo para mostrarlo. */
  despues: Record<string, unknown>;
  /** Si hay que volver a publicar el agente después de deshacer. */
  agenteId?: string | null;
  deshecho?: boolean;
};

function clave(workspaceId: string) {
  return `${PREFIJO}${workspaceId}`;
}

export async function listarCambiosMcp(workspaceId: string): Promise<CambioDelMcp[]> {
  const fila = await prisma.appSetting.findUnique({ where: { key: clave(workspaceId) } });
  if (!fila?.value) {
    return [];
  }
  try {
    const guardado = JSON.parse(fila.value) as unknown;
    return Array.isArray(guardado) ? (guardado as CambioDelMcp[]) : [];
  } catch {
    return [];
  }
}

async function guardarLista(workspaceId: string, lista: CambioDelMcp[]) {
  const value = JSON.stringify(lista.slice(0, MAXIMO));
  await prisma.appSetting.upsert({
    where: { key: clave(workspaceId) },
    create: { key: clave(workspaceId), value },
    update: { value },
  });
}

export async function anotarCambioMcp(
  workspaceId: string,
  cambio: Omit<CambioDelMcp, "id" | "at">,
): Promise<CambioDelMcp> {
  const completo: CambioDelMcp = {
    ...cambio,
    id: `c-${Date.now()}-${Math.round(Math.random() * 1000)}`,
    at: new Date().toISOString(),
  };
  await guardarLista(workspaceId, [completo, ...(await listarCambiosMcp(workspaceId))]);
  return completo;
}

/**
 * Deja las cosas como estaban antes de ese cambio.
 *
 * Solo el ÚLTIMO cambio de cada fila se puede deshacer sin pensar: si después de ese hubo otro
 * sobre lo mismo, volver atrás el viejo pisaría el nuevo. En ese caso se avisa y no se toca nada.
 */
export async function deshacerCambioMcp(
  workspaceId: string,
  cambioId: string,
): Promise<{ ok: true; titulo: string; agenteId?: string | null } | { ok: false; error: string }> {
  const lista = await listarCambiosMcp(workspaceId);
  const cambio = lista.find((fila) => fila.id === cambioId);
  if (!cambio) {
    return { ok: false, error: "Ese cambio no está en el historial" };
  }
  if (cambio.deshecho) {
    return { ok: false, error: "Ese cambio ya se había deshecho" };
  }
  const posterior = lista.find(
    (fila) =>
      !fila.deshecho &&
      fila.tabla === cambio.tabla &&
      fila.filaId === cambio.filaId &&
      new Date(fila.at).getTime() > new Date(cambio.at).getTime(),
  );
  if (posterior) {
    return {
      ok: false,
      error: `Después de ese hubo otro cambio sobre lo mismo ("${posterior.titulo}"). Deshacé primero el más nuevo.`,
    };
  }

  try {
    await revertir(workspaceId, cambio);
  } catch (fallo) {
    return { ok: false, error: fallo instanceof Error ? fallo.message : "No se pudo deshacer" };
  }

  await guardarLista(
    workspaceId,
    lista.map((fila) => (fila.id === cambio.id ? { ...fila, deshecho: true } : fila)),
  );
  return { ok: true, titulo: cambio.titulo, agenteId: cambio.agenteId };
}

async function revertir(workspaceId: string, cambio: CambioDelMcp) {
  if (cambio.tabla === "ProductFunnelStage") {
    // Las etapas no se crean ni se borran desde el MCP: siempre es una edición.
    await prisma.productFunnelStage.update({ where: { id: cambio.filaId }, data: cambio.antes });
    return;
  }

  if (cambio.tabla === "Agent") {
    const antes = cambio.antes as { graph?: unknown };
    await prisma.agent.update({ where: { id: cambio.filaId }, data: { graph: antes.graph as never } });
    return;
  }

  if (cambio.tabla === "ProductStageFollowUp") {
    if (cambio.accion === "crear") {
      await prisma.productStageFollowUp.deleteMany({ where: { id: cambio.filaId } });
      return;
    }
    if (cambio.accion === "borrar") {
      await prisma.productStageFollowUp.create({ data: cambio.antes as never });
      return;
    }
    await prisma.productStageFollowUp.update({ where: { id: cambio.filaId }, data: cambio.antes });
    return;
  }

  // FollowRule: siempre dentro del negocio de la clave, nunca por id suelto.
  if (cambio.accion === "crear") {
    await prisma.followRule.deleteMany({ where: { id: cambio.filaId, workspaceId } });
    return;
  }
  if (cambio.accion === "borrar") {
    await prisma.followRule.create({ data: { ...(cambio.antes as object), workspaceId } as never });
    return;
  }
  await prisma.followRule.updateMany({ where: { id: cambio.filaId, workspaceId }, data: cambio.antes });
}
