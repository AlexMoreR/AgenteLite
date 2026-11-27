-- Indice de los mensajes "no leidos" (entrantes, sin leer y que no son estados). Solo agrega un indice: no cambia
-- ni mueve ningun dato.
--
-- En produccion ya se creo a mano, con este mismo nombre. Esta migracion solo asegura que exista en las demas
-- bases: con IF NOT EXISTS, donde ya esta no hace nada.

CREATE INDEX IF NOT EXISTS "Message_no_leido_idx" ON "Message" ("workspaceId", "createdAt") INCLUDE ("conversationId", "channelId") WHERE "direction" = 'INBOUND' AND "readAt" IS NULL AND "isStatusBroadcast" = false;
