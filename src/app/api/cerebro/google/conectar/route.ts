import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { getClientWorkspaceAccessForUser } from "@/lib/client-workspace-access";
import { urlDeInicioDeSesion, oauthConfigurado } from "@/features/cerebro/services/conexion";
import { puedeAdministrarElCerebro } from "@/features/cerebro/services/reglas";
import { origenDelPedido } from "../../origen";

export const dynamic = "force-dynamic";

const PANTALLA = "/cliente/negocio/cerebro";

/* Entrada del inicio de sesión con Google: solo el dueño. Lo lleva a la pantalla de permisos de Google. */
export async function GET(request: Request) {
  const origen = origenDelPedido(request);
  const sesion = await auth();
  const acceso = sesion?.user?.id ? await getClientWorkspaceAccessForUser(sesion.user.id) : null;
  if (!acceso || !puedeAdministrarElCerebro(acceso)) {
    return NextResponse.redirect(`${origen}${PANTALLA}?error=${encodeURIComponent("Solo el dueño conecta Google.")}`);
  }
  if (!oauthConfigurado()) {
    return NextResponse.redirect(
      `${origen}${PANTALLA}?error=${encodeURIComponent("Falta configurar Google en el servidor (GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET y CEREBRO_CLAVE_CIFRADO).")}`,
    );
  }
  return NextResponse.redirect(urlDeInicioDeSesion({ workspaceId: acceso.workspaceId, userId: acceso.userId, origen }));
}
