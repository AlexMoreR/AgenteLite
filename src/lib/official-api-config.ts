import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { randomUUID } from "node:crypto";

let ensureOfficialApiConfigTablePromise: Promise<void> | null = null;

export type OfficialApiConfigRecord = {
  id: string;
  workspaceId: string;
  accessToken: string | null;
  phoneNumberId: string | null;
  wabaId: string | null;
  webhookVerifyToken: string | null;
  appSecret: string | null;
  status: "NOT_CONNECTED" | "CONNECTED" | "ERROR";
  lastValidatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export function hasOfficialApiBaseCredentials(
  config: Pick<OfficialApiConfigRecord, "accessToken" | "phoneNumberId" | "wabaId"> | null | undefined,
): boolean {
  return Boolean(
    config?.accessToken?.trim() &&
      config.phoneNumberId?.trim() &&
      config.wabaId?.trim(),
  );
}

export async function ensureOfficialApiConfigTable(): Promise<void> {
  if (ensureOfficialApiConfigTablePromise) {
    await ensureOfficialApiConfigTablePromise;
    return;
  }

  ensureOfficialApiConfigTablePromise = (async () => {
    await prisma.$executeRawUnsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OfficialApiConnectionStatus') THEN
        CREATE TYPE "OfficialApiConnectionStatus" AS ENUM ('NOT_CONNECTED', 'CONNECTED', 'ERROR');
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OfficialApiConversationStatus') THEN
        CREATE TYPE "OfficialApiConversationStatus" AS ENUM ('OPEN', 'PENDING', 'CLOSED', 'ARCHIVED');
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OfficialApiMessageDirection') THEN
        CREATE TYPE "OfficialApiMessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OfficialApiMessageType') THEN
        CREATE TYPE "OfficialApiMessageType" AS ENUM ('TEXT', 'IMAGE', 'AUDIO', 'VIDEO', 'DOCUMENT', 'TEMPLATE', 'INTERACTIVE', 'SYSTEM');
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OfficialApiMessageStatus') THEN
        CREATE TYPE "OfficialApiMessageStatus" AS ENUM ('RECEIVED', 'SENT', 'DELIVERED', 'READ', 'FAILED');
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OfficialApiWebhookStatus') THEN
        CREATE TYPE "OfficialApiWebhookStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'FAILED');
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OfficialApiAutomationRuleStatus') THEN
        CREATE TYPE "OfficialApiAutomationRuleStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED');
      END IF;
    END $$;
  `);

    await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "OfficialApiClientConfig" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "workspaceId" TEXT NOT NULL UNIQUE,
      "accessToken" TEXT,
      "phoneNumberId" TEXT,
      "wabaId" TEXT,
      "webhookVerifyToken" TEXT,
      "appSecret" TEXT,
      "status" "OfficialApiConnectionStatus" NOT NULL DEFAULT 'NOT_CONNECTED',
      "lastValidatedAt" TIMESTAMP(3),
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "OfficialApiClientConfig_workspaceId_fkey"
        FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
        ON DELETE CASCADE ON UPDATE CASCADE
    );
  `);

    await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "OfficialApiClientConfig_status_updatedAt_idx"
    ON "OfficialApiClientConfig" ("status", "updatedAt");
  `);

    await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "OfficialApiContact" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "configId" TEXT NOT NULL,
      "externalUserId" TEXT,
      "waId" TEXT NOT NULL,
      "name" TEXT,
      "phoneNumber" TEXT,
      "metadata" JSONB,
      "lastMessageAt" TIMESTAMP(3),
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "OfficialApiContact_configId_fkey"
        FOREIGN KEY ("configId") REFERENCES "OfficialApiClientConfig"("id")
        ON DELETE CASCADE ON UPDATE CASCADE
    );
  `);

    await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "OfficialApiContact_configId_waId_key"
    ON "OfficialApiContact" ("configId", "waId");
  `);

    await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "OfficialApiContact_configId_lastMessageAt_idx"
    ON "OfficialApiContact" ("configId", "lastMessageAt");
  `);

    await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "OfficialApiConversation" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "configId" TEXT NOT NULL,
      "contactId" TEXT NOT NULL,
      "externalThreadId" TEXT,
      "status" "OfficialApiConversationStatus" NOT NULL DEFAULT 'OPEN',
      "lastMessageAt" TIMESTAMP(3),
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "OfficialApiConversation_configId_fkey"
        FOREIGN KEY ("configId") REFERENCES "OfficialApiClientConfig"("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "OfficialApiConversation_contactId_fkey"
        FOREIGN KEY ("contactId") REFERENCES "OfficialApiContact"("id")
        ON DELETE CASCADE ON UPDATE CASCADE
    );
  `);

    await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "OfficialApiConversation_configId_externalThreadId_key"
    ON "OfficialApiConversation" ("configId", "externalThreadId");
  `);

    await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "OfficialApiConversation_configId_status_lastMessageAt_idx"
    ON "OfficialApiConversation" ("configId", "status", "lastMessageAt");
  `);

    await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "OfficialApiConversation_contactId_lastMessageAt_idx"
    ON "OfficialApiConversation" ("contactId", "lastMessageAt");
  `);

    await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "OfficialApiMessage" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "configId" TEXT NOT NULL,
      "conversationId" TEXT NOT NULL,
      "contactId" TEXT,
      "externalMessageId" TEXT,
      "direction" "OfficialApiMessageDirection" NOT NULL,
      "type" "OfficialApiMessageType" NOT NULL DEFAULT 'TEXT',
      "status" "OfficialApiMessageStatus" NOT NULL DEFAULT 'RECEIVED',
      "content" TEXT,
      "mediaUrl" TEXT,
      "rawPayload" JSONB,
      "sentAt" TIMESTAMP(3),
      "deliveredAt" TIMESTAMP(3),
      "readAt" TIMESTAMP(3),
      "failedAt" TIMESTAMP(3),
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "OfficialApiMessage_configId_fkey"
        FOREIGN KEY ("configId") REFERENCES "OfficialApiClientConfig"("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "OfficialApiMessage_conversationId_fkey"
        FOREIGN KEY ("conversationId") REFERENCES "OfficialApiConversation"("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "OfficialApiMessage_contactId_fkey"
        FOREIGN KEY ("contactId") REFERENCES "OfficialApiContact"("id")
        ON DELETE SET NULL ON UPDATE CASCADE
    );
  `);

    await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "OfficialApiMessage_configId_externalMessageId_key"
    ON "OfficialApiMessage" ("configId", "externalMessageId");
  `);

    await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "OfficialApiMessage_configId_createdAt_idx"
    ON "OfficialApiMessage" ("configId", "createdAt");
  `);

    await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "OfficialApiMessage_conversationId_createdAt_idx"
    ON "OfficialApiMessage" ("conversationId", "createdAt");
  `);

    await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "OfficialApiMessage_contactId_createdAt_idx"
    ON "OfficialApiMessage" ("contactId", "createdAt");
  `);

    await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "OfficialApiWebhookEvent" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "configId" TEXT NOT NULL,
      "eventType" TEXT NOT NULL,
      "deliveryId" TEXT,
      "payload" JSONB,
      "status" "OfficialApiWebhookStatus" NOT NULL DEFAULT 'RECEIVED',
      "processedAt" TIMESTAMP(3),
      "errorMessage" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "OfficialApiWebhookEvent_configId_fkey"
        FOREIGN KEY ("configId") REFERENCES "OfficialApiClientConfig"("id")
        ON DELETE CASCADE ON UPDATE CASCADE
    );
  `);

    await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "OfficialApiWebhookEvent_configId_createdAt_idx"
    ON "OfficialApiWebhookEvent" ("configId", "createdAt");
  `);

    await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "OfficialApiWebhookEvent_deliveryId_idx"
    ON "OfficialApiWebhookEvent" ("deliveryId");
  `);

    await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "OfficialApiAutomationRule" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "configId" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "description" TEXT,
      "triggerText" TEXT,
      "responseText" TEXT,
      "isFallback" BOOLEAN NOT NULL DEFAULT false,
      "priority" INTEGER NOT NULL DEFAULT 100,
      "status" "OfficialApiAutomationRuleStatus" NOT NULL DEFAULT 'DRAFT',
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "OfficialApiAutomationRule_configId_fkey"
        FOREIGN KEY ("configId") REFERENCES "OfficialApiClientConfig"("id")
        ON DELETE CASCADE ON UPDATE CASCADE
    );
  `);

    await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "OfficialApiAutomationRule_configId_status_priority_idx"
    ON "OfficialApiAutomationRule" ("configId", "status", "priority");
    `);
  })().catch((error) => {
    ensureOfficialApiConfigTablePromise = null;
    throw error;
  });

  await ensureOfficialApiConfigTablePromise;
}

