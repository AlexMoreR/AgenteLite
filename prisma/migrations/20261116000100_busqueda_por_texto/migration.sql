-- La busqueda de chats por el texto de un mensaje (Alex, 10-11-2026): ILIKE '%texto%' sobre
-- "content" y "transcripcion" usa estos indices de trigramas (ver src/lib/busqueda-de-chats.ts).
-- En produccion ya existen (creados a mano en modo concurrente): aca solo se aseguran, sin tocar nada.
-- Si la base no tiene la extension pg_trgm (por ejemplo la base de pruebas PGlite), se omiten con un
-- aviso y la migracion NO falla: sin estos indices la busqueda funciona igual, solo mas lenta.
-- No estan en schema.prisma: ver docs/cambios-pendientes/busqueda-por-texto.md.
BEGIN;

DO $migracion$
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_trgm;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pg_trgm no esta disponible: se omiten los indices de busqueda por texto';
  END;

  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    CREATE INDEX IF NOT EXISTS "Message_content_trgm_idx"
      ON "Message" USING gin ("content" gin_trgm_ops)
      WHERE "content" IS NOT NULL;

    CREATE INDEX IF NOT EXISTS "Message_transcripcion_trgm_idx"
      ON "Message" USING gin ("transcripcion" gin_trgm_ops)
      WHERE "transcripcion" IS NOT NULL;
  END IF;
END
$migracion$;

COMMIT;
