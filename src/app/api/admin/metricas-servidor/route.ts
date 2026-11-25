import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { canAccessClientModule, getClientWorkspaceAccessForUser } from "@/lib/client-workspace-access";
import { leerPanelServidor, leerTarjetaConsultas } from "@/lib/metricas-servidor-lectura";
import { puedeVerDireccion } from "@/lib/permisos-del-crm";

export const dynamic = "force-dynamic";

/*
  Dirección → Servidor: las fotos del servidor de las últimas 24 h (CPU, memoria, disco y los contenedores de
  la última foto) y la tarjeta "Consultas de más de 10 s" (`consultas`). Solo lee. La pantalla la llama cada minuto para actualizarse sola.

  Solo el dueño y los administradores (la misma regla de Dirección). Responde 401/403 en JSON en vez de
  redirigir, por eso no usa requireClientWorkspaceAccess.
*/
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, error: "Sin sesión." }, { status: 401 });
  }
  const access = await getClientWorkspaceAccessForUser(session.user.id);
  if (!access || !canAccessClientModule(access, "crm") || !puedeVerDireccion(access)) {
    return NextResponse.json({ ok: false, error: "Sin permiso." }, { status: 403 });
  }

  try {
    // La tarjeta de consultas nunca lanza: si falla sale gris y las fotos salen igual.
    const [muestras, consultas] = await Promise.all([leerPanelServidor(), leerTarjetaConsultas()]);
    return NextResponse.json({ ok: true, muestras, consultas }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[metricas-servidor] no se pudo leer el panel", error);
    return NextResponse.json({ ok: false, error: "No se pudieron leer los datos del servidor." }, { status: 500 });
  }
}
