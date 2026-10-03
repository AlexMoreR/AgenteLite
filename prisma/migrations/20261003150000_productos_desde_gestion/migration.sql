-- Productos sincronizados desde Gestion (03-10-2026). Columnas nuevas, todas con valor por
-- defecto u opcionales: los productos que ya existen quedan "MANUAL" y activos, como estaban.
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "origen" TEXT NOT NULL DEFAULT 'MANUAL';
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "gestionId" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "sincronizadoEl" TIMESTAMP(3);
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "activo" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "estadoEnGestion" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Product_workspaceId_gestionId_key" ON "Product"("workspaceId", "gestionId");
