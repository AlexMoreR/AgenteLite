-- Agente de Sistemas: contador de uso (pantallas y herramientas del MCP por día). Solo aditiva y se puede correr dos veces.
BEGIN;

CREATE TABLE IF NOT EXISTS "UsoDelSistemaDia" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "fecha" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "clave" TEXT NOT NULL,
    "quien" TEXT NOT NULL,
    "veces" INTEGER NOT NULL DEFAULT 1,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "UsoDelSistemaDia_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "UsoDelSistemaDia_workspaceId_fecha_tipo_clave_quien_key" ON "UsoDelSistemaDia"("workspaceId", "fecha", "tipo", "clave", "quien");
CREATE INDEX IF NOT EXISTS "UsoDelSistemaDia_workspaceId_fecha_idx" ON "UsoDelSistemaDia"("workspaceId", "fecha");
CREATE INDEX IF NOT EXISTS "UsoDelSistemaDia_workspaceId_tipo_clave_idx" ON "UsoDelSistemaDia"("workspaceId", "tipo", "clave");

COMMIT;
