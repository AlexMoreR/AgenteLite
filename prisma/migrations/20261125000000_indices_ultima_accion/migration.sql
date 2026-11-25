-- Indices para la "ultima accion" de cada persona en Equipo. Solo agrega indices: no cambia ni mueve ningun dato.
--
-- En produccion se crean antes a mano con CREATE INDEX CONCURRENTLY (sin trabar las escrituras en Message),
-- con estos mismos nombres, igual que en 20261116000000_indices_de_velocidad. Esta migracion solo asegura que
-- existan en las demas bases: con IF NOT EXISTS, donde ya estan no hace nada.
--
-- Las condiciones del WHERE son las mismas de la consulta en src/features/actividad/services/actividad.ts
-- (ultimaAccionPorPersona), escritas igual: si cambian alla, Postgres deja de usar el indice.

BEGIN;

-- El ultimo mensaje que mando cada persona (enviadoPorUserId).
CREATE INDEX IF NOT EXISTS "Message_ultima_accion_enviado_idx" ON "Message" ("workspaceId", (("rawPayload"->>'enviadoPorUserId')), "createdAt" DESC) WHERE "direction" = 'OUTBOUND' AND "type" <> 'SYSTEM' AND ("rawPayload"->>'enviadoPorUserId') IS NOT NULL;

-- La ultima nota de sistema (asignacion o etapa) que dejo cada persona (actorUserId).
CREATE INDEX IF NOT EXISTS "Message_ultima_accion_actor_idx" ON "Message" ("workspaceId", (("rawPayload"->>'actorUserId')), "createdAt" DESC) WHERE "type" = 'SYSTEM' AND ("rawPayload"->>'actorUserId') IS NOT NULL;

COMMIT;
