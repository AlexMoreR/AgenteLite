-- Fijar un mensaje del chat (solo CRM, no viaja a WhatsApp). Ver src/lib/chats/mensaje-fijado.ts.
-- Aditiva y se puede correr dos veces: solo agrega una columna opcional en las dos tablas de chats.
BEGIN;

ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "mensajeFijadoId" TEXT;
ALTER TABLE "OfficialApiConversation" ADD COLUMN IF NOT EXISTS "mensajeFijadoId" TEXT;

COMMIT;
