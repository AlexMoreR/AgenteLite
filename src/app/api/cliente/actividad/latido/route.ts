import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { getClientWorkspaceAccessForUser } from "@/lib/client-workspace-access";
import { anotarActividad } from "@/lib/actividad-del-equipo";

export const dynamic = "force-dynamic";

/*
  EL LATIDO: "sigo acá, y estoy en esto".

  Lo manda la app al cambiar de pantalla y cada pocos minutos mientras la pestaña se está mirando.
  Con eso se arma "la última vez que dio click a la app y si fue a un chat o a un módulo", que es
  lo que pidió Alex (28-09-2026), y de paso el aparato, que sale de la cabecera del navegador.

  No pide ningún módulo en particular: cualquiera que tenga sesión en el workspace late. Quien MIRA
  los latidos es otra cosa, y eso sí está cerrado a dueño y administrador (ver la pantalla de
  Actividad).
*/

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const access = await getClientWorkspaceAccessForUser(session.user.id);
  if (!access) {
    return NextResponse.json({ ok: false }, { status: 403 });
  }

  const cuerpo = (await request.json().catch(() => null)) as { ruta?: unknown; etiqueta?: unknown } | null;
  const ruta = typeof cuerpo?.ruta === "string" ? cuerpo.ruta.trim() : "";
  if (!ruta.startsWith("/")) {
    return NextResponse.json({ ok: false, error: "Ruta invalida" }, { status: 400 });
  }

  await anotarActividad({
    workspaceId: access.workspaceId,
    userId: session.user.id,
    ruta,
    etiqueta: typeof cuerpo?.etiqueta === "string" ? cuerpo.etiqueta : null,
    userAgent: request.headers.get("user-agent"),
  }).catch(() => {});

  return NextResponse.json({ ok: true });
}
