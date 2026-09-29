-- CreateTable
CREATE TABLE "SalesFunnel" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Embudo de ventas',
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesFunnel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesFunnelStep" (
    "id" TEXT NOT NULL,
    "funnelId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "goal" TEXT,
    "alertAfterMessages" INTEGER,
    "entryOnFlowSent" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesFunnelStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesFunnelStepFollowUp" (
    "id" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "delayMinutes" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesFunnelStepFollowUp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CategoryPlaybook" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "qualifyingQuestion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CategoryPlaybook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CategoryObjection" (
    "id" TEXT NOT NULL,
    "playbookId" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CategoryObjection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductSpec" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductSpec_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductSpecField" (
    "id" TEXT NOT NULL,
    "specId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductSpecField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductObjection" (
    "id" TEXT NOT NULL,
    "specId" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductObjection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationFunnelState" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "productId" TEXT,
    "enteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "messagesInStep" INTEGER NOT NULL DEFAULT 0,
    "followUpsSent" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "alertedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConversationFunnelState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SalesFunnel_workspaceId_key" ON "SalesFunnel"("workspaceId");

-- CreateIndex
CREATE INDEX "SalesFunnelStep_funnelId_sortOrder_idx" ON "SalesFunnelStep"("funnelId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "SalesFunnelStep_funnelId_key_key" ON "SalesFunnelStep"("funnelId", "key");

-- CreateIndex
CREATE INDEX "SalesFunnelStepFollowUp_stepId_sortOrder_idx" ON "SalesFunnelStepFollowUp"("stepId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "SalesFunnelStepFollowUp_stepId_key_key" ON "SalesFunnelStepFollowUp"("stepId", "key");

-- CreateIndex
CREATE INDEX "CategoryPlaybook_workspaceId_idx" ON "CategoryPlaybook"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "CategoryPlaybook_workspaceId_categoryId_key" ON "CategoryPlaybook"("workspaceId", "categoryId");

-- CreateIndex
CREATE INDEX "CategoryObjection_playbookId_sortOrder_idx" ON "CategoryObjection"("playbookId", "sortOrder");

-- CreateIndex
CREATE INDEX "ProductSpec_workspaceId_idx" ON "ProductSpec"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductSpec_workspaceId_productId_key" ON "ProductSpec"("workspaceId", "productId");

-- CreateIndex
CREATE INDEX "ProductSpecField_specId_sortOrder_idx" ON "ProductSpecField"("specId", "sortOrder");

-- CreateIndex
CREATE INDEX "ProductObjection_specId_sortOrder_idx" ON "ProductObjection"("specId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationFunnelState_conversationId_key" ON "ConversationFunnelState"("conversationId");

-- CreateIndex
CREATE INDEX "ConversationFunnelState_workspaceId_stepId_enteredAt_idx" ON "ConversationFunnelState"("workspaceId", "stepId", "enteredAt");

-- AddForeignKey
ALTER TABLE "SalesFunnel" ADD CONSTRAINT "SalesFunnel_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesFunnelStep" ADD CONSTRAINT "SalesFunnelStep_funnelId_fkey" FOREIGN KEY ("funnelId") REFERENCES "SalesFunnel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesFunnelStepFollowUp" ADD CONSTRAINT "SalesFunnelStepFollowUp_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "SalesFunnelStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoryPlaybook" ADD CONSTRAINT "CategoryPlaybook_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoryPlaybook" ADD CONSTRAINT "CategoryPlaybook_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoryObjection" ADD CONSTRAINT "CategoryObjection_playbookId_fkey" FOREIGN KEY ("playbookId") REFERENCES "CategoryPlaybook"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductSpec" ADD CONSTRAINT "ProductSpec_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductSpec" ADD CONSTRAINT "ProductSpec_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductSpecField" ADD CONSTRAINT "ProductSpecField_specId_fkey" FOREIGN KEY ("specId") REFERENCES "ProductSpec"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductObjection" ADD CONSTRAINT "ProductObjection_specId_fkey" FOREIGN KEY ("specId") REFERENCES "ProductSpec"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationFunnelState" ADD CONSTRAINT "ConversationFunnelState_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationFunnelState" ADD CONSTRAINT "ConversationFunnelState_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationFunnelState" ADD CONSTRAINT "ConversationFunnelState_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "SalesFunnelStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;

