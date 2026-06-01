-- Improve chat performance for list, summary, and unread-count queries.
CREATE INDEX "Message_workspaceId_conversationId_direction_createdAt_idx"
ON "Message"("workspaceId", "conversationId", "direction", "createdAt");

CREATE INDEX "ContactTag_workspaceId_contactId_createdAt_idx"
ON "ContactTag"("workspaceId", "contactId", "createdAt");
