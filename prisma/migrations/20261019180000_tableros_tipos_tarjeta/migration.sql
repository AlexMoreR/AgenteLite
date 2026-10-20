-- Tablero IA: tipos de tarjeta configurables por tablero (Área, Idea, Tarea...), tarjeta madre
-- (padreId), link de la tarjeta y borrado suave (borradoEn). Ver src/features/tableros-inteligentes.
--
-- Aditiva: crea dos tablas y agrega columnas a "TarjetaTablero". No borra ni renombra nada.
-- Backfill en la misma transacción: cada tablero existente recibe sus 3 tipos (Área, Idea, Tarea),
-- con Área <- Área, Idea <- Área y Tarea <- Idea como madres permitidas, y todas sus tarjetas quedan como Tarea
-- (que es la que pide aprobación, igual que hasta hoy). Después "tipoId" queda NOT NULL.
-- NO SE HA CORRIDO EN PRODUCCION: ensayarla antes dentro de una transaccion que se deshace.
-- Probada con PGlite sobre todas las migraciones: npm run test:tablero-tipos-migracion
BEGIN;

CREATE TABLE IF NOT EXISTS "TipoTarjeta" (
  "id" TEXT NOT NULL,
  "tableroId" TEXT NOT NULL,
  "nombre" TEXT NOT NULL,
  "color" TEXT NOT NULL DEFAULT '#71717a',
  "icono" TEXT,
  "requiereAprobacion" BOOLEAN NOT NULL DEFAULT false,
  "usaEstados" BOOLEAN NOT NULL DEFAULT true,
  "orden" INTEGER NOT NULL DEFAULT 0,
  "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actualizadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TipoTarjeta_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TipoTarjeta_tableroId_fkey" FOREIGN KEY ("tableroId")
    REFERENCES "TableroInteligente"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
-- Por si la tabla ya existía sin la columna (re-ejecución parcial).
ALTER TABLE "TipoTarjeta" ADD COLUMN IF NOT EXISTS "usaEstados" BOOLEAN NOT NULL DEFAULT true;
CREATE UNIQUE INDEX IF NOT EXISTS "TipoTarjeta_tableroId_nombre_key" ON "TipoTarjeta"("tableroId", "nombre");
CREATE INDEX IF NOT EXISTS "TipoTarjeta_tableroId_orden_idx" ON "TipoTarjeta"("tableroId", "orden");

-- Qué tipos pueden ser madre de cuál: (tipoId = la hija, tipoPadreId = la madre permitida).
-- Un tipo puede ser madre de sí mismo (un Área dentro de otra Área: "Magilus > Ventas"); los ciclos
-- entre TARJETAS los impide el código.
CREATE TABLE IF NOT EXISTS "TipoTarjetaPadre" (
  "tipoId" TEXT NOT NULL,
  "tipoPadreId" TEXT NOT NULL,
  CONSTRAINT "TipoTarjetaPadre_pkey" PRIMARY KEY ("tipoId", "tipoPadreId"),
  CONSTRAINT "TipoTarjetaPadre_tipoId_fkey" FOREIGN KEY ("tipoId")
    REFERENCES "TipoTarjeta"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TipoTarjetaPadre_tipoPadreId_fkey" FOREIGN KEY ("tipoPadreId")
    REFERENCES "TipoTarjeta"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "TipoTarjetaPadre_tipoPadreId_idx" ON "TipoTarjetaPadre"("tipoPadreId");

ALTER TABLE "TarjetaTablero" ADD COLUMN IF NOT EXISTS "tipoId" TEXT;
ALTER TABLE "TarjetaTablero" ADD COLUMN IF NOT EXISTS "padreId" TEXT;
ALTER TABLE "TarjetaTablero" ADD COLUMN IF NOT EXISTS "link" TEXT;
ALTER TABLE "TarjetaTablero" ADD COLUMN IF NOT EXISTS "linkTexto" TEXT;
ALTER TABLE "TarjetaTablero" ADD COLUMN IF NOT EXISTS "borradoEn" TIMESTAMP(3);

DO $$ BEGIN
  ALTER TABLE "TarjetaTablero" ADD CONSTRAINT "TarjetaTablero_tipoId_fkey" FOREIGN KEY ("tipoId")
    REFERENCES "TipoTarjeta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "TarjetaTablero" ADD CONSTRAINT "TarjetaTablero_padreId_fkey" FOREIGN KEY ("padreId")
    REFERENCES "TarjetaTablero"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "TarjetaTablero_tipoId_idx" ON "TarjetaTablero"("tipoId");
CREATE INDEX IF NOT EXISTS "TarjetaTablero_padreId_idx" ON "TarjetaTablero"("padreId");

-- Backfill: los 3 tipos de siempre en cada tablero que ya existe (si ya los tiene, no se repiten).
-- Área es una carpeta: no pide aprobación ni tiene estado (usaEstados = false).
INSERT INTO "TipoTarjeta" ("id", "tableroId", "nombre", "color", "icono", "requiereAprobacion", "usaEstados", "orden")
SELECT 'tt_' || md5(random()::text || clock_timestamp()::text || t."id" || d."nombre"),
       t."id", d."nombre", d."color", d."icono", d."requiereAprobacion", d."usaEstados", d."orden"
FROM "TableroInteligente" t
CROSS JOIN (VALUES
  ('Área', '#6366f1', 'capas', false, false, 0),
  ('Idea', '#eab308', 'bombillo', false, true, 1),
  ('Tarea', '#0ea5e9', 'chulo', true, true, 2)
) AS d("nombre", "color", "icono", "requiereAprobacion", "usaEstados", "orden")
ON CONFLICT ("tableroId", "nombre") DO NOTHING;

-- Madres permitidas: un Área cuelga de otra Área; una Idea, de un Área; una Tarea, de una Idea.
INSERT INTO "TipoTarjetaPadre" ("tipoId", "tipoPadreId")
SELECT hija."id", madre."id"
FROM "TipoTarjeta" hija
JOIN "TipoTarjeta" madre ON madre."tableroId" = hija."tableroId"
WHERE (hija."nombre" = 'Área' AND madre."nombre" = 'Área')
   OR (hija."nombre" = 'Idea' AND madre."nombre" = 'Área')
   OR (hija."nombre" = 'Tarea' AND madre."nombre" = 'Idea')
ON CONFLICT DO NOTHING;

-- Todas las tarjetas que ya existen quedan como Tarea (la que pide aprobación: no cambia nada de
-- lo que el dueño ya aprobó o tiene por aprobar).
UPDATE "TarjetaTablero" tarjeta
SET "tipoId" = tipo."id"
FROM "TipoTarjeta" tipo
WHERE tipo."tableroId" = tarjeta."tableroId"
  AND tipo."nombre" = 'Tarea'
  AND tarjeta."tipoId" IS NULL;

ALTER TABLE "TarjetaTablero" ALTER COLUMN "tipoId" SET NOT NULL;

COMMIT;
