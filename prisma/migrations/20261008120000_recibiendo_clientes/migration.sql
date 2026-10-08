-- "Recibiendo clientes": quien esta en linea para el reparto y por cuanto tiempo.
--
-- Solo crea dos tablas nuevas: no toca ninguna existente. Sin claves foraneas a proposito: es un
-- estado liviano y un registro de horas, no tienen por que impedir borrar nada.
BEGIN;

CREATE TABLE IF NOT EXISTS "PresenciaEnLinea" (
  "workspaceId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "ultimoLatido" TIMESTAMP(3) NOT NULL,
  "enLineaDesde" TIMESTAMP(3),
  "pausaManualEn" TIMESTAMP(3),
  CONSTRAINT "PresenciaEnLinea_pkey" PRIMARY KEY ("workspaceId", "userId")
);

CREATE TABLE IF NOT EXISTS "PeriodoEnLinea" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "inicio" TIMESTAMP(3) NOT NULL,
  "fin" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PeriodoEnLinea_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PeriodoEnLinea_workspaceId_fin_idx"
  ON "PeriodoEnLinea"("workspaceId", "fin");

COMMIT;
