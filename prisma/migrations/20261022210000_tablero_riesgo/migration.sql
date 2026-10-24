-- Tablero IA: riesgo BAJO o ALTO en las tarjetas con repo (aprobación automática de tareas sencillas).
-- Ver src/features/tableros-inteligentes/services/reglas-riesgo.ts.
--
-- Aditiva: agrega tres columnas de texto opcionales a "TarjetaTablero" (riesgo, riesgoMotivo y riesgoPor).
-- No crea tipos nuevos en la base, no borra ni cambia nada de lo que ya existe. Las tarjetas que ya
-- existen quedan sin riesgo, y una tarjeta sin riesgo cuenta como ALTO (pide aprobación como siempre).
-- El interruptor de la aprobación automática y el día del último resumen van en "AppSetting" (sin migración).
-- NO SE HA CORRIDO EN PRODUCCION: ensayarla antes dentro de una transaccion que se deshace.
-- Probada con PGlite sobre todas las migraciones y con datos previos: npm run test:tablero-riesgo-migracion
BEGIN;

ALTER TABLE "TarjetaTablero" ADD COLUMN IF NOT EXISTS "riesgo" TEXT;
ALTER TABLE "TarjetaTablero" ADD COLUMN IF NOT EXISTS "riesgoMotivo" TEXT;
ALTER TABLE "TarjetaTablero" ADD COLUMN IF NOT EXISTS "riesgoPor" TEXT;

COMMIT;
