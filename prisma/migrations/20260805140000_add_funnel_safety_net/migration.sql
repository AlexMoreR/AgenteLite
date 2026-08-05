-- Red de seguridad del embudo: avisar a un asesor cuando un lead se queda trabado en una etapa.
--
-- Es el limite que NO depende de lo que decida la IA. El contador vive en la conversacion y no
-- dentro de commercialContext porque el motor reescribe ese JSON en cada turno y se perderia.
--
-- Idempotente (IF NOT EXISTS) como las anteriores: esta base tiene cambios aplicados con
-- `db push` que no figuran en el historial.
ALTER TABLE "ProductFunnelStage" ADD COLUMN IF NOT EXISTS "stuckAfterMessages" INTEGER;

ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "funnelStage" TEXT;
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "funnelStageCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "funnelNotifiedAt" TIMESTAMP(3);
