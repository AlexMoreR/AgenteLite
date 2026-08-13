-- Los "si no contesta" de una etapa pasan a tabla propia.
--
-- Nacieron como dos columnas en la etapa (followUpDays / followUpMessage), que solo permiten UN
-- aviso. Un unico aviso es un recordatorio; lo que recupera una venta es una secuencia: al dia, a
-- los dos, a los tres. Por eso van en su propia tabla.
--
-- Las columnas viejas se borran: nunca tuvieron un dato (se verifico que estaban todas en NULL) y
-- dejarlas seria una segunda fuente de verdad para lo mismo.
CREATE TABLE IF NOT EXISTS "ProductStageFollowUp" (
  "id"               TEXT NOT NULL,
  "stageId"          TEXT NOT NULL,
  "sortOrder"        INTEGER NOT NULL DEFAULT 0,
  "timeType"         "FollowTimeType" NOT NULL DEFAULT 'DAYS',
  "timeValue"        INTEGER NOT NULL,
  "messageType"      "FollowMessageType" NOT NULL DEFAULT 'TEXT',
  "content"          TEXT,
  "mediaUrl"         TEXT,
  "cancelOnActivity" BOOLEAN NOT NULL DEFAULT true,
  "isActive"         BOOLEAN NOT NULL DEFAULT true,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductStageFollowUp_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ProductStageFollowUp_stageId_sortOrder_idx"
  ON "ProductStageFollowUp" ("stageId", "sortOrder");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ProductStageFollowUp_stageId_fkey'
  ) THEN
    ALTER TABLE "ProductStageFollowUp"
      ADD CONSTRAINT "ProductStageFollowUp_stageId_fkey"
      FOREIGN KEY ("stageId") REFERENCES "ProductFunnelStage"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "ProductFunnelStage" DROP COLUMN IF EXISTS "followUpDays";
ALTER TABLE "ProductFunnelStage" DROP COLUMN IF EXISTS "followUpMessage";
