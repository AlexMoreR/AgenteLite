-- Eventos de conversión para Meta: un aviso "Purchase" por cada venta de un chat de anuncio.
-- Solo aditiva (una tabla nueva) y se puede correr dos veces. Sin llaves foráneas, como VentaDePauta.
BEGIN;

CREATE TABLE IF NOT EXISTS "EventoDeConversion" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "ventaDePautaId" TEXT NOT NULL,
    "evento" TEXT NOT NULL,
    "modo" TEXT NOT NULL,
    "estado" TEXT NOT NULL,
    "valor" DOUBLE PRECISION,
    "intentos" INTEGER NOT NULL DEFAULT 0,
    "respuesta" TEXT,
    "enviadoEn" TIMESTAMP(3),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EventoDeConversion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "EventoDeConversion_workspaceId_ventaDePautaId_evento_modo_key" ON "EventoDeConversion"("workspaceId", "ventaDePautaId", "evento", "modo");
CREATE INDEX IF NOT EXISTS "EventoDeConversion_workspaceId_estado_idx" ON "EventoDeConversion"("workspaceId", "estado");

COMMIT;
