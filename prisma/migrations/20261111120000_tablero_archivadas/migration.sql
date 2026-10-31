-- Tarjetas archivadas (30-oct-2026). Solo aditiva: agrega dos columnas que pueden quedar vacías y un índice.
BEGIN;
ALTER TABLE "TarjetaTablero" ADD COLUMN IF NOT EXISTS "archivadaEn" TIMESTAMP(3);
ALTER TABLE "TarjetaTablero" ADD COLUMN IF NOT EXISTS "terminadaEn" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "TarjetaTablero_tableroId_archivadaEn_idx" ON "TarjetaTablero"("tableroId", "archivadaEn");
COMMIT;
