import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { canAccessClientModule, getClientWorkspaceAccessForUser } from "@/lib/client-workspace-access";
import { upsertOfficialApiConfigByWorkspaceId } from "@/lib/official-api-config";
import { subscribeOfficialApiAppToWaba } from "@/lib/official-api-subscription";
import { prisma } from "@/lib/prisma";
import { getOfficialApiProviderSettings } from "@/lib/system-settings";

const setupOfficialApiSchema = z.object({
  name: z.string().trim().min(2, "Escribe un nombre de canal valido").max(100, "El nombre del canal es demasiado largo"),
  accessToken: z.string().trim().min(1, "Pega el access token de Meta."),
  phoneNumberId: z.string().trim().min(1, "Pega el Phone Number ID."),
  wabaId: z.string().trim().min(1, "Pega el WABA ID."),
  agentId: z.string().trim().optional(),
});

export async function POST(request: Request) {
  const session = await auth();

  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE", "EMPLEADO"].includes(session.user.role)) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  const access = await getClientWorkspaceAccessForUser(session.user.id);
  if (!access || !canAccessClientModule(access, "connection")) {
    return NextResponse.json({ ok: false, error: "No autorizado para conexion" }, { status: 403 });
  }

  const json = await request.json().catch(() => null);
  const parsed = setupOfficialApiSchema.safeParse(json);

  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: parsed.error.issues[0]?.message || "No se pudo guardar la API oficial.",
      },
      { status: 400 },
    );
  }

  const providerSettings = await getOfficialApiProviderSettings();

  let agentId: string | null = null;
  if (parsed.data.agentId) {
    const agent = await prisma.agent.findFirst({
      where: {
        id: parsed.data.agentId,
        workspaceId: access.workspaceId,
      },
      select: { id: true },
    });

    if (!agent) {
      return NextResponse.json({ ok: false, error: "No se encontro el agente para vincular." }, { status: 404 });
    }

    agentId = agent.id;
  }

  await upsertOfficialApiConfigByWorkspaceId({
    workspaceId: access.workspaceId,
    accessToken: parsed.data.accessToken,
    phoneNumberId: parsed.data.phoneNumberId,
    wabaId: parsed.data.wabaId,
    webhookVerifyToken: providerSettings.verifyToken || undefined,
    appSecret: providerSettings.appSecret || undefined,
  });

  const subscription = await subscribeOfficialApiAppToWaba({
    wabaId: parsed.data.wabaId,
    accessToken: parsed.data.accessToken,
  });

  if (!subscription.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: subscription.error || "No se pudo suscribir la app oficial al WABA.",
      },
      { status: 400 },
    );
  }

  const channel = await prisma.whatsAppChannel.create({
    data: {
      workspaceId: access.workspaceId,
      agentId,
      provider: "OFFICIAL_API",
      name: parsed.data.name,
      evolutionInstanceName: `official-${parsed.data.phoneNumberId}-${randomUUID()}`,
      status: "CONNECTED",
      metadata: {
        phoneNumberId: parsed.data.phoneNumberId,
        wabaId: parsed.data.wabaId,
        subscribedAppId: subscription.appId,
        source: "client-direct-setup",
      },
    },
    select: {
      id: true,
    },
  });

  return NextResponse.json({
    ok: true,
    channelId: channel.id,
  });
}
