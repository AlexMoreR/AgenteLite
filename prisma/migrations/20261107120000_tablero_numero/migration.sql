-- Código corto de la tarjeta (T-123). Solo aditiva y se puede correr dos veces.
BEGIN;
ALTER TABLE "TarjetaTablero" ADD COLUMN IF NOT EXISTS "numero" SERIAL;
CREATE UNIQUE INDEX IF NOT EXISTS "TarjetaTablero_numero_key" ON "TarjetaTablero"("numero");
COMMIT;
