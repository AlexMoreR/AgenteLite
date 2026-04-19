-- CreateTable
CREATE TABLE "FinanceAgentConfig" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "systemPrompt" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinanceAgentConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FinanceAgentConfig_workspaceId_key" ON "FinanceAgentConfig"("workspaceId");

-- AddForeignKey
ALTER TABLE "FinanceAgentConfig" ADD CONSTRAINT "FinanceAgentConfig_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
