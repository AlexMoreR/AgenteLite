import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { getClientWorkspaceAccessForUserCached } from "@/lib/client-workspace-access";
import { prisma } from "@/lib/prisma";

/**
 * Cuanta gente hay en cada etapa del CRM.
 *
 * Se muestra al lado de cada etapa al cambiarla: ver que "Tibio" tiene 0 y "Frio" tiene mil dice
 * mas sobre como esta el embudo que cualquier informe, y lo dice justo cuando uno esta por mover
 * a alguien.
 *
 * Cuenta solo los que ENTRAN al embudo: los numeros administrativos estan marcados fuera del CRM
 * a proposito y sumarlos inflaria el conteo con gente que no es un lead.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, conteo: {} }, { status: 401 });
  }

  // El permiso guardado 45 s: es la misma membresia que daba getPrimaryWorkspaceForUser.
  const access = await getClientWorkspaceAccessForUserCached(session.user.id);
  if (!access) {
    return NextResponse.json({ ok: true, conteo: {} });
  }

  const filas = await prisma.contact.groupBy({
    by: ["crmStage"],
    where: { workspaceId: access.workspaceId, excludedFromCrm: false },
    _count: { _all: true },
  });

  const conteo: Record<string, number> = {};
  for (const fila of filas) {
    conteo[fila.crmStage] = fila._count._all;
  }

  return NextResponse.json({ ok: true, conteo });
}
