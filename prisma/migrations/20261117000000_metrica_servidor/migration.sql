-- Monitoreo del servidor (parte 1): tabla de "fotos" del servidor. Ver src/lib/metricas-servidor.ts.
-- Aditiva y se puede correr dos veces: solo crea la tabla y su índice si no existen. No toca otras tablas.
BEGIN;

CREATE TABLE IF NOT EXISTS "MetricaServidor" (
    "id" TEXT NOT NULL,
    "tomadaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cpuTotal" DOUBLE PRECISION NOT NULL,
    "load1" DOUBLE PRECISION NOT NULL,
    "nucleos" INTEGER,
    "memUsadaMb" INTEGER NOT NULL,
    "memTotalMb" INTEGER NOT NULL,
    "swapUsadoMb" INTEGER NOT NULL,
    "discoUsadoGb" DOUBLE PRECISION NOT NULL,
    "discoTotalGb" DOUBLE PRECISION NOT NULL,
    "contenedores" JSONB NOT NULL,

    CONSTRAINT "MetricaServidor_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "MetricaServidor_tomadaEn_idx" ON "MetricaServidor"("tomadaEn");

COMMIT;
