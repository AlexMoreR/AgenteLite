-- Tablero IA: los tableros son POR CUENTA. Cada tablero tiene un dueño (duenoUserId): esa persona lo ve
-- y lo renombra; el dueño del negocio y el ADMIN de la plataforma ven todos. Ver
-- src/features/tableros-inteligentes/services/tableros.ts (Alcance).
--
-- Aditiva: agrega una columna nula a "TableroInteligente" con su FK a "User" (ON DELETE SET NULL) y un
-- índice. No borra, no renombra ni reescribe nada más.
-- Relleno en la misma transacción: los tableros que ya existen quedan del dueño del negocio
-- (Workspace.ownerId). Si el negocio no tiene ownerId, el tablero queda sin dueño (lo ven solo el dueño
-- del negocio y el ADMIN).
-- NO SE HA CORRIDO EN PRODUCCION: ensayarla antes dentro de una transaccion que se deshace.
-- Probada con PGlite sobre todas las migraciones y con datos previos: npm run test:tableros-por-cuenta-migracion
BEGIN;

ALTER TABLE "TableroInteligente" ADD COLUMN IF NOT EXISTS "duenoUserId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TableroInteligente_duenoUserId_fkey') THEN
    ALTER TABLE "TableroInteligente"
      ADD CONSTRAINT "TableroInteligente_duenoUserId_fkey" FOREIGN KEY ("duenoUserId")
      REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "TableroInteligente_workspaceId_duenoUserId_idx"
  ON "TableroInteligente"("workspaceId", "duenoUserId");

UPDATE "TableroInteligente" AS t
SET "duenoUserId" = w."ownerId"
FROM "Workspace" AS w
WHERE t."workspaceId" = w."id"
  AND t."duenoUserId" IS NULL
  AND w."ownerId" IS NOT NULL;

COMMIT;
