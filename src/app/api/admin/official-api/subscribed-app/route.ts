import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getOfficialApiConfigByWorkspaceId } from "@/lib/official-api-config";
import {
  getOfficialApiSubscribedAppStatus,
  subscribeOfficialApiAppToWaba,
} from "@/lib/official-api-subscription";

function unauthorizedResponse() {
  return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
}

function getTrimmedString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function GET(request: Request) {
  const session = await auth();

  if (session?.user?.role !== "ADMIN") {
    return unauthorizedResponse();
  }

  const { searchParams } = new URL(request.url);
  const workspaceId = searchParams.get("workspaceId")?.trim() || "";

  if (!workspaceId) {
    return NextResponse.json({ ok: false, error: "workspaceId es requerido" }, { status: 400 });
  }

  const config = await getOfficialApiConfigByWorkspaceId(workspaceId);

  if (!config?.wabaId?.trim() || !config.accessToken?.trim()) {
    return NextResponse.json(
      { ok: false, error: "Faltan WABA ID o Access Token guardados para consultar la suscripcion." },
      { status: 400 },
    );
  }

  const result = await getOfficialApiSubscribedAppStatus({
    wabaId: config.wabaId.trim(),
    accessToken: config.accessToken.trim(),
  });

  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}

export async function POST(request: Request) {
  const session = await auth();

  if (session?.user?.role !== "ADMIN") {
    return unauthorizedResponse();
  }

  const body = (await request.json().catch(() => null)) as
    | {
        workspaceId?: string;
        wabaId?: string;
        accessToken?: string;
      }
    | null;

  const workspaceId = getTrimmedString(body?.workspaceId);
  const providedWabaId = getTrimmedString(body?.wabaId);
  const providedAccessToken = getTrimmedString(body?.accessToken);

  if (!workspaceId) {
    return NextResponse.json({ ok: false, error: "workspaceId es requerido" }, { status: 400 });
  }

  const config = await getOfficialApiConfigByWorkspaceId(workspaceId);
  const wabaId = providedWabaId || config?.wabaId?.trim() || "";
  const accessToken = providedAccessToken || config?.accessToken?.trim() || "";

  if (!wabaId || !accessToken) {
    return NextResponse.json(
      { ok: false, error: "Completa y guarda WABA ID y Access Token antes de suscribir la app." },
      { status: 400 },
    );
  }

  const result = await subscribeOfficialApiAppToWaba({
    wabaId,
    accessToken,
  });

  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
