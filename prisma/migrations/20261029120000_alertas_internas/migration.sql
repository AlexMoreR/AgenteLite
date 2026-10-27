-- Alertas internas: la página /cliente/alertas guarda TODA alerta con su prioridad (URGENTE, ALTA, MEDIA, BAJA), el sistema
-- que la generó y su estado (NUEVA, VISTA, RESUELTA). Por WhatsApp solo salen las urgentes.
-- Solo aditiva (una tabla nueva y sus índices) y se puede correr dos veces.
BEGIN;

CREATE TABLE IF NOT EXISTS "AlertaInterna" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "clave" TEXT NOT NULL,
    "prioridad" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "detalle" TEXT,
    "origen" TEXT NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'NUEVA',
    "salioPorWhatsApp" BOOLEAN NOT NULL DEFAULT false,
    "veces" INTEGER NOT NULL DEFAULT 1,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vistaEn" TIMESTAMP(3),
    "resueltaEn" TIMESTAMP(3),

    CONSTRAINT "AlertaInterna_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AlertaInterna_workspaceId_estado_prioridad_idx" ON "AlertaInterna"("workspaceId", "estado", "prioridad");
CREATE INDEX IF NOT EXISTS "AlertaInterna_workspaceId_clave_idx" ON "AlertaInterna"("workspaceId", "clave");

COMMIT;
