CREATE TYPE "OfficialApiConnectionStatus" AS ENUM ('NOT_CONNECTED', 'CONNECTED', 'ERROR');
CREATE TYPE "OfficialApiConversationStatus" AS ENUM ('OPEN', 'PENDING', 'CLOSED', 'ARCHIVED');
CREATE TYPE "OfficialApiMessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');
CREATE TYPE "OfficialApiMessageType" AS ENUM ('TEXT', 'IMAGE', 'AUDIO', 'VIDEO', 'DOCUMENT', 'TEMPLATE', 'INTERACTIVE', 'SYSTEM');
CREATE TYPE "OfficialApiMessageStatus" AS ENUM ('RECEIVED', 'SENT', 'DELIVERED', 'READ', 'FAILED');
CREATE TYPE "OfficialApiWebhookStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'FAILED');
CREATE TYPE "OfficialApiAutomationRuleStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED');

CREATE TABLE "OfficialApiClientConfig" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "accessToken" TEXT,
  "phoneNumberId" TEXT,
  "wabaId" TEXT,
  "webhookVerifyToken" TEXT,
  "appSecret" TEXT,
  "status" "OfficialApiConnectionStatus" NOT NULL DEFAULT 'NOT_CONNECTED',
  "lastValidatedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OfficialApiClientConfig_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OfficialApiContact" (
  "id" TEXT NOT NULL,
  "configId" TEXT NOT NULL,
  "externalUserId" TEXT,
  "waId" TEXT NOT NULL,
  "name" TEXT,
  "phoneNumber" TEXT,
  "metadata" JSONB,
  "lastMessageAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OfficialApiContact_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OfficialApiConversation" (
  "id" TEXT NOT NULL,
  "configId" TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  "externalThreadId" TEXT,
  "status" "OfficialApiConversationStatus" NOT NULL DEFAULT 'OPEN',
  "lastMessageAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OfficialApiConversation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OfficialApiMessage" (
  "id" TEXT NOT NULL,
  "configId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "contactId" TEXT,
  "externalMessageId" TEXT,
  "direction" "OfficialApiMessageDirection" NOT NULL,
  "type" "OfficialApiMessageType" NOT NULL DEFAULT 'TEXT',
  "status" "OfficialApiMessageStatus" NOT NULL DEFAULT 'RECEIVED',
  "content" TEXT,
  "mediaUrl" TEXT,
  "rawPayload" JSONB,
  "sentAt" TIMESTAMP(3),
  "deliveredAt" TIMESTAMP(3),
  "readAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OfficialApiMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OfficialApiWebhookEvent" (
  "id" TEXT NOT NULL,
  "configId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "deliveryId" TEXT,
  "payload" JSONB,
  "status" "OfficialApiWebhookStatus" NOT NULL DEFAULT 'RECEIVED',
  "processedAt" TIMESTAMP(3),
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OfficialApiWebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OfficialApiAutomationRule" (
  "id" TEXT NOT NULL,
  "configId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "triggerText" TEXT,
  "responseText" TEXT,
  "isFallback" BOOLEAN NOT NULL DEFAULT false,
  "priority" INTEGER NOT NULL DEFAULT 100,
  "status" "OfficialApiAutomationRuleStatus" NOT NULL DEFAULT 'DRAFT',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OfficialApiAutomationRule_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OfficialApiClientConfig_workspaceId_key" ON "OfficialApiClientConfig"("workspaceId");
CREATE INDEX "OfficialApiClientConfig_status_updatedAt_idx" ON "OfficialApiClientConfig"("status", "updatedAt");
CREATE UNIQUE INDEX "OfficialApiContact_configId_waId_key" ON "OfficialApiContact"("configId", "waId");
CREATE INDEX "OfficialApiContact_configId_lastMessageAt_idx" ON "OfficialApiContact"("configId", "lastMessageAt");
CREATE UNIQUE INDEX "OfficialApiConversation_configId_externalThreadId_key" ON "OfficialApiConversation"("configId", "externalThreadId");
CREATE INDEX "OfficialApiConversation_configId_status_lastMessageAt_idx" ON "OfficialApiConversation"("configId", "status", "lastMessageAt");
CREATE INDEX "OfficialApiConversation_contactId_lastMessageAt_idx" ON "OfficialApiConversation"("contactId", "lastMessageAt");
CREATE UNIQUE INDEX "OfficialApiMessage_configId_externalMessageId_key" ON "OfficialApiMessage"("configId", "externalMessageId");
CREATE INDEX "OfficialApiMessage_configId_createdAt_idx" ON "OfficialApiMessage"("configId", "createdAt");
CREATE INDEX "OfficialApiMessage_conversationId_createdAt_idx" ON "OfficialApiMessage"("conversationId", "createdAt");
CREATE INDEX "OfficialApiMessage_contactId_createdAt_idx" ON "OfficialApiMessage"("contactId", "createdAt");
CREATE INDEX "OfficialApiWebhookEvent_configId_createdAt_idx" ON "OfficialApiWebhookEvent"("configId", "createdAt");
CREATE INDEX "OfficialApiWebhookEvent_deliveryId_idx" ON "OfficialApiWebhookEvent"("deliveryId");
CREATE INDEX "OfficialApiAutomationRule_configId_status_priority_idx" ON "OfficialApiAutomationRule"("configId", "status", "priority");

ALTER TABLE "OfficialApiClientConfig"
ADD CONSTRAINT "OfficialApiClientConfig_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OfficialApiContact"
ADD CONSTRAINT "OfficialApiContact_configId_fkey"
FOREIGN KEY ("configId") REFERENCES "OfficialApiClientConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OfficialApiConversation"
ADD CONSTRAINT "OfficialApiConversation_configId_fkey"
FOREIGN KEY ("configId") REFERENCES "OfficialApiClientConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OfficialApiConversation"
ADD CONSTRAINT "OfficialApiConversation_contactId_fkey"
FOREIGN KEY ("contactId") REFERENCES "OfficialApiContact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OfficialApiMessage"
ADD CONSTRAINT "OfficialApiMessage_configId_fkey"
FOREIGN KEY ("configId") REFERENCES "OfficialApiClientConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OfficialApiMessage"
ADD CONSTRAINT "OfficialApiMessage_conversationId_fkey"
FOREIGN KEY ("conversationId") REFERENCES "OfficialApiConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OfficialApiMessage"
ADD CONSTRAINT "OfficialApiMessage_contactId_fkey"
FOREIGN KEY ("contactId") REFERENCES "OfficialApiContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "OfficialApiWebhookEvent"
ADD CONSTRAINT "OfficialApiWebhookEvent_configId_fkey"
FOREIGN KEY ("configId") REFERENCES "OfficialApiClientConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OfficialApiAutomationRule"
ADD CONSTRAINT "OfficialApiAutomationRule_configId_fkey"
FOREIGN KEY ("configId") REFERENCES "OfficialApiClientConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;
