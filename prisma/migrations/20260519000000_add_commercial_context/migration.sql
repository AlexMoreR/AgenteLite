ALTER TABLE "Conversation"
ADD COLUMN IF NOT EXISTS "commercialContext" JSONB;

ALTER TABLE "OfficialApiConversation"
ADD COLUMN IF NOT EXISTS "commercialContext" JSONB;
