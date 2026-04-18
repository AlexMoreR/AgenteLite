import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { canAccessOfficialApiModule } from "@/lib/admin-module-access";
import { saveOfficialApiChatbotBuilderState } from "@/lib/official-api-chatbot";
import { getOfficialApiConfigByWorkspaceId, hasOfficialApiBaseCredentials } from "@/lib/official-api-config";
import { prisma } from "@/lib/prisma";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";

const builderSchema = z.object({
  sourceType: z.enum(["official-api", "evolution"]),
  sourceId: z.string().trim().optional(),
  isBotEnabled: z.boolean(),
  welcomeMessage: z.string().trim().min(1).max(4096),
  fallbackMessage: z.string().trim().min(1).max(4096),
  businessHours: z.string().trim().max(255),
  captureLeadEnabled: z.boolean(),
  handoffEnabled: z.boolean(),
  fallbackEnabled: z.boolean(),
  replyEveryMessageEnabled: z.boolean(),
  selectedScenarioId: z.string().trim().max(120),
  scenarios: z.array(
    z.object({
      id: z.string().trim().min(1).max(120),
      title: z.string().trim().min(1).max(120),
      summary: z.string().trim().min(1).max(4096),
      messages: z.array(
        z.object({
          id: z.string().trim().min(1).max(120),
          direction: z.enum(["inbound", "bot"]),
          content: z.string().trim().min(1).max(4096),
        }),
      ),
    }),
  ),
  nodesByScenarioId: z.record(
    z.string().trim().min(1).max(120),
    z.array(
      z.object({
        id: z.string().trim().min(1).max(120),
        kind: z.enum(["trigger", "message", "image", "audio", "video", "document", "input", "condition", "action"]),
        title: z.string().trim().min(1).max(120),
        body: z.string().trim().max(4096),
        meta: z.string().trim().max(2048),
      }),
    ).min(1),
  ),
  nodePositionsByScenarioId: z.record(
    z.string().trim().min(1).max(120),
    z.record(
      z.string().trim().min(1).max(120),
      z.object({
        x: z.number().finite(),
        y: z.number().finite(),
      }),
    ),
  ),
  edgesByScenarioId: z.record(
    z.string().trim().min(1).max(120),
    z.array(
      z.object({
        id: z.string().trim().min(1).max(220),
        source: z.string().trim().min(1).max(120),
        target: z.string().trim().min(1).max(120),
      }),
    ),
  ),
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE"].includes(session.user.role)) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership?.workspace.id) {
    return NextResponse.json({ ok: false, error: "Workspace no encontrado" }, { status: 404 });
  }

  const requestUrl = new URL(request.url);
  const body = await request.json().catch(() => null);
  const parsed = builderSchema.safeParse({
    ...(body && typeof body === "object" ? body : {}),
    sourceType:
      (body && typeof body === "object" && "sourceType" in body ? (body as { sourceType?: unknown }).sourceType : undefined) ??
      requestUrl.searchParams.get("sourceType") ??
      undefined,
    sourceId:
      (body && typeof body === "object" && "sourceId" in body ? (body as { sourceId?: unknown }).sourceId : undefined) ??
      requestUrl.searchParams.get("sourceId") ??
      undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Configuracion invalida del flujo." }, { status: 400 });
  }

  const builderState = {
    isBotEnabled: parsed.data.isBotEnabled,
    welcomeMessage: parsed.data.welcomeMessage,
    fallbackMessage: parsed.data.fallbackMessage,
    businessHours: parsed.data.businessHours,
    captureLeadEnabled: parsed.data.captureLeadEnabled,
    handoffEnabled: parsed.data.handoffEnabled,
    fallbackEnabled: parsed.data.fallbackEnabled,
    replyEveryMessageEnabled: parsed.data.replyEveryMessageEnabled,
    selectedScenarioId: parsed.data.selectedScenarioId,
    scenarios: parsed.data.scenarios,
    nodesByScenarioId: parsed.data.nodesByScenarioId,
    nodePositionsByScenarioId: parsed.data.nodePositionsByScenarioId,
    edgesByScenarioId: parsed.data.edgesByScenarioId,
  };

  if (parsed.data.sourceType === "official-api") {
    if (!(await canAccessOfficialApiModule(session.user.id, session.user.role))) {
      return NextResponse.json({ ok: false, error: "Modulo API oficial desactivado para este rol." }, { status: 403 });
    }

    const config = await getOfficialApiConfigByWorkspaceId(membership.workspace.id);
    if (!config || !hasOfficialApiBaseCredentials(config)) {
      return NextResponse.json({ ok: false, error: "La API oficial no esta lista en este workspace." }, { status: 400 });
    }

    await saveOfficialApiChatbotBuilderState(config.id, builderState);
    return NextResponse.json({ ok: true });
  }

  if (!parsed.data.sourceId) {
    return NextResponse.json({ ok: false, error: "Debes indicar el canal Evolution." }, { status: 400 });
  }

  const channel = await prisma.whatsAppChannel.findFirst({
    where: {
      id: parsed.data.sourceId,
      workspaceId: membership.workspace.id,
      provider: "EVOLUTION",
    },
    select: {
      id: true,
      metadata: true,
    },
  });

  if (!channel) {
    return NextResponse.json({ ok: false, error: "Canal Evolution no encontrado." }, { status: 404 });
  }

  const currentMetadata = isRecord(channel.metadata) ? channel.metadata : {};

  await prisma.whatsAppChannel.update({
    where: { id: channel.id },
    data: {
      metadata: {
        ...currentMetadata,
        flowBuilderState: builderState,
      },
    },
  });

  return NextResponse.json({ ok: true });
}
