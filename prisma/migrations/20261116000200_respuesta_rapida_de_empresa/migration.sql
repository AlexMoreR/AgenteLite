-- Chats: respuestas rápidas DE LA EMPRESA (Alex, 10-nov-2026: «todas las que ya existen pasan a ser de EMPRESA,
-- visibles para todas. No borres ninguna»). Ver src/lib/respuestas-rapidas.ts.
--
-- Aditiva y se puede correr dos veces:
--   1. Agrega la columna "deEmpresa" (falso por defecto: lo que se cree después es de quien lo crea).
--   2. Marca como de la empresa TODAS las respuestas que existían al agregar la columna. Solo corre si la
--      columna recién se creó, así una segunda corrida no pisa lo que el dueño haya cambiado después.
-- No borra ninguna fila ni columna. La dueña que tenían ("duenaId") queda como estaba.
BEGIN;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'QuickReply' AND column_name = 'deEmpresa'
  ) THEN
    ALTER TABLE "QuickReply" ADD COLUMN "deEmpresa" BOOLEAN NOT NULL DEFAULT false;
    UPDATE "QuickReply" SET "deEmpresa" = true;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "QuickReply_workspaceId_deEmpresa_createdAt_idx" ON "QuickReply"("workspaceId", "deEmpresa", "createdAt");

COMMIT;
