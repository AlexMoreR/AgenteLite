import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { canAccessClientModule, getClientWorkspaceAccessForUserCached } from "@/lib/client-workspace-access";
import {
  aTableroDelInicio,
  alcanceDe,
  firmaDeLaLista,
  firmaDeLosTableros,
  listarTableros,
} from "@/features/tableros-inteligentes/services/tableros";

export const dynamic = "force-dynamic";

/*
  LA LISTA DE TABLEROS de Tablero IA, en vivo: la página de inicio y el selector de la barra superior
  la piden cada 5 s (con la pestaña a la vista) y el selector, también al abrirse. Así aparecen los
  tableros que Claude creó y los contadores al día sin recargar.

  La pregunta lleva `?firma=` (la hora del último cambio y cuántos tableros hay):
  - si no cambió: `{cambio:false}` tras UNA lectura (un agregado por negocio);
  - si cambió: los tableros de la persona (el dueño o el ADMIN, todos, con su dueño) con sus
    contadores, como en la página de inicio, y la firma nueva.

  El permiso sale del JWT y de la caché de acceso de 45 s: no se lee la base para eso.
*/

const SIN_CACHE = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false }, { status: 401, headers: SIN_CACHE });
  }
  const access = await getClientWorkspaceAccessForUserCached(session.user.id);
  if (!access || !canAccessClientModule(access, "tableros_inteligentes")) {
    return NextResponse.json({ ok: false }, { status: 403, headers: SIN_CACHE });
  }

  const alcance = alcanceDe(access);
  const firmaVista = new URL(request.url).searchParams.get("firma");
  if (firmaVista && firmaVista === (await firmaDeLosTableros(alcance))) {
    return NextResponse.json({ ok: true, cambio: false }, { headers: SIN_CACHE });
  }

  const lista = await listarTableros(alcance);
  return NextResponse.json(
    { ok: true, cambio: true, firma: firmaDeLaLista(lista), tableros: lista.map(aTableroDelInicio) },
    { headers: SIN_CACHE },
  );
}
