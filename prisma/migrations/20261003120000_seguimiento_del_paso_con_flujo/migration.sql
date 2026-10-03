-- Un seguimiento del paso del embudo puede mandar un flujo en vez de un texto (03-10-2026).
-- Columna nueva y opcional: no toca datos.
ALTER TABLE "ProductStageFollowUp" ADD COLUMN IF NOT EXISTS "flowId" TEXT;
