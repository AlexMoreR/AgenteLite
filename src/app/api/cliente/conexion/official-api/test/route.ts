import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { canAccessClientModule, getClientWorkspaceAccessForUser } from "@/lib/client-workspace-access";
import { getMetaGraphErrorMessage, type MetaGraphErrorPayload } from "@/lib/official-api-graph";
import { getOfficialApiSubscribedAppStatus } from "@/lib/official-api-subscription";

const testOfficialApiSchema = z.object({
  accessToken: z.string().trim().min(1, "Pega el access token de Meta."),
  phoneNumberId: z.string().trim().min(1, "Pega el Phone Number ID."),
  wabaId: z.string().trim().min(1, "Pega el WABA ID."),
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
  const parsed = testOfficialApiSchema.safeParse(json);

  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: parsed.error.issues[0]?.message || "No se pudo probar la API oficial.",
      },
      { status: 400 },
    );
  }

  const phoneResponse = await fetch(
    `https://graph.facebook.com/v23.0/${encodeURIComponent(parsed.data.phoneNumberId)}?fields=display_phone_number,verified_name,quality_rating`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${parsed.data.accessToken}`,
      },
      cache: "no-store",
    },
  );

  const phonePayload = (await phoneResponse.json().catch(() => null)) as
    | ({
        display_phone_number?: string;
        verified_name?: string;
        quality_rating?: string;
      } & MetaGraphErrorPayload)
    | null;

  if (!phoneResponse.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: getMetaGraphErrorMessage(phonePayload, "No se pudo validar el Phone Number ID en Meta."),
      },
      { status: phoneResponse.status },
    );
  }

  const subscription = await getOfficialApiSubscribedAppStatus({
    wabaId: parsed.data.wabaId,
    accessToken: parsed.data.accessToken,
  });

  if (!subscription.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: subscription.error || "No se pudo validar el WABA ID en Meta.",
      },
      { status: 400 },
    );
  }

  const phoneLabel = phonePayload?.display_phone_number?.trim() || parsed.data.phoneNumberId;
  const verifiedName = phonePayload?.verified_name?.trim();
  const qualityRating = phonePayload?.quality_rating?.trim();

  return NextResponse.json({
    ok: true,
    subscribed: subscription.subscribed,
    appId: subscription.appId,
    phoneDisplayNumber: phonePayload?.display_phone_number ?? null,
    verifiedName: verifiedName ?? null,
    qualityRating: qualityRating ?? null,
    message: subscription.subscribed
      ? `API validada correctamente para ${phoneLabel}${verifiedName ? ` (${verifiedName})` : ""}.`
      : `API validada correctamente para ${phoneLabel}${verifiedName ? ` (${verifiedName})` : ""}. La app aun no aparece suscrita al WABA.`,
  });
}
