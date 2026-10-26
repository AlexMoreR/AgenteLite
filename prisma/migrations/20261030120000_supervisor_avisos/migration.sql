-- Supervisor: avisos por WhatsApp a las asesoras y reasignación automática de chats.
-- Una fila = un aviso o una reasignación; la regla única (chat, tipo, episodio) evita avisar dos veces.
-- Solo aditiva: una tabla nueva y sus índices. No toca ninguna tabla existente ni tiene claves foráneas.
-- Se puede correr dos veces.
BEGIN;

CREATE TABLE IF NOT EXISTS "SupervisorAviso" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "tipo" TEXT NOT NULL,
  "asesoraId" TEXT,
  "asesoraNuevaId" TEXT,
  "episodio" TEXT NOT NULL,
  "minutosEsperando" INTEGER NOT NULL DEFAULT 0,
  "whatsappEnviado" BOOLEAN NOT NULL DEFAULT false,
  "error" TEXT,
  "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupervisorAviso_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SupervisorAviso_conversationId_tipo_episodio_key"
  ON "SupervisorAviso"("conversationId", "tipo", "episodio");
CREATE INDEX IF NOT EXISTS "SupervisorAviso_workspaceId_creadoEn_idx"
  ON "SupervisorAviso"("workspaceId", "creadoEn");

COMMIT;
