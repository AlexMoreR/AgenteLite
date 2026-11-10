-- Indices para que la base responda mas rapido. Solo agrega indices: no cambia ni mueve ningun dato.
--
-- En produccion se crean antes a mano con CREATE INDEX en modo concurrente (sin trabar las escrituras), con
-- estos mismos nombres. Esta migracion solo asegura que existan en las demas bases: con IF NOT EXISTS,
-- donde ya estan no hace nada.

BEGIN;

-- Acuses de WAHA (aplicarAck, ediciones y borrados, eco de lo enviado): el mensaje se busca por el
-- pedazo del id despues del ultimo "_" (el id crudo), dentro de la linea. Ver src/lib/mensaje-por-id-crudo.ts:
-- la expresion de la consulta es esta misma, o Postgres no usa el indice.
CREATE INDEX IF NOT EXISTS "Message_channel_idCrudo_idx"
  ON "Message" ("channelId", (reverse(split_part(reverse("externalId"), '_', 1))));

-- Transcripcion de audios: los pendientes que el reloj toma cada minuto. Solo guarda los audios sin
-- transcribir, asi que es diminuto y la busqueda deja de recorrer Message.
CREATE INDEX IF NOT EXISTS "Message_audio_pendiente_idx"
  ON "Message" ("createdAt")
  WHERE "type" = 'AUDIO' AND "transcritoEn" IS NULL AND "deletedAt" IS NULL AND "mediaUrl" IS NOT NULL;

-- Transcripcion de audios: "este archivo ya se transcribio" (el audio de un flujo, mandado a otro lead).
-- Ya existe en produccion con este nombre (se creo a mano); aca queda en el repositorio.
CREATE INDEX IF NOT EXISTS "Message_mediaUrl_transcrita_idx"
  ON "Message" ("mediaUrl")
  WHERE "transcripcion" IS NOT NULL;

-- Embudo: los eventos de un chat por tipo (recuperacion 72 h). El de (conversationId, createdAt) se queda.
CREATE INDEX IF NOT EXISTS "EmbudoEvento_conversationId_tipo_createdAt_idx"
  ON "EmbudoEvento" ("conversationId", "tipo", "createdAt");

-- Seguimientos: el reclamo de los que ya vencen, de todos los negocios, cada minuto. Solo los pendientes.
CREATE INDEX IF NOT EXISTS "Follow_pendiente_executeAt_idx"
  ON "Follow" ("executeAt")
  WHERE "status" = 'PENDING';

COMMIT;
