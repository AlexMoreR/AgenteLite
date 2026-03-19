-- CreateTable
CREATE TABLE "WebhookEventLog" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "event" TEXT,
    "instanceName" TEXT,
    "channelId" TEXT,
    "workspaceId" TEXT,
    "status" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookEventLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WebhookEventLog_provider_createdAt_idx" ON "WebhookEventLog"("provider", "createdAt");

-- CreateIndex
CREATE INDEX "WebhookEventLog_instanceName_createdAt_idx" ON "WebhookEventLog"("instanceName", "createdAt");

-- CreateIndex
CREATE INDEX "WebhookEventLog_workspaceId_createdAt_idx" ON "WebhookEventLog"("workspaceId", "createdAt");
