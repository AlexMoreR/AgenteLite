-- Avisos por WhatsApp al equipo del Tablero IA: marca "urgente" en la tarjeta y una fila por aviso (tarjeta + motivo).
-- Solo aditiva (columna y tabla nuevas, sin llave foránea) y se puede correr dos veces.
BEGIN;
ALTER TABLE "TarjetaTablero" ADD COLUMN IF NOT EXISTS "urgente" BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS "AvisoTarjetaEquipo" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "tarjetaId" TEXT NOT NULL,
  "motivo" TEXT NOT NULL,
  "userId" TEXT,
  "numero" TEXT,
  "estado" TEXT NOT NULL DEFAULT 'PENDIENTE',
  "intentos" INTEGER NOT NULL DEFAULT 0,
  "detalle" TEXT,
  "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "enviadoEn" TIMESTAMP(3),
  CONSTRAINT "AvisoTarjetaEquipo_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "AvisoTarjetaEquipo_tarjetaId_motivo_key" ON "AvisoTarjetaEquipo" ("tarjetaId", "motivo");
CREATE INDEX IF NOT EXISTS "AvisoTarjetaEquipo_workspaceId_estado_idx" ON "AvisoTarjetaEquipo" ("workspaceId", "estado");
COMMIT;
