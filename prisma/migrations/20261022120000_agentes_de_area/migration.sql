-- Agentes de área (molde; empieza solo con Ventas): el resumen de cada día y el registro de los
-- WhatsApp internos que el agente pide. Ver src/features/agentes-de-area.
--
-- Aditiva: solo crea dos tablas nuevas; no altera ni borra nada de lo que ya existe.
-- NO SE HA CORRIDO EN PRODUCCION: ensayarla antes dentro de una transaccion que se deshace.
BEGIN;

CREATE TABLE IF NOT EXISTS "AgenteDeAreaDia" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "area" TEXT NOT NULL,
  "fecha" TEXT NOT NULL,
  "esPrueba" BOOLEAN NOT NULL DEFAULT true,
  "salioTarde" BOOLEAN NOT NULL DEFAULT false,
  "notaTarde" TEXT,
  "numeros" JSONB,
  "meta" JSONB,
  "subagentes" JSONB,
  "sugeridos" JSONB,
  "textoAlexander" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AgenteDeAreaDia_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AgenteDeAreaDia_workspaceId_fkey" FOREIGN KEY ("workspaceId")
    REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "AgenteDeAreaDia_workspaceId_area_fecha_key"
  ON "AgenteDeAreaDia"("workspaceId", "area", "fecha");
CREATE INDEX IF NOT EXISTS "AgenteDeAreaDia_workspaceId_area_fecha_idx"
  ON "AgenteDeAreaDia"("workspaceId", "area", "fecha");

CREATE TABLE IF NOT EXISTS "AgenteDeAreaEnvio" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "area" TEXT NOT NULL,
  "fecha" TEXT NOT NULL,
  "numero" TEXT NOT NULL,
  "tipo" TEXT NOT NULL,
  "nombre" TEXT,
  "texto" TEXT NOT NULL,
  "estado" TEXT NOT NULL,
  "motivo" TEXT,
  "claveDelDia" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AgenteDeAreaEnvio_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AgenteDeAreaEnvio_workspaceId_fkey" FOREIGN KEY ("workspaceId")
    REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "AgenteDeAreaEnvio_claveDelDia_key"
  ON "AgenteDeAreaEnvio"("claveDelDia");
CREATE INDEX IF NOT EXISTS "AgenteDeAreaEnvio_workspaceId_area_fecha_idx"
  ON "AgenteDeAreaEnvio"("workspaceId", "area", "fecha");

COMMIT;
