-- Chats: segundo asesor de un chat (parte 1 de «Poder asignar dos asesores a un mismo chat»).
-- Ver src/lib/chats-asignacion-compartida.ts.
--
-- Aditiva y se puede correr dos veces: agrega la columna opcional "segundoAsesorId" a "Conversation",
-- su índice y su llave foránea a "User". No cambia ni borra ninguna fila ni columna; los chats que ya
-- existen quedan con "segundoAsesorId" vacío (un solo asesor, como hoy).
BEGIN;

ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "segundoAsesorId" TEXT;
CREATE INDEX IF NOT EXISTS "Conversation_workspaceId_segundoAsesorId_idx" ON "Conversation"("workspaceId", "segundoAsesorId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Conversation_segundoAsesorId_fkey') THEN
    ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_segundoAsesorId_fkey" FOREIGN KEY ("segundoAsesorId")
      REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

COMMIT;
