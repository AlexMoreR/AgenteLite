BEGIN;

-- Apagar el Supervisor accionable y el Supervisor general (pedido del dueño, 9-nov-2026, tarjeta ni2c62l1).
-- Ver src/features/supervisor/servicios/config.ts y src/features/supervisor-accionable/servicios/accionable.ts.
--
-- Solo APAGA: no se borra ninguna fila, ni configuración, ni historial. Para prenderlo de nuevo basta volver a
-- poner "activo": true en supervisor:accionable:<negocio> y "true" en supervisor:activo:<negocio>.
-- Se puede correr dos veces: la segunda no encuentra nada que cambiar.
--
-- 1. supervisor:accionable:<negocio> (JSON): "activo" pasa a false y se conserva todo lo demás (plazos,
--    supervisora, fuera de horario...). El patrón deja por fuera :estado:, :atendidas: y :tareas:. Una fila que
--    no es un objeto JSON válido se deja como está: el código ya la lee como apagada.
DO $$
DECLARE
  fila RECORD;
  valor JSONB;
BEGIN
  FOR fila IN
    SELECT "key", "value" FROM "AppSetting"
    WHERE "key" ~ '^supervisor:accionable:[^:]+$' AND btrim("value") LIKE '{%'
  LOOP
    BEGIN
      valor := fila."value"::jsonb;
    EXCEPTION WHEN others THEN
      valor := NULL;
    END;
    IF valor IS NOT NULL AND jsonb_typeof(valor) = 'object' AND (valor -> 'activo') IS DISTINCT FROM 'false'::jsonb THEN
      UPDATE "AppSetting"
      SET "value" = jsonb_set(valor, '{activo}', 'false'::jsonb)::text,
          "updatedAt" = timezone('UTC', now())
      WHERE "key" = fila."key";
    END IF;
  END LOOP;
END $$;

-- 2. supervisor:activo:<negocio>: de "true" a "false" (sin las revisiones de 5 minutos ni la de cada hora).
UPDATE "AppSetting"
SET "value" = 'false',
    "updatedAt" = timezone('UTC', now())
WHERE "key" ~ '^supervisor:activo:[^:]+$'
  AND lower(btrim("value")) = 'true';

-- 3. Alertas de atención del Supervisor abiertas de hoy (vistas desde las 00:00 del 9-nov en Colombia = 05:00 UTC):
--    quedan resueltas. Se guardan de historial.
UPDATE "SupervisorAlerta"
SET "estado" = 'RESUELTA',
    "claveAbierta" = NULL,
    "resueltaEn" = timezone('UTC', now()),
    "updatedAt" = timezone('UTC', now())
WHERE "familia" = 'ATENCION'
  AND "estado" = 'ABIERTA'
  AND "ultimaVezEn" >= TIMESTAMP '2026-11-09 05:00:00';

-- 4. Las mismas alertas en /cliente/alertas (clave sup:ATENCION:...): quedan resueltas.
UPDATE "AlertaInterna"
SET "estado" = 'RESUELTA',
    "resueltaEn" = timezone('UTC', now()),
    "vistaEn" = COALESCE("vistaEn", timezone('UTC', now()))
WHERE "clave" LIKE 'sup:ATENCION:%'
  AND "estado" IN ('NUEVA', 'VISTA')
  AND "ultimaVez" >= TIMESTAMP '2026-11-09 05:00:00';

COMMIT;
