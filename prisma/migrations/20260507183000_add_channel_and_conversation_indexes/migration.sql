-- CreateIndex
CREATE INDEX "WhatsAppChannel_workspaceId_provider_evolutionInstanceName_idx"
ON "WhatsAppChannel"("workspaceId", "provider", "evolutionInstanceName");

-- CreateIndex
CREATE INDEX "Conversation_workspaceId_channelId_contactId_idx"
ON "Conversation"("workspaceId", "channelId", "contactId");
