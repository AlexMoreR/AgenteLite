ALTER TABLE "AgentKnowledgeProduct"
ADD COLUMN IF NOT EXISTS "funnelOpening" TEXT,
ADD COLUMN IF NOT EXISTS "funnelQualification" TEXT,
ADD COLUMN IF NOT EXISTS "funnelPresentation" TEXT,
ADD COLUMN IF NOT EXISTS "funnelFaq" TEXT,
ADD COLUMN IF NOT EXISTS "funnelClosing" TEXT;
