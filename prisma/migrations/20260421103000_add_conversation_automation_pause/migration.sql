ALTER TABLE "Conversation"
ADD COLUMN "automationPaused" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "automationPausedAt" TIMESTAMP(3);
