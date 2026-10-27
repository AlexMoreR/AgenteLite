-- Supervisor de reasignación: registro de cada aviso y reasignación de chats.
-- Solo aditiva (una tabla nueva) y se puede correr dos veces.
BEGIN;

CREATE TABLE IF NOT EXISTS "SupervisorAviso" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "tipo" TEXT NOT NULL,
  "asesoraId" TEXT,
  "asesoraNuevaId" TEXT,
  "episodio" TIMESTAMP(3) NOT NULL,
  "minutosEsperando" INTEGER,
  "whatsappEnviado" BOOLEAN NOT NULL DEFAULT false,
  "error" TEXT,
  "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupervisorAviso_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SupervisorAviso_conversationId_tipo_episodio_key" ON "SupervisorAviso"("conversationId", "tipo", "episodio");
CREATE INDEX IF NOT EXISTS "SupervisorAviso_workspaceId_creadoEn_idx" ON "SupervisorAviso"("workspaceId", "creadoEn");

COMMIT;
