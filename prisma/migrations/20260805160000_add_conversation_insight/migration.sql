-- Lo que paso en cada conversacion, leido por la IA: que pidio, donde quedo y por que se cayo.
--
-- Sin FK a Conversation a proposito: si un chat se borra, la lectura sigue sirviendo para contar
-- lo que ya paso. Y idempotente como las demas, por el drift de esta base.
CREATE TABLE IF NOT EXISTS "ConversationInsight" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "productId" TEXT,
    "requested" TEXT,
    "status" TEXT NOT NULL,
    "stage" TEXT,
    "lostReason" TEXT,
    "lastOutbound" TEXT,
    "summary" TEXT,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "model" TEXT,
    "analyzedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationInsight_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ConversationInsight_conversationId_key" ON "ConversationInsight"("conversationId");
CREATE INDEX IF NOT EXISTS "ConversationInsight_workspaceId_productId_status_idx" ON "ConversationInsight"("workspaceId", "productId", "status");
CREATE INDEX IF NOT EXISTS "ConversationInsight_workspaceId_lostReason_idx" ON "ConversationInsight"("workspaceId", "lostReason");
