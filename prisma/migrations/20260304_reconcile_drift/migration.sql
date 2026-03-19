ALTER TABLE "Category" ADD COLUMN IF NOT EXISTS "logoUrl" TEXT;
DROP INDEX IF EXISTS "Product_categoryId_idx";
