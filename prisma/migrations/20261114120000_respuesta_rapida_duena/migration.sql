-- Chats: cada respuesta rápida tiene dueña (tarjeta «Respuestas rápidas por asesora: cada una ve solo las suyas»).
-- Ver src/lib/respuestas-rapidas.ts.
--
-- Aditiva y se puede correr dos veces: agrega la columna opcional "duenaId" a "QuickReply", su índice y su
-- llave foránea a "User". No cambia ni borra ninguna fila ni columna; las respuestas que ya existen quedan con
-- "duenaId" vacío ("Sin repartir": solo las ven el dueño y los administradores, que las reparten).
BEGIN;

ALTER TABLE "QuickReply" ADD COLUMN IF NOT EXISTS "duenaId" TEXT;
CREATE INDEX IF NOT EXISTS "QuickReply_workspaceId_duenaId_createdAt_idx" ON "QuickReply"("workspaceId", "duenaId", "createdAt");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'QuickReply_duenaId_fkey') THEN
    ALTER TABLE "QuickReply" ADD CONSTRAINT "QuickReply_duenaId_fkey" FOREIGN KEY ("duenaId")
      REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

COMMIT;
