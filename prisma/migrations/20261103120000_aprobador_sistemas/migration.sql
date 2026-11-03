-- Aprobador de Sistemas (3-nov-2026): la regla de "alcance" de AprobadorTablero acepta también 'SISTEMAS' (Emanuel,
-- periodo de prueba). Solo amplía la lista: 'TODO' y 'DESARROLLO' siguen valiendo y ninguna fila cambia.
BEGIN;
ALTER TABLE "AprobadorTablero" DROP CONSTRAINT IF EXISTS "AprobadorTablero_alcance_check";
ALTER TABLE "AprobadorTablero" ADD CONSTRAINT "AprobadorTablero_alcance_check" CHECK ("alcance" IN ('TODO', 'DESARROLLO', 'SISTEMAS'));
COMMIT;
