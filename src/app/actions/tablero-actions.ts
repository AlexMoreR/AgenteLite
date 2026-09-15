"use server";

import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { puedeSupervisar } from "@/lib/permisos-del-equipo";
import { prisma } from "@/lib/prisma";
import { getDetalleDelTablero, type TipoDeDetalle } from "@/features/crm/services/getDetalleDelTablero";

const ETAPAS = ["NUEVO", "CALIFICADO", "PROPUESTA", "NEGOCIACION", "GANADO", "PERDIDO"];

function tipoValido(tipo: unknown): tipo is TipoDeDetalle {
  if (typeof tipo !== "string") return false;
  if (["leads", "movidos", "llamadas", "ventas", "enfriandose"].includes(tipo)) return true;
  return tipo.startsWith("etapa:") && ETAPAS.includes(tipo.slice("etapa:".length));
}

/**
 * La lista de contactos detras de una cifra del tablero.
 *
 * Mismo control que la pagina: cada una ve lo suyo, y solo el dueño o un admin puede pedir la lista de
 * OTRA persona (y tiene que ser del mismo negocio). Sin esto alcanzaria con cambiar el id.
 */
export async function detalleDelTableroAction(input: {
  userId: string;
  tipo: string;
  desde?: string | null;
  hasta?: string | null;
  pagina?: number;
}) {
  const access = await requireClientWorkspaceAccess("crm");
  if (!tipoValido(input.tipo)) {
    return { error: "Lista desconocida" };
  }

  const esJefe = await puedeSupervisar(access);
  let userId = access.userId;
  if (typeof input.userId === "string" && input.userId && input.userId !== access.userId) {
    if (!esJefe) {
      return { error: "Solo el dueño o un administrador puede ver los contactos de otra persona" };
    }
    const miembro = await prisma.workspaceMember.findFirst({
      where: { workspaceId: access.workspaceId, userId: input.userId, isActive: true },
      select: { userId: true },
    });
    if (!miembro) {
      return { error: "Esa persona no es del equipo" };
    }
    userId = miembro.userId;
  }

  return getDetalleDelTablero({
    workspaceId: access.workspaceId,
    userId,
    tipo: input.tipo,
    desde: input.desde,
    hasta: input.hasta,
    pagina: typeof input.pagina === "number" ? input.pagina : 0,
  });
}
