-- Seguimiento inteligente (Embudo F2): temperatura con motivo, producto de interés, siguiente acción
-- por lead (tarea para la asesora / mensaje útil / no insistir / exterior), lead dormido por fecha
-- futura de compra y revisión programada. Solo columnas NUEVAS y opcionales en EmbudoLead: no toca
-- datos existentes. Todo el comportamiento nuevo está detrás de `seguimiento-inteligente:config:<ws>`
-- (apagado por defecto).
BEGIN;

ALTER TABLE "EmbudoLead" ADD COLUMN IF NOT EXISTS "productoInteres" TEXT;
ALTER TABLE "EmbudoLead" ADD COLUMN IF NOT EXISTS "temperaturaEn" TIMESTAMP(3);
ALTER TABLE "EmbudoLead" ADD COLUMN IF NOT EXISTS "accion" TEXT;
ALTER TABLE "EmbudoLead" ADD COLUMN IF NOT EXISTS "accionDatos" JSONB;
ALTER TABLE "EmbudoLead" ADD COLUMN IF NOT EXISTS "accionEn" TIMESTAMP(3);
ALTER TABLE "EmbudoLead" ADD COLUMN IF NOT EXISTS "tareaPrioridad" TEXT;
ALTER TABLE "EmbudoLead" ADD COLUMN IF NOT EXISTS "tareaVence" TIMESTAMP(3);
ALTER TABLE "EmbudoLead" ADD COLUMN IF NOT EXISTS "mensajesUtiles" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "EmbudoLead" ADD COLUMN IF NOT EXISTS "exterior" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "EmbudoLead" ADD COLUMN IF NOT EXISTS "revisarEn" TIMESTAMP(3);
ALTER TABLE "EmbudoLead" ADD COLUMN IF NOT EXISTS "dormidoHasta" TIMESTAMP(3);
ALTER TABLE "EmbudoLead" ADD COLUMN IF NOT EXISTS "fechaCompra" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "EmbudoLead_workspaceId_revisarEn_idx"
  ON "EmbudoLead"("workspaceId", "revisarEn");
CREATE INDEX IF NOT EXISTS "EmbudoLead_workspaceId_accion_tareaVence_idx"
  ON "EmbudoLead"("workspaceId", "accion", "tareaVence");

COMMIT;
