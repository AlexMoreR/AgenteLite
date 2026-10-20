-- Tableros inteligentes (fase 1): Claude arma ideas por el MCP y el dueño las aprueba en
-- /cliente/tableros-inteligentes. Ver src/features/tableros-inteligentes.
--
-- Aditiva: solo crea un enum y cuatro tablas nuevas; no altera ninguna tabla existente.
-- NO SE HA CORRIDO EN PRODUCCION: ensayarla antes dentro de una transaccion que se deshace.
BEGIN;

DO $$ BEGIN
  CREATE TYPE "EstadoTarjeta" AS ENUM ('IDEA', 'POR_APROBAR', 'APROBADO', 'EN_CURSO', 'HECHO', 'FALLIDO');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "TableroInteligente" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "nombre" TEXT NOT NULL,
  "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actualizadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TableroInteligente_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TableroInteligente_workspaceId_fkey" FOREIGN KEY ("workspaceId")
    REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "TableroInteligente_workspaceId_creadoEn_idx"
  ON "TableroInteligente"("workspaceId", "creadoEn");

CREATE TABLE IF NOT EXISTS "TarjetaTablero" (
  "id" TEXT NOT NULL,
  "tableroId" TEXT NOT NULL,
  "titulo" TEXT NOT NULL,
  "detalle" TEXT NOT NULL DEFAULT '',
  "area" TEXT,
  "estado" "EstadoTarjeta" NOT NULL DEFAULT 'IDEA',
  "orden" INTEGER NOT NULL DEFAULT 0,
  "fecha" TIMESTAMP(3),
  "creadoPor" TEXT NOT NULL,
  "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actualizadoEn" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TarjetaTablero_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TarjetaTablero_tableroId_fkey" FOREIGN KEY ("tableroId")
    REFERENCES "TableroInteligente"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "TarjetaTablero_tableroId_estado_idx"
  ON "TarjetaTablero"("tableroId", "estado");

CREATE TABLE IF NOT EXISTS "ConexionTarjeta" (
  "id" TEXT NOT NULL,
  "tableroId" TEXT NOT NULL,
  "origenId" TEXT NOT NULL,
  "destinoId" TEXT NOT NULL,
  "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConexionTarjeta_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ConexionTarjeta_distintas_check" CHECK ("origenId" <> "destinoId"),
  CONSTRAINT "ConexionTarjeta_tableroId_fkey" FOREIGN KEY ("tableroId")
    REFERENCES "TableroInteligente"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ConexionTarjeta_origenId_fkey" FOREIGN KEY ("origenId")
    REFERENCES "TarjetaTablero"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ConexionTarjeta_destinoId_fkey" FOREIGN KEY ("destinoId")
    REFERENCES "TarjetaTablero"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "ConexionTarjeta_origenId_destinoId_key"
  ON "ConexionTarjeta"("origenId", "destinoId");
CREATE INDEX IF NOT EXISTS "ConexionTarjeta_tableroId_idx" ON "ConexionTarjeta"("tableroId");
CREATE INDEX IF NOT EXISTS "ConexionTarjeta_destinoId_idx" ON "ConexionTarjeta"("destinoId");

CREATE TABLE IF NOT EXISTS "HistorialTarjeta" (
  "id" TEXT NOT NULL,
  "tarjetaId" TEXT NOT NULL,
  "quien" TEXT NOT NULL,
  "origen" TEXT NOT NULL,
  "accion" TEXT NOT NULL,
  "antes" JSONB,
  "despues" JSONB,
  "deshechoEn" TIMESTAMP(3),
  "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HistorialTarjeta_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "HistorialTarjeta_tarjetaId_fkey" FOREIGN KEY ("tarjetaId")
    REFERENCES "TarjetaTablero"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "HistorialTarjeta_tarjetaId_creadoEn_idx"
  ON "HistorialTarjeta"("tarjetaId", "creadoEn");

COMMIT;
