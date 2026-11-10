-- Red de seguridad para los mensajes que WAHA no pudo descifrar. Solo agrega una tabla nueva: no toca
-- ninguna existente y por eso tampoco lleva llaves foráneas.
BEGIN;

CREATE TABLE IF NOT EXISTS "MensajeIndescifrable" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "idCrudo" TEXT NOT NULL,
    "lid" TEXT NOT NULL DEFAULT '',
    "ocurridoEn" TIMESTAMP(3) NOT NULL,
    "revisarEn" TIMESTAMP(3) NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'PENDIENTE',
    "intentos" INTEGER NOT NULL DEFAULT 0,
    "reclamadoEn" TIMESTAMP(3),
    "resueltoEn" TIMESTAMP(3),
    "telefono" TEXT,
    "conversationId" TEXT,
    "resumen" TEXT,
    "avisadoEn" TIMESTAMP(3),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MensajeIndescifrable_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "MensajeIndescifrable_channelId_idCrudo_key" ON "MensajeIndescifrable"("channelId", "idCrudo");
CREATE INDEX IF NOT EXISTS "MensajeIndescifrable_estado_revisarEn_idx" ON "MensajeIndescifrable"("estado", "revisarEn");
CREATE INDEX IF NOT EXISTS "MensajeIndescifrable_estado_avisadoEn_idx" ON "MensajeIndescifrable"("estado", "avisadoEn");
CREATE INDEX IF NOT EXISTS "MensajeIndescifrable_workspaceId_creadoEn_idx" ON "MensajeIndescifrable"("workspaceId", "creadoEn");

COMMIT;
