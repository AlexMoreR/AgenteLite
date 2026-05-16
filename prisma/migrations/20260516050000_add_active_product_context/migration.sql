ALTER TABLE "Conversation"
ADD COLUMN IF NOT EXISTS "activeProductContext" JSONB;

ALTER TABLE "OfficialApiConversation"
ADD COLUMN IF NOT EXISTS "activeProductContext" JSONB;
