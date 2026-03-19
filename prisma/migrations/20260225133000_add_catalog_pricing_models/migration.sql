-- AlterTable
ALTER TABLE "Product"
ADD COLUMN "baseCost" DECIMAL(10,2),
ADD COLUMN "retailMarginPct" DECIMAL(6,2),
ADD COLUMN "wholesaleMarginPct" DECIMAL(6,2),
ADD COLUMN "wholesalePrice" DECIMAL(10,2),
ADD COLUMN "minWholesaleQty" INTEGER NOT NULL DEFAULT 6,
ADD COLUMN "categoryId" TEXT;

-- Backfill existing products
UPDATE "Product"
SET
  "baseCost" = "price",
  "retailMarginPct" = 0,
  "wholesaleMarginPct" = 0,
  "wholesalePrice" = "price"
WHERE
  "baseCost" IS NULL
  OR "retailMarginPct" IS NULL
  OR "wholesaleMarginPct" IS NULL
  OR "wholesalePrice" IS NULL;

-- Make required after backfill
ALTER TABLE "Product"
ALTER COLUMN "baseCost" SET NOT NULL,
ALTER COLUMN "baseCost" SET DEFAULT 0,
ALTER COLUMN "retailMarginPct" SET NOT NULL,
ALTER COLUMN "retailMarginPct" SET DEFAULT 0,
ALTER COLUMN "wholesaleMarginPct" SET NOT NULL,
ALTER COLUMN "wholesaleMarginPct" SET DEFAULT 0,
ALTER COLUMN "wholesalePrice" SET NOT NULL,
ALTER COLUMN "wholesalePrice" SET DEFAULT 0;

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductSupplier" (
    "productId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "supplierSku" TEXT,
    "supplierCost" DECIMAL(10,2),
    "isPreferred" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProductSupplier_pkey" PRIMARY KEY ("productId","supplierId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Category_name_key" ON "Category"("name");
CREATE UNIQUE INDEX "Category_slug_key" ON "Category"("slug");
CREATE UNIQUE INDEX "Supplier_name_key" ON "Supplier"("name");
CREATE INDEX "ProductSupplier_supplierId_idx" ON "ProductSupplier"("supplierId");
CREATE INDEX "Product_categoryId_idx" ON "Product"("categoryId");

-- AddForeignKey
ALTER TABLE "Product"
ADD CONSTRAINT "Product_categoryId_fkey"
FOREIGN KEY ("categoryId") REFERENCES "Category"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ProductSupplier"
ADD CONSTRAINT "ProductSupplier_productId_fkey"
FOREIGN KEY ("productId") REFERENCES "Product"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProductSupplier"
ADD CONSTRAINT "ProductSupplier_supplierId_fkey"
FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
