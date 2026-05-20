ALTER TABLE "Conversation"
ADD COLUMN IF NOT EXISTS "autoReplyBuffer" JSONB;
