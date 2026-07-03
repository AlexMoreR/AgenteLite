import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { canAccessClientModule, getClientWorkspaceAccessForUser } from "@/lib/client-workspace-access";
import { getMetaGraphErrorMessage, normalizeMetaAppSecret, type MetaGraphErrorPayload } from "@/lib/official-api-graph";
import { upsertOfficialApiConfigByWorkspaceId } from "@/lib/official-api-config";
import { subscribeOfficialApiAppToWaba } from "@/lib/official-api-subscription";
import { prisma } from "@/lib/prisma";
import { getOfficialApiProviderSettings } from "@/lib/system-settings";

async function fetchOfficialApiDisplayNumber(phoneNumberId: string, accessToken: string) {
  const response = await fetch(
    `https://graph.facebook.com/v23.0/${encodeURIComponent(phoneNumberId)}?fields=display_phone_number`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      cache: "no-store",
    },
  );

  const payload = (await response.json().catch(() => null)) as
    | ({ display_phone_number?: string } & MetaGraphErrorPayload)
    | null;

  if (!response.ok) {
    return {
      ok: false as const,
      error: getMetaGraphErrorMessage(payload, "No se pudo validar el Phone Number ID en Meta."),
    };
  }

  // Meta devuelve el numero formateado ("+57 305 712 7409"); lo normalizamos a solo digitos
  // para que coincida con el formato del resto de canales.
  const normalized = payload?.display_phone_number?.replace(/\D/g, "") ?? "";

  return { ok: true as const, phoneNumber: normalized };
}

const setupOfficialApiSchema = z.object({
  channelId: z.string().trim().min(1, "Canal invalido."),
  accessToken: z.string().trim().min(1, "Pega el access token de Meta."),
  phoneNumberId: z.string().trim().min(1, "Pega el Phone Number ID."),
  wabaId: z.string().trim().min(1, "Pega el WABA ID."),
  webhookVerifyToken: z.string().trim().optional(),
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

  const channel = await prisma.whatsAppChannel.findFirst({
    where: {
      id: parsed.data.channelId,
      workspaceId: access.workspaceId,
      provider: "OFFICIAL_API",
    },
    select: {
      id: true,
      metadata: true,
      phoneNumber: true,
    },
  });

  if (!channel) {
    return NextResponse.json({ ok: false, error: "No se encontro el canal oficial." }, { status: 404 });
  }

  await upsertOfficialApiConfigByWorkspaceId({
    workspaceId: access.workspaceId,
    accessToken: parsed.data.accessToken,
    phoneNumberId: parsed.data.phoneNumberId,
    wabaId: parsed.data.wabaId,
    webhookVerifyToken: parsed.data.webhookVerifyToken || providerSettings.verifyToken || undefined,
    appSecret: normalizeMetaAppSecret(providerSettings.appSecret) || undefined,
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

  const displayNumber = await fetchOfficialApiDisplayNumber(
    parsed.data.phoneNumberId,
    parsed.data.accessToken,
  );

  if (!displayNumber.ok) {
    return NextResponse.json({ ok: false, error: displayNumber.error }, { status: 400 });
  }

  const baseMetadata =
    channel.metadata && typeof channel.metadata === "object" && !Array.isArray(channel.metadata)
      ? (channel.metadata as Record<string, unknown>)
      : {};

  await prisma.whatsAppChannel.update({
    where: { id: channel.id },
    data: {
      evolutionInstanceName: `official-${parsed.data.phoneNumberId}-${randomUUID()}`,
      phoneNumber: displayNumber.phoneNumber || channel.phoneNumber || parsed.data.phoneNumberId,
      status: "CONNECTED",
      metadata: {
        ...baseMetadata,
        phoneNumberId: parsed.data.phoneNumberId,
        wabaId: parsed.data.wabaId,
        subscribedAppId: subscription.appId,
        source: "client-detail-setup",
      },
    },
  });

  return NextResponse.json({
    ok: true,
    channelId: parsed.data.channelId,
  });
}
