-- CreateTable
CREATE TABLE "AgentCopilotMessage" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentCopilotMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentCopilotMessage_workspaceId_agentId_createdAt_idx" ON "AgentCopilotMessage"("workspaceId", "agentId", "createdAt");

-- AddForeignKey
ALTER TABLE "AgentCopilotMessage" ADD CONSTRAINT "AgentCopilotMessage_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentCopilotMessage" ADD CONSTRAINT "AgentCopilotMessage_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
