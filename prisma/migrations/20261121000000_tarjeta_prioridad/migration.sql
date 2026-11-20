-- Tablero IA: prioridad de la tarjeta (URGENTE | ALTA | MEDIA | BAJA). Aditiva: una columna de texto con valor por defecto.
-- Ver PRIORIDADES en src/features/tableros-inteligentes/services/reglas-trabajador.ts.
--
-- No crea tipos nuevos en la base, no borra ni cambia nada de lo que ya existe. Las tarjetas que ya existen quedan en MEDIA
-- por el valor por defecto (sin UPDATE). No lleva índice: la fila del trabajador tiene como máximo 50 tarjetas.
-- NO SE HA CORRIDO EN PRODUCCION: ensayarla antes dentro de una transaccion que se deshace.
-- Probada con PGlite sobre todas las migraciones y con datos previos: npm run test:tablero-prioridad-migracion
BEGIN;

ALTER TABLE "TarjetaTablero" ADD COLUMN IF NOT EXISTS "prioridad" TEXT NOT NULL DEFAULT 'MEDIA';

COMMIT;
