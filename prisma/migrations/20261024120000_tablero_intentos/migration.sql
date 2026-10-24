-- Tablero IA: cuando algo falla, el Coordinador diagnostica, repara, parte la tarjeta o espera, y deja el
-- historial de intentos a la vista. Ver src/features/tableros-inteligentes/services/reglas-trabajador.ts.
--
-- Aditiva: crea la tabla "IntentoTarjeta" (cada falla, espera, partida o escalada de una tarjeta), agrega
-- "esDependencia" a "ConexionTarjeta" (la flecha que dice "el destino no se toma hasta que el origen
-- esté HECHO") y "reparaciones" a "TarjetaTablero" (cuántas reparaciones seguidas lleva).
-- No borra, no renombra ni cambia nada de lo que ya existe: las flechas de antes quedan sin dependencia
-- y las tarjetas de antes en 0 reparaciones.
-- NO SE HA CORRIDO EN PRODUCCION: ensayarla antes dentro de una transaccion que se deshace.
-- Probada con PGlite sobre todas las migraciones y con datos previos: npm run test:tablero-intentos-migracion
BEGIN;

CREATE TABLE IF NOT EXISTS "IntentoTarjeta" (
  "id" TEXT NOT NULL,
  "tarjetaId" TEXT NOT NULL,
  "numero" INTEGER NOT NULL,
  "etapa" TEXT NOT NULL,
  "categoria" TEXT NOT NULL,
  "causa" TEXT NOT NULL,
  "error" TEXT,
  "accion" TEXT NOT NULL,
  "cuentaComoIntento" BOOLEAN NOT NULL DEFAULT true,
  "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "IntentoTarjeta_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "IntentoTarjeta_tarjetaId_fkey" FOREIGN KEY ("tarjetaId")
    REFERENCES "TarjetaTablero"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "IntentoTarjeta_tarjetaId_creadoEn_idx" ON "IntentoTarjeta"("tarjetaId", "creadoEn");

ALTER TABLE "ConexionTarjeta" ADD COLUMN IF NOT EXISTS "esDependencia" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "TarjetaTablero" ADD COLUMN IF NOT EXISTS "reparaciones" INTEGER NOT NULL DEFAULT 0;

COMMIT;
