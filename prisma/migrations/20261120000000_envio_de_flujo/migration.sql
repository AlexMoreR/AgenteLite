-- Flujos que se envían completos (parte 1): tabla nueva con el estado de cada envío de flujo desde el chat.
-- Ver src/lib/flujos/envio-de-flujo.ts. Aditiva y se puede correr dos veces: solo crea la tabla, sus índices
-- y su llave a "Workspace" (declarada dentro del CREATE TABLE). Ninguna sentencia cambia otra tabla.
BEGIN;

CREATE TABLE IF NOT EXISTS "EnvioDeFlujo" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "flowId" TEXT NOT NULL,
    "agentId" TEXT,
    "userId" TEXT NOT NULL,
    "pasos" JSONB NOT NULL,
    "total" INTEGER NOT NULL,
    "enviados" INTEGER NOT NULL DEFAULT 0,
    "estado" TEXT NOT NULL DEFAULT 'EN_CURSO',
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EnvioDeFlujo_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "EnvioDeFlujo_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "EnvioDeFlujo_estado_idx" ON "EnvioDeFlujo"("estado");
CREATE INDEX IF NOT EXISTS "EnvioDeFlujo_conversationId_idx" ON "EnvioDeFlujo"("conversationId");

COMMIT;
