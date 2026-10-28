-- Alertas que se repiten suben: "ultimaVez" es la hora de la última vez que llegó la alerta (creadoEn sigue siendo
-- la primera). Solo aditiva: columna nueva, las alertas de antes quedan con su creadoEn como última vez, y se puede
-- correr dos veces.
BEGIN;
ALTER TABLE "AlertaInterna" ADD COLUMN IF NOT EXISTS "ultimaVez" TIMESTAMP(3);
UPDATE "AlertaInterna" SET "ultimaVez" = "creadoEn" WHERE "ultimaVez" IS NULL;
ALTER TABLE "AlertaInterna" ALTER COLUMN "ultimaVez" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "AlertaInterna" ALTER COLUMN "ultimaVez" SET NOT NULL;
COMMIT;
