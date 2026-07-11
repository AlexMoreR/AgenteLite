import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { canAccessClientModule, getClientWorkspaceAccessForUser } from "@/lib/client-workspace-access";
import {
  getOfficialApiConfigByWorkspaceId,
  hasOfficialApiBaseCredentials,
} from "@/lib/official-api-config";
import { getMetaGraphErrorMessage, type MetaGraphErrorPayload } from "@/lib/official-api-graph";

const GRAPH_VERSION = "v23.0";

export type OfficialApiTemplate = {
  id: string;
  name: string;
  status: string;
  category: string;
  language: string;
  bodyText: string | null;
  buttons: string[];
};

type GraphTemplateComponent = {
  type?: string;
  text?: string;
  buttons?: Array<{ type?: string; text?: string }>;
};

type GraphTemplate = {
  id?: string;
  name?: string;
  status?: string;
  category?: string;
  language?: string;
  components?: GraphTemplateComponent[];
};

async function requireTemplateAccess() {
  const session = await auth();

  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE", "EMPLEADO"].includes(session.user.role)) {
    return { error: NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 }) } as const;
  }

  const access = await getClientWorkspaceAccessForUser(session.user.id);
  if (!access || !canAccessClientModule(access, "client_official_api")) {
    return { error: NextResponse.json({ ok: false, error: "No autorizado para API oficial" }, { status: 403 }) } as const;
  }

  const config = await getOfficialApiConfigByWorkspaceId(access.workspaceId);
  if (!config || !hasOfficialApiBaseCredentials(config)) {
    return {
      error: NextResponse.json(
        { ok: false, error: "El workspace no tiene la API oficial conectada." },
        { status: 400 },
      ),
    } as const;
  }

  return { config } as const;
}

function mapGraphTemplate(template: GraphTemplate): OfficialApiTemplate {
  const body = template.components?.find((component) => component.type === "BODY");
  const buttonsComponent = template.components?.find((component) => component.type === "BUTTONS");

  return {
    id: template.id ?? "",
    name: template.name ?? "",
    status: template.status ?? "UNKNOWN",
    category: template.category ?? "",
    language: template.language ?? "",
    bodyText: body?.text?.trim() || null,
    buttons: (buttonsComponent?.buttons ?? [])
      .map((button) => button.text?.trim() || "")
      .filter(Boolean),
  };
}

export async function GET() {
  const result = await requireTemplateAccess();
  if ("error" in result) {
    return result.error;
  }

  const { config } = result;
  const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(config.wabaId ?? "")}/message_templates`);
  url.searchParams.set("fields", "id,name,status,category,language,components");
  url.searchParams.set("limit", "50");

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: { Authorization: `Bearer ${config.accessToken}` },
    cache: "no-store",
  });

  const payload = (await response.json().catch(() => null)) as
    | ({ data?: GraphTemplate[] } & MetaGraphErrorPayload)
    | null;

  if (!response.ok) {
    return NextResponse.json(
      { ok: false, error: getMetaGraphErrorMessage(payload, "No se pudieron cargar las plantillas de Meta.") },
      { status: response.status },
    );
  }

  return NextResponse.json({
    ok: true,
    templates: (payload?.data ?? []).map(mapGraphTemplate),
  });
}

const createTemplateSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Escribe el nombre de la plantilla.")
    .max(120, "El nombre es demasiado largo.")
    .transform((value) =>
      value
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, ""),
    )
    .refine((value) => value.length > 0, "El nombre debe tener letras o numeros."),
  category: z.enum(["UTILITY", "MARKETING"]),
  language: z.enum(["es", "es_CO", "es_MX", "en_US"]),
  bodyText: z.string().trim().min(1, "Escribe el contenido de la plantilla.").max(1024, "El contenido supera los 1024 caracteres."),
  addYesNoButtons: z.boolean().optional().default(false),
});

export async function POST(request: Request) {
  const result = await requireTemplateAccess();
  if ("error" in result) {
    return result.error;
  }

  const json = await request.json().catch(() => null);
  const parsed = createTemplateSchema.safeParse(json);

  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues[0]?.message || "Datos invalidos." },
      { status: 400 },
    );
  }

  const { config } = result;
  const components: Array<Record<string, unknown>> = [
    { type: "BODY", text: parsed.data.bodyText },
  ];

  if (parsed.data.addYesNoButtons) {
    components.push({
      type: "BUTTONS",
      buttons: [
        { type: "QUICK_REPLY", text: "Si" },
        { type: "QUICK_REPLY", text: "No" },
      ],
    });
  }

  const response = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(config.wabaId ?? "")}/message_templates`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        "Content-Type": "application/json",
      },
      cache: "no-store",
      body: JSON.stringify({
        name: parsed.data.name,
        category: parsed.data.category,
        language: parsed.data.language,
        components,
      }),
    },
  );

  const payload = (await response.json().catch(() => null)) as
    | ({ id?: string; status?: string; category?: string } & MetaGraphErrorPayload)
    | null;

  if (!response.ok) {
    return NextResponse.json(
      { ok: false, error: getMetaGraphErrorMessage(payload, "Meta no acepto la plantilla.") },
      { status: response.status },
    );
  }

  return NextResponse.json({
    ok: true,
    template: {
      id: payload?.id ?? "",
      name: parsed.data.name,
      status: payload?.status ?? "PENDING",
      category: payload?.category ?? parsed.data.category,
    },
  });
}
