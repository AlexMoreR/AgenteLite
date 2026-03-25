import { prisma } from "@/lib/prisma";

export type MarketingGenerationProvider = "OPENAI" | "GEMINI";
export type MarketingGenerationStatus = "PENDING" | "SUCCEEDED" | "FAILED";
export type MarketingGenerationTool = "FACEBOOK_ADS";

export type MarketingGenerationRecord = {
  id: string;
  workspaceId: string;
  tool: MarketingGenerationTool;
  provider: MarketingGenerationProvider;
  status: MarketingGenerationStatus;
  model: string | null;
  imageModel: string | null;
  input: unknown;
  output: unknown;
  imageUrl: string | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
};

let ensuredMarketingTable = false;

async function ensureMarketingGenerationTable(): Promise<void> {
  if (ensuredMarketingTable) {
    return;
  }

  await prisma.$executeRawUnsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'MarketingGenerationTool') THEN
        CREATE TYPE "MarketingGenerationTool" AS ENUM ('FACEBOOK_ADS');
      END IF;
    END
    $$;
  `);

  await prisma.$executeRawUnsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'MarketingGenerationProvider') THEN
        CREATE TYPE "MarketingGenerationProvider" AS ENUM ('OPENAI', 'GEMINI');
      END IF;
    END
    $$;
  `);

  await prisma.$executeRawUnsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'MarketingGenerationStatus') THEN
        CREATE TYPE "MarketingGenerationStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');
      END IF;
    END
    $$;
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "MarketingGeneration" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "workspaceId" TEXT NOT NULL,
      "tool" "MarketingGenerationTool" NOT NULL,
      "provider" "MarketingGenerationProvider" NOT NULL,
      "status" "MarketingGenerationStatus" NOT NULL DEFAULT 'PENDING',
      "model" TEXT,
      "imageModel" TEXT,
      "input" JSONB NOT NULL,
      "output" JSONB,
      "imageUrl" TEXT,
      "errorMessage" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "MarketingGeneration_workspaceId_fkey"
        FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE
    );
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "MarketingGeneration_workspaceId_tool_createdAt_idx"
    ON "MarketingGeneration"("workspaceId", "tool", "createdAt");
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "MarketingGeneration_workspaceId_status_createdAt_idx"
    ON "MarketingGeneration"("workspaceId", "status", "createdAt");
  `);

  ensuredMarketingTable = true;
}

function parseRecord(row: Record<string, unknown>): MarketingGenerationRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspaceId),
    tool: String(row.tool) as MarketingGenerationTool,
    provider: String(row.provider) as MarketingGenerationProvider,
    status: String(row.status) as MarketingGenerationStatus,
    model: row.model ? String(row.model) : null,
    imageModel: row.imageModel ? String(row.imageModel) : null,
    input: row.input ?? null,
    output: row.output ?? null,
    imageUrl: row.imageUrl ? String(row.imageUrl) : null,
    errorMessage: row.errorMessage ? String(row.errorMessage) : null,
    createdAt: new Date(String(row.createdAt)),
    updatedAt: new Date(String(row.updatedAt)),
  };
}

function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''");
}

export async function countMarketingGenerations(workspaceId: string): Promise<number> {
  await ensureMarketingGenerationTable();

  const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint | number }>>(`
    SELECT COUNT(*)::bigint AS count
    FROM "MarketingGeneration"
    WHERE "workspaceId" = '${escapeSqlString(workspaceId)}'
  `);

  const count = rows[0]?.count ?? 0;
  return typeof count === "bigint" ? Number(count) : Number(count);
}

export async function listMarketingGenerations(args: {
  workspaceId: string;
  tool: MarketingGenerationTool;
  limit?: number;
}): Promise<MarketingGenerationRecord[]> {
  await ensureMarketingGenerationTable();

  const limit = Math.max(1, Math.min(args.limit ?? 12, 50));
  const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`
    SELECT
      "id",
      "workspaceId",
      "tool",
      "provider",
      "status",
      "model",
      "imageModel",
      "input",
      "output",
      "imageUrl",
      "errorMessage",
      "createdAt",
      "updatedAt"
    FROM "MarketingGeneration"
    WHERE "workspaceId" = '${escapeSqlString(args.workspaceId)}'
      AND "tool" = '${escapeSqlString(args.tool)}'::"MarketingGenerationTool"
    ORDER BY "createdAt" DESC
    LIMIT ${limit}
  `);

  return rows.map(parseRecord);
}

export async function createMarketingGeneration(args: {
  id: string;
  workspaceId: string;
  tool: MarketingGenerationTool;
  provider: MarketingGenerationProvider;
  status: MarketingGenerationStatus;
  model?: string | null;
  imageModel?: string | null;
  input: unknown;
}): Promise<{ id: string }> {
  await ensureMarketingGenerationTable();

  await prisma.$executeRawUnsafe(`
    INSERT INTO "MarketingGeneration" (
      "id",
      "workspaceId",
      "tool",
      "provider",
      "status",
      "model",
      "imageModel",
      "input",
      "createdAt",
      "updatedAt"
    )
    VALUES (
      '${escapeSqlString(args.id)}',
      '${escapeSqlString(args.workspaceId)}',
      '${escapeSqlString(args.tool)}'::"MarketingGenerationTool",
      '${escapeSqlString(args.provider)}'::"MarketingGenerationProvider",
      '${escapeSqlString(args.status)}'::"MarketingGenerationStatus",
      ${args.model ? `'${escapeSqlString(args.model)}'` : "NULL"},
      ${args.imageModel ? `'${escapeSqlString(args.imageModel)}'` : "NULL"},
      '${escapeSqlString(JSON.stringify(args.input))}'::jsonb,
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    )
  `);

  return { id: args.id };
}

export async function updateMarketingGeneration(args: {
  id: string;
  status?: MarketingGenerationStatus;
  output?: unknown;
  imageUrl?: string | null;
  errorMessage?: string | null;
}): Promise<void> {
  await ensureMarketingGenerationTable();

  const updates: string[] = [`"updatedAt" = CURRENT_TIMESTAMP`];

  if (args.status) {
    updates.push(`"status" = '${escapeSqlString(args.status)}'::"MarketingGenerationStatus"`);
  }

  if (args.output !== undefined) {
    updates.push(`"output" = '${escapeSqlString(JSON.stringify(args.output))}'::jsonb`);
  }

  if (args.imageUrl !== undefined) {
    updates.push(`"imageUrl" = ${args.imageUrl ? `'${escapeSqlString(args.imageUrl)}'` : "NULL"}`);
  }

  if (args.errorMessage !== undefined) {
    updates.push(`"errorMessage" = ${args.errorMessage ? `'${escapeSqlString(args.errorMessage)}'` : "NULL"}`);
  }

  await prisma.$executeRawUnsafe(`
    UPDATE "MarketingGeneration"
    SET ${updates.join(", ")}
    WHERE "id" = '${escapeSqlString(args.id)}'
  `);
}

export async function deleteMarketingGeneration(args: {
  id: string;
  workspaceId: string;
}): Promise<boolean> {
  await ensureMarketingGenerationTable();

  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(`
    DELETE FROM "MarketingGeneration"
    WHERE "id" = '${escapeSqlString(args.id)}'
      AND "workspaceId" = '${escapeSqlString(args.workspaceId)}'
    RETURNING "id"
  `);

  return rows.length > 0;
}
