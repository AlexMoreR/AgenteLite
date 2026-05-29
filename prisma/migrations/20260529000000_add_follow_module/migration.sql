DO $$ BEGIN
  CREATE TYPE "FollowSourceType" AS ENUM ('FLOW', 'PRODUCT', 'TAG', 'CRM_STAGE', 'MANUAL');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "FollowTimeType" AS ENUM ('MINUTES', 'HOURS', 'DAYS');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "FollowMessageType" AS ENUM ('TEXT', 'AUDIO', 'IMAGE', 'VIDEO', 'DOC');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "FollowStatus" AS ENUM ('PENDING', 'EXECUTED', 'CANCELLED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "FollowProvider" AS ENUM ('EVOLUTION');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "FollowRule" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "channelId" TEXT,
  "name" TEXT NOT NULL,
  "sourceType" "FollowSourceType" NOT NULL,
  "sourceId" TEXT,
  "timeType" "FollowTimeType" NOT NULL,
  "timeValue" INTEGER NOT NULL,
  "messageType" "FollowMessageType" NOT NULL,
  "content" TEXT,
  "mediaUrl" TEXT,
  "cancelOnActivity" BOOLEAN NOT NULL DEFAULT TRUE,
  "provider" "FollowProvider" NOT NULL DEFAULT 'EVOLUTION',
  "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FollowRule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Follow" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  "followRuleId" TEXT,
  "channelId" TEXT,
  "timeType" "FollowTimeType" NOT NULL,
  "timeValue" INTEGER NOT NULL,
  "executeAt" TIMESTAMP(3) NOT NULL,
  "messageType" "FollowMessageType" NOT NULL,
  "content" TEXT,
  "mediaUrl" TEXT,
  "status" "FollowStatus" NOT NULL DEFAULT 'PENDING',
  "provider" "FollowProvider" NOT NULL DEFAULT 'EVOLUTION',
  "cancelOnActivity" BOOLEAN NOT NULL DEFAULT TRUE,
  "executionError" TEXT,
  "executedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "lockedAt" TIMESTAMP(3),
  "lockedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Follow_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "FollowRule_workspaceId_sourceType_sourceId_idx"
  ON "FollowRule"("workspaceId", "sourceType", "sourceId");

CREATE INDEX IF NOT EXISTS "FollowRule_workspaceId_isActive_idx"
  ON "FollowRule"("workspaceId", "isActive");

CREATE INDEX IF NOT EXISTS "FollowRule_channelId_idx"
  ON "FollowRule"("channelId");

CREATE INDEX IF NOT EXISTS "Follow_workspaceId_contactId_status_executeAt_idx"
  ON "Follow"("workspaceId", "contactId", "status", "executeAt");

CREATE INDEX IF NOT EXISTS "Follow_workspaceId_status_executeAt_idx"
  ON "Follow"("workspaceId", "status", "executeAt");

CREATE INDEX IF NOT EXISTS "Follow_followRuleId_idx"
  ON "Follow"("followRuleId");

CREATE INDEX IF NOT EXISTS "Follow_channelId_idx"
  ON "Follow"("channelId");

CREATE INDEX IF NOT EXISTS "Follow_lockedAt_idx"
  ON "Follow"("lockedAt");

ALTER TABLE "FollowRule"
  ADD CONSTRAINT "FollowRule_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FollowRule"
  ADD CONSTRAINT "FollowRule_channelId_fkey"
  FOREIGN KEY ("channelId") REFERENCES "WhatsAppChannel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Follow"
  ADD CONSTRAINT "Follow_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Follow"
  ADD CONSTRAINT "Follow_contactId_fkey"
  FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Follow"
  ADD CONSTRAINT "Follow_followRuleId_fkey"
  FOREIGN KEY ("followRuleId") REFERENCES "FollowRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Follow"
  ADD CONSTRAINT "Follow_channelId_fkey"
  FOREIGN KEY ("channelId") REFERENCES "WhatsAppChannel"("id") ON DELETE SET NULL ON UPDATE CASCADE;
