-- La busqueda de chats por el texto de un mensaje (Alex, 10-11-2026): ILIKE '%texto%' sobre
-- "content" y "transcripcion" usa estos indices de trigramas (ver src/lib/busqueda-de-chats.ts).
-- En produccion ya existen (creados a mano con CONCURRENTLY): aca solo se aseguran, sin tocar nada.
-- No estan en schema.prisma: ver docs/cambios-pendientes/busqueda-por-texto.md.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "Message_content_trgm_idx"
  ON "Message" USING gin ("content" gin_trgm_ops)
  WHERE "content" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "Message_transcripcion_trgm_idx"
  ON "Message" USING gin ("transcripcion" gin_trgm_ops)
  WHERE "transcripcion" IS NOT NULL;

COMMIT;
