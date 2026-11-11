import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { listarBiblioteca } from "@/lib/biblioteca";
import { canAccessClientModule, getClientWorkspaceAccessForUserCached } from "@/lib/client-workspace-access";
import { conServerTiming, type MedidorServerTiming } from "@/lib/server-timing";

/**
 * La biblioteca para la pantalla (11-11-2026). Antes la abria una accion del servidor, y las
 * acciones van de a una: detras de cualquier otra la biblioteca se quedaba en "Abriendo..." (medido:
 * 0,6 a 4,9 s). Una ruta GET no hace fila, y el permiso sale de la cache de 45 s, como /live.
 * Mismo permiso de siempre: el de CHATS (quien puede mandarle un archivo a un cliente puede usarla).
 */
export const dynamic = "force-dynamic";

export const GET = conServerTiming(manejarGet, { log: "chats/biblioteca" });

async function manejarGet(_request: Request, t: MedidorServerTiming) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }
  const access = await getClientWorkspaceAccessForUserCached(session.user.id);
  if (!access || !canAccessClientModule(access, "chats")) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 403 });
  }
  t.marca("auth");
  const items = await listarBiblioteca(access.workspaceId);
  t.marca("lista");
  return NextResponse.json({ ok: true, items }, { headers: { "Cache-Control": "private, no-store" } });
}
