-- Supervisor (fase 1: leer, analizar, alertar y recomendar): un incidente por fila que se
-- actualiza en cada vuelta. Ver src/features/supervisor.
--
-- Solo crea una tabla nueva y sus indices: no toca ninguna tabla existente y no tiene claves
-- foraneas. NO SE HA CORRIDO EN PRODUCCION: requiere autorizacion de Alexander.
BEGIN;

CREATE TABLE IF NOT EXISTS "SupervisorAlerta" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "clave" TEXT NOT NULL,
  "claveAbierta" TEXT,
  "familia" TEXT NOT NULL,
  "severidad" TEXT NOT NULL,
  "estado" TEXT NOT NULL DEFAULT 'ABIERTA',
  "titulo" TEXT NOT NULL,
  "producto" TEXT,
  "desde" TIMESTAMP(3) NOT NULL,
  "primeraVezEn" TIMESTAMP(3) NOT NULL,
  "ultimaVezEn" TIMESTAMP(3) NOT NULL,
  "vecesVista" INTEGER NOT NULL DEFAULT 1,
  "hallazgos" JSONB NOT NULL,
  "texto" TEXT NOT NULL,
  "notificadaEn" TIMESTAMP(3),
  "severidadNotificada" TEXT,
  "resueltaEn" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SupervisorAlerta_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SupervisorAlerta_claveAbierta_key"
  ON "SupervisorAlerta"("claveAbierta");
CREATE INDEX IF NOT EXISTS "SupervisorAlerta_workspaceId_estado_ultimaVezEn_idx"
  ON "SupervisorAlerta"("workspaceId", "estado", "ultimaVezEn");
CREATE INDEX IF NOT EXISTS "SupervisorAlerta_workspaceId_createdAt_idx"
  ON "SupervisorAlerta"("workspaceId", "createdAt");

COMMIT;
