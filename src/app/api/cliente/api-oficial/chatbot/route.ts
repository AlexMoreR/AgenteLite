import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { canAccessOfficialApiModule } from "@/lib/admin-module-access";
import { saveOfficialApiChatbotBuilderState } from "@/lib/official-api-chatbot";
import { getOfficialApiConfigByWorkspaceId, hasOfficialApiBaseCredentials } from "@/lib/official-api-config";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";

const builderSchema = z.object({
  isBotEnabled: z.boolean(),
  welcomeMessage: z.string().trim().min(1).max(4096),
  fallbackMessage: z.string().trim().min(1).max(4096),
  businessHours: z.string().trim().min(1).max(255),
  captureLeadEnabled: z.boolean(),
  handoffEnabled: z.boolean(),
  fallbackEnabled: z.boolean(),
  replyEveryMessageEnabled: z.boolean(),
  selectedScenarioId: z.string().trim().max(120),
  scenarios: z.array(
    z.object({
      id: z.string().trim().min(1).max(120),
      title: z.string().trim().min(1).max(120),
      intent: z.string().trim().max(4096).optional(),
      summary: z.string().trim().max(4096).optional(),
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

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE"].includes(session.user.role)) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }
  if (!(await canAccessOfficialApiModule(session.user.id, session.user.role))) {
    return NextResponse.json({ ok: false, error: "Modulo desactivado para este rol." }, { status: 403 });
  }

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership?.workspace.id) {
    return NextResponse.json({ ok: false, error: "Workspace no encontrado" }, { status: 404 });
  }

  const config = await getOfficialApiConfigByWorkspaceId(membership.workspace.id);
  if (!config || !hasOfficialApiBaseCredentials(config)) {
    return NextResponse.json({ ok: false, error: "La API oficial no esta lista en este workspace." }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const parsed = builderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Configuracion invalida del chatbot." }, { status: 400 });
  }

  await saveOfficialApiChatbotBuilderState(config.id, {
    ...parsed.data,
    scenarios: parsed.data.scenarios.map((scenario) => ({
      ...scenario,
      intent: scenario.intent?.trim() || scenario.summary?.trim() || "Intencion personalizada del builder.",
    })),
  });

  return NextResponse.json({ ok: true });
}
