-- Adds a normalized boolean to flag WhatsApp status/broadcast messages so the
-- list/summary/unread-count queries can filter them with an index instead of
-- the previous non-sargable `rawPayload::text ILIKE '%status@broadcast%'` scan.

ALTER TABLE "Message"
ADD COLUMN "isStatusBroadcast" BOOLEAN NOT NULL DEFAULT false;

-- Backfill legacy rows. New inbound broadcasts are already dropped before being
-- persisted, so this only matters for historical data. The predicate is a
-- superset of `isEvolutionStatusBroadcastPayload` (remoteJid status@broadcast /
-- `@status` JIDs / presence of a `statusMessage` object) to preserve the exact
-- behaviour both the SQL ILIKE filter and the JS filter had before.
UPDATE "Message"
SET "isStatusBroadcast" = true
WHERE COALESCE("rawPayload"::text, '') ILIKE '%status@broadcast%'
   OR COALESCE("rawPayload"::text, '') ILIKE '%"statusMessage"%'
   OR COALESCE("rawPayload"::text, '') ILIKE '%@status"%';

-- Partial index that directly serves the unread-incoming-count query.
CREATE INDEX "Message_unread_inbound_idx"
ON "Message"("conversationId")
WHERE "direction" = 'INBOUND' AND "readAt" IS NULL AND "isStatusBroadcast" = false;
