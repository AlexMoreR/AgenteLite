-- Interruptor "Seguimientos automáticos" por conversación: la asesora los apaga con un clic para un cliente.
-- Solo aditiva: tres columnas nuevas con valor por defecto (todos los chats quedan "encendidos", como hoy) y se
-- puede correr dos veces.
BEGIN;
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "seguimientosApagados" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "seguimientosApagadosAt" TIMESTAMP(3);
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "seguimientosApagadosPor" TEXT;
COMMIT;
