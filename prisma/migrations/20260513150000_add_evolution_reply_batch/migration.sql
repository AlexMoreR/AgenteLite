ALTER TABLE "Conversation"
ADD COLUMN "autoReplyBatchStartedAt" TIMESTAMP(3),
ADD COLUMN "autoReplyBatchDueAt" TIMESTAMP(3),
ADD COLUMN "autoReplyBatchToken" TEXT;

CREATE INDEX IF NOT EXISTS "Conversation_workspaceId_autoReplyBatchDueAt_idx"
ON "Conversation" ("workspaceId", "autoReplyBatchDueAt");

CREATE INDEX IF NOT EXISTS "Conversation_channelId_autoReplyBatchDueAt_idx"
ON "Conversation" ("channelId", "autoReplyBatchDueAt");
