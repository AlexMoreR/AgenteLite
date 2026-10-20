import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { canAccessClientModule, getClientWorkspaceAccessForUserCached } from "@/lib/client-workspace-access";
import { alcanceDe, pendientesDelDueno } from "@/features/tableros-inteligentes/services/tableros";

export const dynamic = "force-dynamic";

/*
  "TE TOCA A TI" de Tablero IA: lo que espera al dueño en TODOS los tableros que la persona ve
  (POR_APROBAR de tipos con aprobación y FALLIDO). Se pide al abrir esa pestaña y cuando cambia el
  tablero abierto; no entra en el refresco de 5 s. Una lectura indexada.
*/

const SIN_CACHE = { "Cache-Control": "no-store" };

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false }, { status: 401, headers: SIN_CACHE });
  }
  const access = await getClientWorkspaceAccessForUserCached(session.user.id);
  if (!access || !canAccessClientModule(access, "tableros_inteligentes")) {
    return NextResponse.json({ ok: false }, { status: 403, headers: SIN_CACHE });
  }
  const pendientes = await pendientesDelDueno(alcanceDe(access));
  return NextResponse.json({ ok: true, pendientes }, { headers: SIN_CACHE });
}
