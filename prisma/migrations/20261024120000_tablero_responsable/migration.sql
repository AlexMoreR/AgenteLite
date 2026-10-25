-- Tablero IA: responsable de la tarjeta (a quién se le asignó). Ver src/features/tableros-inteligentes/services/tableros.ts.
--
-- Aditiva: agrega una columna opcional "responsableId" a "TarjetaTablero", la enlaza con "User" y le crea un índice.
-- No borra, no renombra y no cambia nada de lo que ya existe: las tarjetas que hay hoy quedan sin responsable.
-- Si se borra el usuario, la tarjeta queda sin responsable (ON DELETE SET NULL). Se puede correr dos veces sin daño.
-- NO SE HA CORRIDO EN PRODUCCION: ensayarla antes dentro de una transaccion que se deshace.
-- Probada con PGlite sobre todas las migraciones y con datos previos: npm run test:tablero-responsable-migracion
BEGIN;

ALTER TABLE "TarjetaTablero" ADD COLUMN IF NOT EXISTS "responsableId" TEXT;

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TarjetaTablero_responsableId_fkey') THEN
  ALTER TABLE "TarjetaTablero" ADD CONSTRAINT "TarjetaTablero_responsableId_fkey" FOREIGN KEY ("responsableId")
  REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE; END IF; END $$;

CREATE INDEX IF NOT EXISTS "TarjetaTablero_responsableId_idx" ON "TarjetaTablero"("responsableId");

COMMIT;
