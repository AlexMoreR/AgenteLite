import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { canAccessClientModule, getClientWorkspaceAccessForUserCached } from "@/lib/client-workspace-access";
import { conServerTiming, type MedidorServerTiming } from "@/lib/server-timing";
import { aSeguimientoDelCliente, ordenarSeguimientos } from "@/features/seguimientos/dominio/seguimientos-del-cliente";
import { listFollowsByContact } from "@/features/seguimientos/services/follows";
import { leerConfigAntiBloqueo } from "@/lib/anti-bloqueo/servicio";

/**
 * "Ver seguimientos" de la ventana de Agendar (11-nov-2026): los seguimientos de UN cliente, los
 * pendientes primero. Ruta GET (no accion del servidor) para que no haga fila detras de otra.
 * Mismo permiso que agendar uno: el de CHATS.
 */
export const dynamic = "force-dynamic";

export const GET = conServerTiming(manejarGet, { log: "chats/seguimientos" });

async function manejarGet(request: Request, t: MedidorServerTiming) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }
  const access = await getClientWorkspaceAccessForUserCached(session.user.id);
  if (!access || !canAccessClientModule(access, "chats")) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 403 });
  }
  const parametros = new URL(request.url).searchParams;
  // El horario de envíos: lo que se agenda fuera de él sale en la próxima apertura (anti-bloqueo).
  // La ventana lo usa para decir la hora REAL en que sale (Alex, 11-nov-2026: "nunca llegó").
  const config = await leerConfigAntiBloqueo(access.workspaceId);
  const horario = { activo: config.horario.activo, desdeHora: config.horario.desdeHora, hastaHora: config.horario.hastaHora };
  if (parametros.get("solo") === "horario") {
    return NextResponse.json({ ok: true, horario }, { headers: { "Cache-Control": "private, no-store" } });
  }
  const contactId = parametros.get("contactId")?.trim() ?? "";
  if (!contactId || contactId.length > 64) {
    return NextResponse.json({ ok: false, error: "Falta el contacto" }, { status: 400 });
  }
  t.marca("auth");
  // Filtra por negocio: con el id de un contacto de otro negocio no devuelve nada.
  const filas = await listFollowsByContact({ workspaceId: access.workspaceId, contactId, limit: 100 });
  t.marca("lista");
  const seguimientos = ordenarSeguimientos(filas.map((fila) => aSeguimientoDelCliente(fila)));
  return NextResponse.json({ ok: true, seguimientos, horario }, { headers: { "Cache-Control": "private, no-store" } });
}