export async function getOfficialApiConfigByWorkspaceIds(
  workspaceIds: string[],
): Promise<Map<string, OfficialApiConfigRecord>> {
  await ensureOfficialApiConfigTable();

  if (workspaceIds.length === 0) {
    return new Map();
  }

  const rows = await prisma.$queryRaw<OfficialApiConfigRecord[]>`
    SELECT
      "id",
      "workspaceId",
      "accessToken",
      "phoneNumberId",
      "wabaId",
      "webhookVerifyToken",
      "appSecret",
      "status"::text as "status",
      "lastValidatedAt",
      "createdAt",
      "updatedAt"
    FROM "OfficialApiClientConfig"
    WHERE "workspaceId" IN (${Prisma.join(workspaceIds)})
  `;

  return new Map(rows.map((row) => [row.workspaceId, row]));
}

export async function getOfficialApiConfigByWorkspaceId(
  workspaceId: string,
): Promise<OfficialApiConfigRecord | null> {
  const rows = await getOfficialApiConfigByWorkspaceIds([workspaceId]);
  return rows.get(workspaceId) ?? null;
}

export async function upsertOfficialApiConfigByWorkspaceId(input: {
  workspaceId: string;
  accessToken: string;
  phoneNumberId: string;
  wabaId: string;
  webhookVerifyToken?: string;
  appSecret?: string;
}): Promise<void> {
  await ensureOfficialApiConfigTable();

  const status =
    input.accessToken.trim() && input.phoneNumberId.trim() && input.wabaId.trim()
      ? "CONNECTED"
      : "NOT_CONNECTED";

  await prisma.$executeRaw`
    INSERT INTO "OfficialApiClientConfig" (
      "id",
      "workspaceId",
      "accessToken",
      "phoneNumberId",
      "wabaId",
      "webhookVerifyToken",
      "appSecret",
      "status",
      "createdAt",
      "updatedAt"
    )
    VALUES (
      ${randomUUID()},
      ${input.workspaceId},
      ${input.accessToken.trim() || null},
      ${input.phoneNumberId.trim() || null},
      ${input.wabaId.trim() || null},
      ${input.webhookVerifyToken?.trim() || null},
      ${input.appSecret?.trim() || null},
      ${status}::"OfficialApiConnectionStatus",
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    )
    ON CONFLICT ("workspaceId")
    DO UPDATE SET
      "accessToken" = EXCLUDED."accessToken",
      "phoneNumberId" = EXCLUDED."phoneNumberId",
      "wabaId" = EXCLUDED."wabaId",
      "webhookVerifyToken" = EXCLUDED."webhookVerifyToken",
      "appSecret" = EXCLUDED."appSecret",
      "status" = EXCLUDED."status",
      "updatedAt" = CURRENT_TIMESTAMP
  `;
}
