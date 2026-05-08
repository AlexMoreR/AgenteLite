-- Track edited/deleted lifecycle for chat messages.
ALTER TABLE "Message"
ADD COLUMN IF NOT EXISTS "editedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
