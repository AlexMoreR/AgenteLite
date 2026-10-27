-- Errores de envío del chat: una fila por cada texto que no salió (línea, hora, motivo), para medir.
-- Solo aditiva (tabla nueva + índices) y se puede correr dos veces.
BEGIN;
CREATE TABLE IF NOT EXISTS "ChatSendError" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "conversationId" TEXT,
  "lineaId" TEXT,
  "lineaNombre" TEXT,
  "gateway" TEXT,
  "motivo" TEXT NOT NULL,
  "detalle" TEXT,
  "clientMessageId" TEXT,
  "userId" TEXT,
  "intento" INTEGER NOT NULL DEFAULT 1,
  "origen" TEXT NOT NULL DEFAULT 'servidor',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChatSendError_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ChatSendError_workspaceId_createdAt_idx" ON "ChatSendError" ("workspaceId", "createdAt");
CREATE INDEX IF NOT EXISTS "ChatSendError_lineaId_createdAt_idx" ON "ChatSendError" ("lineaId", "createdAt");
COMMIT;
