import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type SubscribeBody = {
  endpoint?: unknown;
  keys?: { p256dh?: unknown; auth?: unknown } | null;
};

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

// Guarda (o actualiza) la suscripción push del dispositivo actual, ligada al usuario
// y su workspace principal. El endpoint es único: si el mismo dispositivo se re-suscribe
// (renovación de claves, cambio de usuario), se actualiza en lugar de duplicar.
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership?.workspace.id) {
    return NextResponse.json({ ok: false, error: "Workspace no encontrado" }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as SubscribeBody | null;
  const endpoint = readString(body?.endpoint);
  const p256dh = readString(body?.keys?.p256dh);
  const authKey = readString(body?.keys?.auth);

  if (!endpoint || !p256dh || !authKey) {
    return NextResponse.json({ ok: false, error: "Suscripción inválida" }, { status: 400 });
  }

  const userAgent = request.headers.get("user-agent")?.slice(0, 255) || null;

  await prisma.webPushSubscription.upsert({
    where: { endpoint },
    update: {
      userId: session.user.id,
      workspaceId: membership.workspace.id,
      p256dh,
      auth: authKey,
      userAgent,
    },
    create: {
      endpoint,
      userId: session.user.id,
      workspaceId: membership.workspace.id,
      p256dh,
      auth: authKey,
      userAgent,
    },
  });

  /*
    Un dispositivo, una suscripcion.

    Apple cambia el endpoint cada tanto: el mismo iPhone se re-suscribia y quedaba una fila NUEVA
    sin borrar la anterior. Medido el 3-sep-2026: Alex tenia 12 filas, OCHO del mismo telefono.
    Mientras la vieja siga viva, el servidor manda el aviso dos veces y el telefono suena dos veces.

    Se borran las otras filas del MISMO usuario con el MISMO navegador. Dos telefonos distintos
    traen user-agent distinto, asi que cada uno conserva la suya; dos telefonos iguales del mismo
    usuario se pisarian, que es un caso raro y el precio es solo que le llegue a uno.
  */
  if (userAgent) {
    await prisma.webPushSubscription
      .deleteMany({
        where: {
          userId: session.user.id,
          userAgent,
          endpoint: { not: endpoint },
        },
      })
      .catch(() => undefined);
  }

  return NextResponse.json({ ok: true });
}

// Elimina la suscripción del dispositivo (al desactivar notificaciones o cerrar sesión).
export async function DELETE(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as SubscribeBody | null;
  const endpoint = readString(body?.endpoint);
  if (!endpoint) {
    return NextResponse.json({ ok: false, error: "Endpoint requerido" }, { status: 400 });
  }

  await prisma.webPushSubscription
    .deleteMany({ where: { endpoint, userId: session.user.id } })
    .catch(() => undefined);

  return NextResponse.json({ ok: true });
}
