import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getVapidPublicKey, isWebPushConfigured } from "@/lib/web-push";

export const dynamic = "force-dynamic";

// Entrega la llave pública VAPID que el navegador necesita para suscribirse a push.
// Es información pública (no secreta); aun así exigimos sesión para no exponer la
// configuración a terceros anónimos.
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  return NextResponse.json({
    ok: true,
    configured: isWebPushConfigured(),
    publicKey: getVapidPublicKey() || null,
  });
}
