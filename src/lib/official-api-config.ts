import { prisma } from "@/lib/prisma";
import { randomUUID } from "node:crypto";

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

export async function ensureOfficialApiConfigTable(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OfficialApiConnectionStatus') THEN
        CREATE TYPE "OfficialApiConnectionStatus" AS ENUM ('NOT_CONNECTED', 'CONNECTED', 'ERROR');
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
    WHERE "workspaceId" IN (${workspaceIds})
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
