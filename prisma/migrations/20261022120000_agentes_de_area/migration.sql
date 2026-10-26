-- Agentes de área (Ventas): resumen del día y registro de WhatsApp internos. Solo aditiva y se puede correr dos veces.
BEGIN;

CREATE TABLE IF NOT EXISTS "AgenteDeAreaDia" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "area" TEXT NOT NULL,
    "fecha" TEXT NOT NULL,
    "esPrueba" BOOLEAN NOT NULL DEFAULT false,
    "salioTarde" BOOLEAN NOT NULL DEFAULT false,
    "notaDeRetraso" TEXT,
    "numeros" JSONB,
    "meta" JSONB,
    "subagentes" JSONB,
    "sugeridos" JSONB,
    "mensajes" JSONB,
    "resumen" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AgenteDeAreaDia_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AgenteDeAreaDia_workspaceId_area_fecha_key" ON "AgenteDeAreaDia"("workspaceId", "area", "fecha");
CREATE INDEX IF NOT EXISTS "AgenteDeAreaDia_workspaceId_area_fecha_idx" ON "AgenteDeAreaDia"("workspaceId", "area", "fecha");

CREATE TABLE IF NOT EXISTS "AgenteDeAreaEnvio" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "area" TEXT NOT NULL,
    "fecha" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "destinatario" TEXT,
    "texto" TEXT NOT NULL,
    "estado" TEXT NOT NULL,
    "motivo" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgenteDeAreaEnvio_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AgenteDeAreaEnvio_workspaceId_area_fecha_idx" ON "AgenteDeAreaEnvio"("workspaceId", "area", "fecha");

-- Un solo envío vivo por número, área y día: es lo que garantiza "una sola vez". Los bloqueados y los
-- fallidos no cuentan, así un fallo se puede reintentar sin duplicar.
CREATE UNIQUE INDEX IF NOT EXISTS "AgenteDeAreaEnvio_uno_por_dia_key"
    ON "AgenteDeAreaEnvio"("workspaceId", "area", "fecha", "numero")
    WHERE "estado" IN ('PENDIENTE', 'ENVIADO');

COMMIT;
