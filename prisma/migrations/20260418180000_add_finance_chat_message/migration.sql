-- CreateTable
CREATE TABLE "FinanceChatMessage" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinanceChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FinanceChatMessage_workspaceId_createdAt_idx" ON "FinanceChatMessage"("workspaceId", "createdAt");

-- AddForeignKey
ALTER TABLE "FinanceChatMessage" ADD CONSTRAINT "FinanceChatMessage_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
