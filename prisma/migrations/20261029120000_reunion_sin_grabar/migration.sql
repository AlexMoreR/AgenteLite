-- Reuniones: opción "Sin grabar" (sin grabación, transcripción ni acta).
-- Solo aditiva y se puede correr dos veces: las reuniones que ya existen quedan en "no" (se graban como siempre).
BEGIN;

ALTER TABLE "Reunion" ADD COLUMN IF NOT EXISTS "sinGrabar" BOOLEAN NOT NULL DEFAULT false;

COMMIT;
