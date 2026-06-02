ALTER TABLE "FollowRule"
  ADD COLUMN IF NOT EXISTS "actions" JSONB;

ALTER TABLE "Follow"
  ADD COLUMN IF NOT EXISTS "actions" JSONB;

UPDATE "FollowRule"
SET "actions" = jsonb_build_array(
  jsonb_build_object(
    'order', 1,
    'messageType', "messageType",
    'content', "content",
    'mediaUrl', "mediaUrl",
    'status', 'PENDING',
    'executedAt', NULL,
    'executionError', NULL,
    'lockedAt', NULL,
    'lockedBy', NULL
  )
)
WHERE "actions" IS NULL;

UPDATE "Follow"
SET "actions" = jsonb_build_array(
  jsonb_build_object(
    'order', 1,
    'messageType', "messageType",
    'content', "content",
    'mediaUrl', "mediaUrl",
    'status', "status",
    'executedAt', "executedAt",
    'executionError', "executionError",
    'lockedAt', "lockedAt",
    'lockedBy', "lockedBy"
  )
)
WHERE "actions" IS NULL;
