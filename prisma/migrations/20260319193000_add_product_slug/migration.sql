-- Add slug column
ALTER TABLE "Product"
ADD COLUMN "slug" TEXT;

-- Backfill slugs for existing products
WITH base_slugs AS (
  SELECT
    p."id",
    p."createdAt",
    trim(
      both '-' FROM regexp_replace(
        lower(
          translate(
            concat_ws(' ', p."name", COALESCE(p."code", '')),
            'ÁÀÄÂÃáàäâãÉÈËÊéèëêÍÌÏÎíìïîÓÒÖÔÕóòöôõÚÙÜÛúùüûÑñÇç',
            'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuNnCc'
          )
        ),
        '[^a-z0-9]+',
        '-',
        'g'
      )
    ) AS base_slug
  FROM "Product" p
),
ranked_slugs AS (
  SELECT
    "id",
    CASE
      WHEN row_number() OVER (PARTITION BY base_slug ORDER BY "createdAt", "id") = 1 THEN base_slug
      ELSE concat(base_slug, '-', row_number() OVER (PARTITION BY base_slug ORDER BY "createdAt", "id"))
    END AS slug
  FROM base_slugs
)
UPDATE "Product" p
SET "slug" = rs.slug
FROM ranked_slugs rs
WHERE p."id" = rs."id";

ALTER TABLE "Product"
ALTER COLUMN "slug" SET NOT NULL;

CREATE UNIQUE INDEX "Product_slug_key" ON "Product"("slug");
