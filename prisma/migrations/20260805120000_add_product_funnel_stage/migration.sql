-- Las cinco etapas del embudo de ventas, ahora editables desde el producto.
--
-- Idempotente por la misma razon que las anteriores: esta base tiene cambios aplicados con
-- `db push` que no figuran en el historial, y el arranque del contenedor no puede caerse porque
-- algo ya estuviera creado.

-- CreateTable
CREATE TABLE IF NOT EXISTS "ProductFunnelStage" (
    "id" TEXT NOT NULL,
    "playbookId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "goal" TEXT,
    "script" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductFunnelStage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ProductFunnelStage_playbookId_stage_key" ON "ProductFunnelStage"("playbookId", "stage");
CREATE INDEX IF NOT EXISTS "ProductFunnelStage_playbookId_sortOrder_idx" ON "ProductFunnelStage"("playbookId", "sortOrder");

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "ProductFunnelStage" ADD CONSTRAINT "ProductFunnelStage_playbookId_fkey" FOREIGN KEY ("playbookId") REFERENCES "ProductPlaybook"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
