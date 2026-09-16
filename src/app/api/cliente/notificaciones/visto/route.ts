import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { canAccessClientModule, getClientWorkspaceAccessForUser } from "@/lib/client-workspace-access";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/*
  Hasta cuando esta persona ya MIRO sus notificaciones.

  Pedido de Alex (15-sep-2026): el punto rojo de la campana tiene que apagarse al entrar a
  Notificaciones. Antes contaba mensajes sin leer, y esos solo se marcan al abrir cada chat: uno
  entraba a Notificaciones, veia el aviso, volvia y el punto seguia encendido. "Una cosa es la
  notificacion y otra cuando uno ingresa al chat".

  Se guarda por PERSONA (no por dispositivo) para que mirarlas en el celular tambien las apague en
  la computadora. Va en AppSetting: es una fecha por usuario, no justifica migrar la base.
*/

const clave = (userId: string) => `notificaciones:visto:${userId}`;

async function quienMira() {
  const session = await auth();
  if (!session?.user?.id) {
    return null;
  }
  const access = await getClientWorkspaceAccessForUser(session.user.id);
  if (!access || !canAccessClientModule(access, "chats")) {
    return null;
  }
  return session.user.id;
}

export async function GET() {
  const userId = await quienMira();
  if (!userId) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const fila = await prisma.appSetting.findUnique({ where: { key: clave(userId) } });
  return NextResponse.json({ ok: true, vistoEl: fila?.value ?? null });
}

export async function POST() {
  const userId = await quienMira();
  if (!userId) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const ahora = new Date().toISOString();
  await prisma.appSetting.upsert({
    where: { key: clave(userId) },
    create: { key: clave(userId), value: ahora },
    update: { value: ahora },
  });
  return NextResponse.json({ ok: true, vistoEl: ahora });
}
