-- El playbook de ventas por producto: lo que la casa aprendio vendiendolo.
--
-- Escrita a mano y de forma IDEMPOTENTE (IF NOT EXISTS + guardas en las claves foraneas) porque
-- esta base viene con drift: hay tablas creadas con `db push` que no figuran en el historial de
-- migraciones. Asi, si algo de esto ya existiera, el arranque del contenedor no se cae.

-- CreateTable
CREATE TABLE IF NOT EXISTS "ProductPlaybook" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "pitch" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductPlaybook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ProductPlaybookRule" (
    "id" TEXT NOT NULL,
    "playbookId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "trigger" TEXT,
    "text" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "originConversationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductPlaybookRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ProductPlaybook_workspaceId_productId_key" ON "ProductPlaybook"("workspaceId", "productId");
CREATE INDEX IF NOT EXISTS "ProductPlaybook_workspaceId_idx" ON "ProductPlaybook"("workspaceId");
CREATE INDEX IF NOT EXISTS "ProductPlaybookRule_playbookId_kind_sortOrder_idx" ON "ProductPlaybookRule"("playbookId", "kind", "sortOrder");

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "ProductPlaybook" ADD CONSTRAINT "ProductPlaybook_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "ProductPlaybook" ADD CONSTRAINT "ProductPlaybook_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "ProductPlaybookRule" ADD CONSTRAINT "ProductPlaybookRule_playbookId_fkey" FOREIGN KEY ("playbookId") REFERENCES "ProductPlaybook"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
