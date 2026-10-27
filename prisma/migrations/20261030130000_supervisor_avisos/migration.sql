-- Supervisor: avisos por WhatsApp a las asesoras y reasignación automática de chats. Una fila por
-- aviso o reasignación (quién, cuándo, qué chat). Ver src/features/supervisor-reasignacion.
--
-- Solo crea una tabla nueva y sus indices: no toca ninguna tabla existente y no tiene claves
-- foraneas. La regla unica (chat, tipo, episodio) es la que impide avisar dos veces lo mismo.
-- NO SE HA CORRIDO EN PRODUCCION: requiere autorizacion de Alexander.
BEGIN;

CREATE TABLE IF NOT EXISTS "SupervisorAviso" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "tipo" TEXT NOT NULL,
  "asesoraId" TEXT NOT NULL,
  "asesoraNuevaId" TEXT,
  "episodio" TIMESTAMP(3) NOT NULL,
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
