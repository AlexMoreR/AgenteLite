-- Origen de pauta: de qué campaña/anuncio de Meta llegó cada cliente y de cuál vino cada venta.
-- Solo aditiva (dos tablas nuevas) y se puede correr dos veces. Sin llaves foráneas, como EmbudoLead.
BEGIN;

CREATE TABLE IF NOT EXISTS "OrigenDePauta" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "conversationId" TEXT,
    "anuncioId" TEXT NOT NULL,
    "anuncioNombre" TEXT,
    "conjuntoId" TEXT,
    "conjuntoNombre" TEXT,
    "campanaId" TEXT,
    "campanaNombre" TEXT,
    "red" TEXT,
    "ctwaClid" TEXT,
    "llegoEn" TIMESTAMP(3) NOT NULL,
    "campanaConsultadaEn" TIMESTAMP(3),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrigenDePauta_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "VentaDePauta" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "ventaGestionId" TEXT NOT NULL,
    "cotizacion" TEXT,
    "telefono" TEXT,
    "monto" DOUBLE PRECISION,
    "pagadaEn" TIMESTAMP(3) NOT NULL,
    "contactId" TEXT,
    "origenDePautaId" TEXT,
    "categoria" TEXT NOT NULL DEFAULT 'ORGANICO_OTRO',
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VentaDePauta_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "OrigenDePauta_workspaceId_contactId_key" ON "OrigenDePauta"("workspaceId", "contactId");
CREATE INDEX IF NOT EXISTS "OrigenDePauta_workspaceId_llegoEn_idx" ON "OrigenDePauta"("workspaceId", "llegoEn");
CREATE INDEX IF NOT EXISTS "OrigenDePauta_workspaceId_anuncioId_idx" ON "OrigenDePauta"("workspaceId", "anuncioId");
CREATE UNIQUE INDEX IF NOT EXISTS "VentaDePauta_workspaceId_ventaGestionId_key" ON "VentaDePauta"("workspaceId", "ventaGestionId");
CREATE INDEX IF NOT EXISTS "VentaDePauta_workspaceId_pagadaEn_idx" ON "VentaDePauta"("workspaceId", "pagadaEn");

COMMIT;
