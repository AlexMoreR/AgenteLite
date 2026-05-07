-- CreateIndex
CREATE INDEX "OfficialApiMessage_conversationId_direction_createdAt_idx"
ON "OfficialApiMessage"("conversationId", "direction", "createdAt");
