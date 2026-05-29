import { NextResponse } from "next/server";
import { executePendingFollows } from "@/features/seguimientos/services/follows";

function resolveCronSecret() {
  return process.env.FOLLOW_CRON_SECRET?.trim() || process.env.EVOLUTION_WEBHOOK_SECRET?.trim() || "";
}

function readIncomingSecret(request: Request) {
  return (
    request.headers.get("x-follow-cron-secret") ||
    request.headers.get("x-webhook-secret") ||
    request.headers.get("authorization") ||
    ""
  ).trim();
}

async function handleCron(request: Request) {
  const expectedSecret = resolveCronSecret();
  const receivedSecret = readIncomingSecret(request);

  if (expectedSecret) {
    const normalizedExpected = expectedSecret.startsWith("Bearer ") ? expectedSecret.slice("Bearer ".length).trim() : expectedSecret;
    const normalizedReceived = receivedSecret.startsWith("Bearer ") ? receivedSecret.slice("Bearer ".length).trim() : receivedSecret;

    if (!normalizedReceived || normalizedReceived !== normalizedExpected) {
      return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { ok: false, error: "FOLLOW_CRON_SECRET no esta configurado" },
      { status: 500 },
    );
  }

  const result = await executePendingFollows({
    limit: 50,
  });

  return NextResponse.json({
    ok: true,
    ...result,
  });
}

export async function GET(request: Request) {
  return handleCron(request);
}

export async function POST(request: Request) {
  return handleCron(request);
}
