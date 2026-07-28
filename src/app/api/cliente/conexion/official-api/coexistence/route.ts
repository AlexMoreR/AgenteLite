import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { canAccessClientModule, getClientWorkspaceAccessForUser } from "@/lib/client-workspace-access";
import {
  exchangeEmbeddedSignupCodeForAccessToken,
  parseEmbeddedSignupSessionResponse,
} from "@/lib/official-api-embedded-signup";
import {
  getOfficialApiConfigByWorkspaceId,
  upsertOfficialApiConfigByWorkspaceId,
} from "@/lib/official-api-config";
import { getMetaGraphErrorMessage, type MetaGraphErrorPayload } from "@/lib/official-api-graph";
import { subscribeOfficialApiAppToWaba } from "@/lib/official-api-subscription";
import { prisma } from "@/lib/prisma";
import { getOfficialApiProviderSettings } from "@/lib/system-settings";

// El numero ya esta registrado (coexistencia): solo lo consultamos para mostrarlo formateado.
async function fetchOfficialApiDisplayNumber(phoneNumberId: string, accessToken: string) {
  const response = await fetch(
    `https://graph.facebook.com/v23.0/${encodeURIComponent(phoneNumberId)}?fields=display_phone_number`,
    { method: "GET", headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" },
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

  return { ok: true as const, phoneNumber: payload?.display_phone_number?.replace(/\D/g, "") ?? "" };
}

const coexistenceChannelSchema = z.object({
  name: z.string().trim().min(2, "Escribe un nombre de canal valido").max(100, "El nombre del canal es demasiado largo"),
  code: z.string().trim().min(1, "Falta el code devuelto por Meta"),
  sessionResponse: z.string().trim().min(1, "Falta la respuesta de registro de la sesion"),
  agentId: z.string().trim().optional(),
});

function getTrimmedString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE", "EMPLEADO"].includes(session.user.role)) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  const access = await getClientWorkspaceAccessForUser(session.user.id);
  if (!access || !canAccessClientModule(access, "connection")) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = coexistenceChannelSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues[0]?.message || "Datos invalidos para crear la conexion oficial." },
      { status: 400 },
    );
  }

  const workspaceId = access.workspaceId;

  let agentId: string | null = null;
  const requestedAgentId = getTrimmedString(parsed.data.agentId);

  if (requestedAgentId) {
    const agent = await prisma.agent.findFirst({
      where: {
        id: requestedAgentId,
        workspaceId,
      },
      select: { id: true },
    });

    if (!agent) {
      return NextResponse.json({ ok: false, error: "No se encontro el agente para vincular." }, { status: 400 });
    }

    agentId = agent.id;
  }

  const providerSettings = await getOfficialApiProviderSettings();
  if (!providerSettings.appId || !providerSettings.appSecret) {
    return NextResponse.json(
      {
        ok: false,
        error: "Falta configurar el App ID o App Secret del proveedor para lanzar coexistencia oficial.",
      },
      { status: 400 },
    );
  }

  let accessToken: string;

  try {
    const exchanged = await exchangeEmbeddedSignupCodeForAccessToken({
      code: parsed.data.code,
      appId: providerSettings.appId,
      appSecret: providerSettings.appSecret,
    });

    accessToken = exchanged.accessToken;
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "No se pudo cambiar el code de Meta por un access token.",
      },
      { status: 400 },
    );
  }

  let sessionData: ReturnType<typeof parseEmbeddedSignupSessionResponse>;

  try {
    sessionData = parseEmbeddedSignupSessionResponse(parsed.data.sessionResponse);
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "No se pudo leer la respuesta de registro de la sesion.",
      },
      { status: 400 },
    );
  }

  await upsertOfficialApiConfigByWorkspaceId({
    workspaceId,
    accessToken,
    phoneNumberId: sessionData.phoneNumberId,
    wabaId: sessionData.wabaId,
    webhookVerifyToken: providerSettings.verifyToken || undefined,
    appSecret: providerSettings.appSecret || undefined,
  });

  const officialApiConfig = await getOfficialApiConfigByWorkspaceId(workspaceId);

  if (!officialApiConfig?.id) {
    return NextResponse.json(
      { ok: false, error: "No se pudo guardar la configuracion oficial del workspace." },
      { status: 500 },
    );
  }

  // Suscribir la app al WABA: sin esto Meta NO envia webhooks al numero, o sea no entran
  // mensajes (el mismo paso que hace la ruta manual `setup`). Es lo que faltaba en coexistencia.
  const subscription = await subscribeOfficialApiAppToWaba({
    wabaId: sessionData.wabaId,
    accessToken,
  });

  if (!subscription.ok) {
    return NextResponse.json(
      { ok: false, error: subscription.error || "No se pudo suscribir la app oficial al WABA." },
      { status: 400 },
    );
  }

  // El numero ya esta registrado (coexistencia); solo lo traemos para mostrarlo. Si falla, no
  // bloqueamos: el canal igual queda conectado y se puede completar despues.
  const displayNumber = await fetchOfficialApiDisplayNumber(sessionData.phoneNumberId, accessToken);
  const resolvedPhoneNumber = displayNumber.ok && displayNumber.phoneNumber ? displayNumber.phoneNumber : null;

  const channel = await prisma.whatsAppChannel.create({
    data: {
      workspaceId,
      agentId,
      provider: "OFFICIAL_API",
      name: parsed.data.name,
      phoneNumber: resolvedPhoneNumber,
      evolutionInstanceName: `official-${sessionData.phoneNumberId}-${randomUUID()}`,
      status: "CONNECTED",
      metadata: {
        source: "embedded-signup-coexistence",
        coexistence: true,
        officialApiConfigId: officialApiConfig.id,
        phoneNumberId: sessionData.phoneNumberId,
        wabaId: sessionData.wabaId,
        businessId: sessionData.businessId,
        subscribedAppId: subscription.appId,
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
