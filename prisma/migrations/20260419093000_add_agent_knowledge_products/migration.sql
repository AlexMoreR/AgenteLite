CREATE TABLE "AgentKnowledgeProduct" (
  "agentId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AgentKnowledgeProduct_pkey" PRIMARY KEY ("agentId","productId")
);

CREATE INDEX "AgentKnowledgeProduct_productId_idx" ON "AgentKnowledgeProduct"("productId");

ALTER TABLE "AgentKnowledgeProduct"
ADD CONSTRAINT "AgentKnowledgeProduct_agentId_fkey"
FOREIGN KEY ("agentId") REFERENCES "Agent"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

ALTER TABLE "AgentKnowledgeProduct"
ADD CONSTRAINT "AgentKnowledgeProduct_productId_fkey"
FOREIGN KEY ("productId") REFERENCES "Product"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;
