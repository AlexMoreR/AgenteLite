import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { ensureOfficialApiConfigTable } from "@/lib/official-api-config";

type MetaWebhookPayload = {
  object?: string;
  entry?: Array<{
    id?: string;
    changes?: Array<{
      field?: string;
      value?: {
        metadata?: {
          phone_number_id?: string;
          display_phone_number?: string;
        };
        statuses?: Array<{
          id?: string;
          status?: string;
        }>;
        messages?: Array<{
          id?: string;
          type?: string;
          from?: string;
          text?: {
            body?: string;
          };
        }>;
      };
    }>;
  }>;
};

type OfficialApiWebhookConfigRow = {
  id: string;
  appSecret: string | null;
};

async function findConfigByVerifyToken(verifyToken: string) {
  await ensureOfficialApiConfigTable();

  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "OfficialApiClientConfig"
    WHERE "webhookVerifyToken" = ${verifyToken}
    LIMIT 1
  `;

  return rows[0] ?? null;
}

async function findConfigByWebhookTarget(input: {
  phoneNumberId: string | null;
  wabaId: string | null;
}) {
  await ensureOfficialApiConfigTable();

  if (!input.phoneNumberId && !input.wabaId) {
    return null;
  }

  if (input.phoneNumberId && input.wabaId) {
    const rows = await prisma.$queryRaw<OfficialApiWebhookConfigRow[]>`
      SELECT "id", "appSecret"
      FROM "OfficialApiClientConfig"
      WHERE "phoneNumberId" = ${input.phoneNumberId}
         OR "wabaId" = ${input.wabaId}
      LIMIT 1
    `;
    return rows[0] ?? null;
  }

  if (input.phoneNumberId) {
    const rows = await prisma.$queryRaw<OfficialApiWebhookConfigRow[]>`
      SELECT "id", "appSecret"
      FROM "OfficialApiClientConfig"
      WHERE "phoneNumberId" = ${input.phoneNumberId}
      LIMIT 1
    `;
    return rows[0] ?? null;
  }

  const rows = await prisma.$queryRaw<OfficialApiWebhookConfigRow[]>`
    SELECT "id", "appSecret"
    FROM "OfficialApiClientConfig"
    WHERE "wabaId" = ${input.wabaId}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function storeWebhookEvent(input: {
  configId: string;
  eventType: string;
  deliveryId: string | null;
  payload: MetaWebhookPayload;
  status: "PROCESSED" | "FAILED";
  errorMessage?: string | null;
  processedAt?: Date | null;
}) {
  await prisma.$executeRaw`
    INSERT INTO "OfficialApiWebhookEvent" (
      "id",
      "configId",
      "eventType",
      "deliveryId",
      "payload",
      "status",
      "processedAt",
      "errorMessage",
      "createdAt",
      "updatedAt"
    )
    VALUES (
      ${randomUUID()},
      ${input.configId},
      ${input.eventType},
      ${input.deliveryId},
      ${JSON.stringify(input.payload)},
      ${input.status}::"OfficialApiWebhookStatus",
      ${input.processedAt ?? null},
      ${input.errorMessage ?? null},
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    )
  `;
}

function safeCompare(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function buildExpectedSignature(rawBody: string, appSecret: string) {
  return `sha256=${createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;
}

function extractPhoneNumberId(payload: MetaWebhookPayload) {
  return (
    payload.entry?.flatMap((entry) => entry.changes ?? []).find(
      (change) => change.value?.metadata?.phone_number_id,
    )?.value?.metadata?.phone_number_id ?? null
  );
}

function extractDeliveryId(payload: MetaWebhookPayload) {
  const change = payload.entry?.flatMap((entry) => entry.changes ?? [])[0];

  return (
    change?.value?.statuses?.[0]?.id ??
    change?.value?.messages?.[0]?.id ??
    null
  );
}

function extractEventType(payload: MetaWebhookPayload) {
  const change = payload.entry?.flatMap((entry) => entry.changes ?? [])[0];

  if (change?.field) {
    return change.field;
  }

  return payload.object || "unknown";
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get("hub.mode");
  const challenge = searchParams.get("hub.challenge");
  const verifyToken = searchParams.get("hub.verify_token")?.trim() || "";

  if (mode !== "subscribe" || !challenge || !verifyToken) {
    return NextResponse.json({ ok: false, error: "Invalid webhook verification request." }, { status: 400 });
  }

  const matchingConfig = await findConfigByVerifyToken(verifyToken);

  if (!matchingConfig) {
    return NextResponse.json({ ok: false, error: "Verify token invalido." }, { status: 403 });
  }

  return new NextResponse(challenge, {
    status: 200,
    headers: {
      "Content-Type": "text/plain",
    },
  });
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  let payload: MetaWebhookPayload | null = null;

  try {
    payload = (JSON.parse(rawBody) as MetaWebhookPayload | null) ?? null;
  } catch {
    payload = null;
  }

  if (!payload) {
    return NextResponse.json({ ok: false, error: "Invalid JSON payload." }, { status: 400 });
  }

  const phoneNumberId = extractPhoneNumberId(payload);
  const wabaId = payload.entry?.[0]?.id ?? null;
  if (!phoneNumberId && !wabaId) {
    return NextResponse.json({ ok: true, matched: false }, { status: 200 });
  }

  const config = await findConfigByWebhookTarget({ phoneNumberId, wabaId });

  if (!config) {
    return NextResponse.json({ ok: true, matched: false }, { status: 200 });
  }

  const signature = request.headers.get("x-hub-signature-256")?.trim() || "";
  if (config.appSecret?.trim()) {
    if (!signature) {
      return NextResponse.json({ ok: false, error: "Missing webhook signature." }, { status: 401 });
    }

    const expectedSignature = buildExpectedSignature(rawBody, config.appSecret.trim());
    if (!safeCompare(signature, expectedSignature)) {
      return NextResponse.json({ ok: false, error: "Invalid webhook signature." }, { status: 401 });
    }
  }

  const deliveryId = extractDeliveryId(payload);
  const eventType = extractEventType(payload);

  try {
    await storeWebhookEvent({
      configId: config.id,
      eventType,
      deliveryId,
      payload,
      status: "PROCESSED",
      processedAt: new Date(),
    });

    return NextResponse.json({ ok: true, matched: true }, { status: 200 });
  } catch (error) {
    await storeWebhookEvent({
      configId: config.id,
      eventType,
      deliveryId,
      payload,
      status: "FAILED",
      errorMessage: error instanceof Error ? error.message : "Unknown webhook processing error.",
    });

    return NextResponse.json({ ok: true, matched: true, stored: false }, { status: 200 });
  }
}
