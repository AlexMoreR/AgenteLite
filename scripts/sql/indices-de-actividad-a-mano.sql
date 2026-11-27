-- Los 3 indices de actividad de Message, para crearlos A MANO en produccion SIN trabar las escrituras.
--
-- Son los mismos de las migraciones 20261125000000_indices_ultima_accion (ultima accion de Equipo) y
-- 20261126000000_indice_message_no_leido (no leidos de la bandeja), con los mismos nombres, columnas y
-- WHERE, pero con CONCURRENTLY: Postgres los arma sin bloquear los INSERT/UPDATE de Message.
--
-- Como se corre:
--   * Una sentencia a la vez, FUERA de una transaccion (CONCURRENTLY no corre dentro de BEGIN/COMMIT).
--   * Con IF NOT EXISTS: donde ya estan no hace nada, se puede volver a correr.
--   * Si una se corta a la mitad, el indice queda INVALID: se borra con DROP INDEX CONCURRENTLY "<nombre>"
--     y se vuelve a correr la sentencia. Revisar con:
--       SELECT indexrelid::regclass, indisvalid FROM pg_index WHERE indexrelid::regclass::text LIKE '"Message_%';
--
-- scripts/check-indices-de-actividad.mjs revisa que cada sentencia sea igual a la de su migracion (sin el
-- CONCURRENTLY): si se cambia una, hay que cambiar la otra.

-- El ultimo mensaje que mando cada persona (enviadoPorUserId).
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Message_ultima_accion_enviado_idx" ON "Message" ("workspaceId", (("rawPayload"->>'enviadoPorUserId')), "createdAt" DESC) WHERE "direction" = 'OUTBOUND' AND "type" <> 'SYSTEM' AND ("rawPayload"->>'enviadoPorUserId') IS NOT NULL;

-- La ultima nota de sistema (asignacion o etapa) que dejo cada persona (actorUserId).
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Message_ultima_accion_actor_idx" ON "Message" ("workspaceId", (("rawPayload"->>'actorUserId')), "createdAt" DESC) WHERE "type" = 'SYSTEM' AND ("rawPayload"->>'actorUserId') IS NOT NULL;

-- Los mensajes "no leidos" (entrantes, sin leer y que no son estados).
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Message_no_leido_idx" ON "Message" ("workspaceId", "createdAt") INCLUDE ("conversationId", "channelId") WHERE "direction" = 'INBOUND' AND "readAt" IS NULL AND "isStatusBroadcast" = false;
