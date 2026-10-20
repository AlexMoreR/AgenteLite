import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { canAccessClientModule, getClientWorkspaceAccessForUserCached } from "@/lib/client-workspace-access";
import { alcanceDe, contenidoDelTablero, firmaDelTablero } from "@/features/tableros-inteligentes/services/tableros";

export const dynamic = "force-dynamic";

/*
  EL REFRESCO DE 5 S de /cliente/tablero-ia (Tablero IA).

  La pantalla pregunta "¿cambió algo desde <desde>?". Para contestar alcanza con UNA lectura por
  clave primaria (`TableroInteligente.actualizadoEn`, que cada escritura toca en su transacción):
  - si no cambió: `{cambio:false}` y nada más;
  - si cambió: las tarjetas (sin las borradas), las flechas y los tipos del tablero (tres lecturas
    indexadas por tableroId).

  El permiso sale del JWT y de la caché de acceso de 45 s: no se lee la base para eso.
*/

const SIN_CACHE = { "Cache-Control": "no-store" };

export async function GET(request: Request, { params }: { params: Promise<{ tableroId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false }, { status: 401, headers: SIN_CACHE });
  }
  const access = await getClientWorkspaceAccessForUserCached(session.user.id);
  if (!access || !canAccessClientModule(access, "tableros_inteligentes")) {
    return NextResponse.json({ ok: false }, { status: 403, headers: SIN_CACHE });
  }

  const { tableroId } = await params;
  // Un tablero de otra persona (si no es el dueño ni el ADMIN) responde 404, como uno que no existe.
  const actualizadoEn = await firmaDelTablero(alcanceDe(access), tableroId);
  if (!actualizadoEn) {
    return NextResponse.json({ ok: false }, { status: 404, headers: SIN_CACHE });
  }

  const desdeTexto = new URL(request.url).searchParams.get("desde");
  const desde = desdeTexto ? new Date(desdeTexto) : null;
  if (desde && !Number.isNaN(desde.getTime()) && actualizadoEn.getTime() <= desde.getTime()) {
    return NextResponse.json({ ok: true, cambio: false }, { headers: SIN_CACHE });
  }

  const contenido = await contenidoDelTablero(tableroId);
  return NextResponse.json(
    { ok: true, cambio: true, actualizadoEn: actualizadoEn.toISOString(), ...contenido },
    { headers: SIN_CACHE },
  );
}
