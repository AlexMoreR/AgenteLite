-- Registro de errores al enviar texto desde Chats (línea, hora, motivo) para medir. Solo aditiva: tabla e índices nuevos,
-- no toca ninguna tabla que ya exista, y se puede correr dos veces.
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

CREATE INDEX IF NOT EXISTS "ChatSendError_workspaceId_createdAt_idx" ON "ChatSendError"("workspaceId", "createdAt");
CREATE INDEX IF NOT EXISTS "ChatSendError_lineaId_createdAt_idx" ON "ChatSendError"("lineaId", "createdAt");

COMMIT;
