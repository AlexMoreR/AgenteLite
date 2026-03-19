-- AlterTable
ALTER TABLE "Product"
ADD COLUMN "code" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Product_code_key" ON "Product"("code");
