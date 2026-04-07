import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getOfficialApiConfigByWorkspaceId } from "@/lib/official-api-config";

export async function GET(request: Request) {
  const session = await auth();

  if (session?.user?.role !== "ADMIN") {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const workspaceId = searchParams.get("workspaceId")?.trim() || "";

  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId es requerido" }, { status: 400 });
  }

  const config = await getOfficialApiConfigByWorkspaceId(workspaceId);

  return NextResponse.json({
    ok: true,
    config: config
      ? {
          status: config.status,
          lastValidatedAt: config.lastValidatedAt?.toISOString() ?? null,
        }
      : null,
  });
}
