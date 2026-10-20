import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { canAccessClientModule, getClientWorkspaceAccessForUserCached } from "@/lib/client-workspace-access";
import { listarTableros, type TableroResumen } from "@/features/tableros-inteligentes/services/tableros";

export const dynamic = "force-dynamic";

/*
  LA LISTA DEL SELECTOR de Tablero IA (barra superior). Se pide al abrir el selector, para que
  aparezcan los tableros que Claude creó sin recargar la página. Dos lecturas: los tableros del
  negocio y un conteo agrupado de sus tarjetas.
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

  const tableros: TableroResumen[] = (await listarTableros(access.workspaceId)).map((tablero) => ({
    id: tablero.id,
    nombre: tablero.nombre,
    porAprobar: tablero.porEstado.POR_APROBAR ?? 0,
  }));
  return NextResponse.json({ ok: true, tableros }, { headers: SIN_CACHE });
}
