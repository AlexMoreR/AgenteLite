import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import {
  exchangeEmbeddedSignupCodeForAccessToken,
  parseEmbeddedSignupSessionResponse,
} from "@/lib/official-api-embedded-signup";
import { getOfficialApiProviderSettings } from "@/lib/system-settings";

const importEmbeddedSignupSchema = z.object({
  code: z.string().trim().optional(),
  sessionResponse: z.string().trim().optional(),
  accessToken: z.string().trim().optional(),
  appId: z.string().trim().optional(),
  appSecret: z.string().trim().optional(),
});

function getTrimmedString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: Request) {
  const session = await auth();

  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE", "EMPLEADO"].includes(session.user.role)) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  await requireClientWorkspaceAccess("connection");

  const json = await request.json().catch(() => null);
  const parsed = importEmbeddedSignupSchema.safeParse(json);

  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: parsed.error.issues[0]?.message || "Datos invalidos para importar el Embedded Signup.",
      },
      { status: 400 },
    );
  }

  const providerSettings = await getOfficialApiProviderSettings();
  const sessionResponse = getTrimmedString(parsed.data.sessionResponse);
  const embeddedSignupCode = getTrimmedString(parsed.data.code);
  const providedAccessToken = getTrimmedString(parsed.data.accessToken);

  if (!sessionResponse) {
    return NextResponse.json(
      {
        ok: false,
        error: "Pega la respuesta de registro de la sesion para importar los IDs de Meta.",
      },
      { status: 400 },
    );
  }

  let accessToken = providedAccessToken;
  let tokenSource: "existing" | "code" = "existing";

  if (!accessToken && embeddedSignupCode) {
    const appId = getTrimmedString(parsed.data.appId) || providerSettings.appId;
    const appSecret = getTrimmedString(parsed.data.appSecret) || providerSettings.appSecret;

    if (!appId || !appSecret) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Falta el App ID o el App Secret del proveedor para cambiar el code por token. Configuralos en el servidor o pegalos temporalmente en el modal.",
        },
        { status: 400 },
      );
    }

    try {
      const exchanged = await exchangeEmbeddedSignupCodeForAccessToken({
        code: embeddedSignupCode,
        appId,
        appSecret,
      });

      accessToken = exchanged.accessToken;
      tokenSource = "code";
    } catch (error) {
      return NextResponse.json(
        {
          ok: false,
          error:
            error instanceof Error
              ? error.message
              : "No se pudo cambiar el code de Embedded Signup por un access token.",
        },
        { status: 400 },
      );
    }
  }

  if (!accessToken) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Pega un access token valido o agrega un code vigente de Embedded Signup para completar la importacion.",
      },
      { status: 400 },
    );
  }

  try {
    const sessionData = parseEmbeddedSignupSessionResponse(sessionResponse);

    return NextResponse.json({
      ok: true,
      accessToken,
      phoneNumberId: sessionData.phoneNumberId,
      wabaId: sessionData.wabaId,
      businessId: sessionData.businessId,
      tokenSource,
    });
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
}
