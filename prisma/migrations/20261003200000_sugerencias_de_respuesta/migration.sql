-- Registro de la estrella del cuadro de mensajes: cada sugerencia que se genera, y si la vendedora
-- la envio (y si la edito antes). Sirve para medir cuanto la usa cada una.
--
-- Solo crea una tabla nueva: no toca ninguna existente. Sin claves foraneas a proposito: el chat
-- puede ser de dos tablas distintas (canal viejo o API oficial), y un registro de uso no tiene por
-- que impedir borrar nada.
BEGIN;

CREATE TABLE IF NOT EXISTS "SugerenciaDeRespuesta" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "fuente" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "productoId" TEXT,
  "texto" TEXT NOT NULL,
  "creadaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "enviadaEn" TIMESTAMP(3),
  "textoEnviado" TEXT,
  "editada" BOOLEAN,
  CONSTRAINT "SugerenciaDeRespuesta_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SugerenciaDeRespuesta_workspaceId_userId_creadaEn_idx"
  ON "SugerenciaDeRespuesta"("workspaceId", "userId", "creadaEn");
CREATE INDEX IF NOT EXISTS "SugerenciaDeRespuesta_conversationId_idx"
  ON "SugerenciaDeRespuesta"("conversationId");

COMMIT;
