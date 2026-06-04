-- Add chat assignment: a conversation can be assigned to a workspace user.
ALTER TABLE "Conversation" ADD COLUMN "assignedToUserId" TEXT;

CREATE INDEX "Conversation_workspaceId_assignedToUserId_idx"
ON "Conversation"("workspaceId", "assignedToUserId");

ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_assignedToUserId_fkey"
FOREIGN KEY ("assignedToUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
