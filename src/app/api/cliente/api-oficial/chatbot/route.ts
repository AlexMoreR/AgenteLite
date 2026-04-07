import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
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
  selectedScenarioId: z.string().trim().min(1).max(120),
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
  ).min(1),
  nodes: z.array(
    z.object({
      id: z.string().trim().min(1).max(120),
      kind: z.enum(["trigger", "message", "input", "condition", "action"]),
      title: z.string().trim().min(1).max(120),
      body: z.string().trim().max(4096),
      meta: z.string().trim().max(255),
    }),
  ).min(1),
});

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE"].includes(session.user.role)) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
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

  await saveOfficialApiChatbotBuilderState(config.id, parsed.data);

  return NextResponse.json({ ok: true });
}
