import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isWebPushConfigured, sendPushToUser } from "@/lib/web-push";

export const dynamic = "force-dynamic";

// Envía una notificación de prueba a los dispositivos del usuario actual, para que pueda
// confirmar que el sonido/aviso funciona en este celular.
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  if (!isWebPushConfigured()) {
    return NextResponse.json({ ok: false, error: "Push no configurado en el servidor" }, { status: 503 });
  }

  const delivered = await sendPushToUser({
    userId: session.user.id,
    payload: {
      title: "Notificaciones activadas ✓",
      body: "Así se verá cuando entre un mensaje nuevo.",
      tag: "push-test",
      url: "/cliente/chats",
    },
  });

  return NextResponse.json({ ok: true, delivered });
}
