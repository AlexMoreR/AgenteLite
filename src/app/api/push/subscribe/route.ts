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
    Se limpian las suscripciones ABANDONADAS, no las que siguen vivas.

    El problema original: el navegador cambia la direccion de registro cada tanto, se guardaba una
    fila nueva y la vieja quedaba ahi. Alex acumulo doce, ocho del mismo telefono; mientras alguna
    vieja siguiera viva, el aviso salia dos veces y el telefono sonaba dos veces.

    El primer intento borraba TODAS las filas del mismo usuario con el mismo user-agent, y estuvo
    mal: en Android el navegador y la app instalada mandan el MISMO user-agent y sin embargo son
    dos registros distintos, cada uno con su propia suscripcion. Abrir la app en el navegador le
    borraba la suscripcion a la PWA, y con la PWA cerrada ya no llegaba nada. Reportado el
    4-sep-2026, unas horas despues de desplegarlo.

    La diferencia entre las dos cosas no es el user-agent: es si la fila SIGUE EN USO. Cada vez que
    se abre la app, su registro se re-suscribe y refresca su updatedAt. Una direccion que rota deja
    la fila vieja quieta para siempre; un segundo registro de verdad se refresca solo. Asi que se
    borra por antiguedad: mismo usuario, mismo navegador, y sin usarse hace mas de una semana.
  */
  const HACE_UNA_SEMANA = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  if (userAgent) {
    await prisma.webPushSubscription
      .deleteMany({
        where: {
          userId: session.user.id,
          userAgent,
          endpoint: { not: endpoint },
          updatedAt: { lt: HACE_UNA_SEMANA },
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
