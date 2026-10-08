import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { getClientWorkspaceAccessForUser } from "@/lib/client-workspace-access";
import { cambiarRecibiendo } from "@/lib/en-linea";

export const dynamic = "force-dynamic";

/*
  EL INTERRUPTOR "Recibiendo clientes / Pausada" de la barra superior.

  Solo cambia el estado de quien lo toca: nadie pausa ni activa a otra persona desde acá (eso es la
  pausa de reparto de Mi empresa -> Equipo, que es de los jefes). Ver en-linea-reglas.ts.
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

  const cuerpo = (await request.json().catch(() => null)) as { recibiendo?: unknown } | null;
  if (typeof cuerpo?.recibiendo !== "boolean") {
    return NextResponse.json({ ok: false, error: "Falta recibiendo" }, { status: 400 });
  }

  const enLinea = await cambiarRecibiendo(
    { workspaceId: access.workspaceId, userId: session.user.id },
    cuerpo.recibiendo,
  );
  return NextResponse.json({ ok: true, enLinea });
}
