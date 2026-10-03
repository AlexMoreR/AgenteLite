-- Numero corto de cada chat, para los links que salen de la app (app.aizenbot.com/c/1234).
--
-- Un solo contador para las dos tablas de chats (canal viejo y API oficial): asi el 1234 es un
-- chat y no dos. Los que ya existen se numeran por orden de llegada.
--
-- Todo en UNA transaccion: el ALTER TABLE toma la tabla mientras dura (milisegundos con ~3.300
-- chats), y el contenedor viejo -que sigue atendiendo mientras arranca el nuevo- no puede meter un
-- chat sin numero entre el relleno y el DEFAULT.
BEGIN;

CREATE SEQUENCE IF NOT EXISTS "chat_numero_seq";

ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "numero" INTEGER;
ALTER TABLE "OfficialApiConversation" ADD COLUMN IF NOT EXISTS "numero" INTEGER;

-- Relleno, por fecha de llegada. Arranca despues del mayor que ya haya (si esto se corriera dos
-- veces, la segunda no repite numeros: solo numera los que siguen sin numero).
WITH base AS (
  SELECT GREATEST(
    (SELECT COALESCE(MAX("numero"), 0) FROM "Conversation"),
    (SELECT COALESCE(MAX("numero"), 0) FROM "OfficialApiConversation")
  ) AS desde
),
todos AS (
  SELECT 'agent' AS fuente, "id", "createdAt" FROM "Conversation" WHERE "numero" IS NULL
  UNION ALL
  SELECT 'official' AS fuente, "id", "createdAt" FROM "OfficialApiConversation" WHERE "numero" IS NULL
),
numerados AS (
  SELECT fuente, "id", (SELECT desde FROM base) + ROW_NUMBER() OVER (ORDER BY "createdAt", "id") AS n
  FROM todos
),
canal_viejo AS (
  UPDATE "Conversation" AS c
  SET "numero" = numerados.n
  FROM numerados
  WHERE numerados.fuente = 'agent' AND numerados."id" = c."id"
  RETURNING 1
)
UPDATE "OfficialApiConversation" AS o
SET "numero" = numerados.n
FROM numerados
WHERE numerados.fuente = 'official' AND numerados."id" = o."id";

-- El contador sigue desde el ultimo numero usado.
SELECT setval(
  '"chat_numero_seq"',
  GREATEST(
    (SELECT COALESCE(MAX("numero"), 0) FROM "Conversation"),
    (SELECT COALESCE(MAX("numero"), 0) FROM "OfficialApiConversation"),
    1
  )
);

-- Los chats nuevos toman el siguiente solos, tambien los que se crean con SQL crudo.
ALTER TABLE "Conversation" ALTER COLUMN "numero" SET DEFAULT nextval('"chat_numero_seq"');
ALTER TABLE "OfficialApiConversation" ALTER COLUMN "numero" SET DEFAULT nextval('"chat_numero_seq"');

CREATE UNIQUE INDEX IF NOT EXISTS "Conversation_numero_key" ON "Conversation"("numero");
CREATE UNIQUE INDEX IF NOT EXISTS "OfficialApiConversation_numero_key" ON "OfficialApiConversation"("numero");

COMMIT;
