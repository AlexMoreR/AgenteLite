import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { canAccessClientModule, getClientWorkspaceAccessForUserCached } from "@/lib/client-workspace-access";
import { vistaDelCoordinador } from "@/features/tableros-inteligentes/services/coordinador-en-vivo";
import { personaPuedeAprobar } from "@/features/tableros-inteligentes/services/reglas";
import { personaQueAprueba } from "@/features/tableros-inteligentes/services/tableros";

export const dynamic = "force-dynamic";

/*
  "COORDINADOR EN VIVO" de Tablero IA: lo que hace el Coordinador ahora, la carga de aizen1, la fila, lo de hoy
  y el uso de Claude. Solo lectura. La pestaña lo pide cada 12 s con la pestaña a la vista. Lo ven los mismos que
  ven la sección Trabajador: el dueño del negocio y el ADMIN de la plataforma (nunca una asesora).
*/

const SIN_CACHE = { "Cache-Control": "no-store" };

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false }, { status: 401, headers: SIN_CACHE });
  }
  const access = await getClientWorkspaceAccessForUserCached(session.user.id);
  if (!access || !canAccessClientModule(access, "tableros_inteligentes") || !personaPuedeAprobar(access)) {
    return NextResponse.json({ ok: false }, { status: 403, headers: SIN_CACHE });
  }
  // `esDueno` (27-nov-2026): solo el dueño edita "Mínimo trabajando a la vez"; si no se puede saber, queda bloqueado.
  const [vista, esDueno] = await Promise.all([
    vistaDelCoordinador(access.workspaceId),
    personaQueAprueba(access.workspaceId, session.user.id)
      .then((persona) => persona.esDueno)
      .catch(() => false),
  ]);
  return NextResponse.json({ ok: true, vista, esDueno }, { headers: SIN_CACHE });
}
