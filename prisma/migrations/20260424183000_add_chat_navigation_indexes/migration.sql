CREATE INDEX "Conversation_workspaceId_lastMessageAt_updatedAt_idx" ON "Conversation"("workspaceId", "lastMessageAt", "updatedAt");

CREATE INDEX "OfficialApiConversation_configId_lastMessageAt_updatedAt_idx" ON "OfficialApiConversation"("configId", "lastMessageAt", "updatedAt");
