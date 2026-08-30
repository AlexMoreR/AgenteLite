import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";

/**
 * Que lineas estan caidas ahora mismo.
 *
 * Lee el `status` que deja el monitor cada minuto: NO le pregunta al gateway. Esta ruta la llama
 * el navegador de cada persona que tenga la app abierta, y consultar el gateway en cada llamada
 * seria multiplicar el trafico contra WhatsApp por la cantidad de pestanas abiertas -que es
 * exactamente lo que ahogo a evogo el 28-ago-.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, caidos: [] }, { status: 401 });
  }

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership) {
    return NextResponse.json({ ok: true, caidos: [] });
  }

  const canales = await prisma.whatsAppChannel.findMany({
    where: {
      workspaceId: membership.workspace.id,
      isActive: true,
      provider: "EVOLUTION",
      status: { in: ["DISCONNECTED", "QRCODE"] },
    },
    select: { id: true, name: true, phoneNumber: true, status: true },
    orderBy: { name: "asc" },
  });

  return NextResponse.json({
    ok: true,
    caidos: canales.map((canal) => ({
      id: canal.id,
      nombre: canal.name,
      telefono: canal.phoneNumber,
      necesitaQr: canal.status === "QRCODE",
    })),
  });
}
