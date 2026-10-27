-- Embudo por paso: paso anterior, desde cuando esta en el paso actual y un historial corto de pasos.
-- Solo aditiva (columnas que aceptan null + un indice) y se puede correr dos veces.
BEGIN;
ALTER TABLE "EmbudoLead" ADD COLUMN IF NOT EXISTS "pasoAnterior" TEXT;
ALTER TABLE "EmbudoLead" ADD COLUMN IF NOT EXISTS "pasoDesde" TIMESTAMP(3);
ALTER TABLE "EmbudoLead" ADD COLUMN IF NOT EXISTS "pasoHistorial" JSONB;
CREATE INDEX IF NOT EXISTS "EmbudoLead_workspaceId_productoActual_pasoActual_idx"
  ON "EmbudoLead" ("workspaceId", "productoActual", "pasoActual");
COMMIT;
