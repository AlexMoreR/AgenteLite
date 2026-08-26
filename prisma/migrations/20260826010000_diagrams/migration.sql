-- Diagramas: mapas mentales para pensar el negocio.
--
-- El contenido va entero en `data` (JSONB) porque un diagrama se lee y se guarda SIEMPRE
-- completo; partirlo en tablas de nodos y aristas solo agregaria trabajo para rearmarlo.
--
-- IF NOT EXISTS en todo: la base de produccion tiene drift y una migracion que explota al
-- encontrarse algo ya creado deja el contenedor sin arrancar.

CREATE TABLE IF NOT EXISTS "Diagram" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'Sin titulo',
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Diagram_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Diagram_workspaceId_createdById_updatedAt_idx"
    ON "Diagram"("workspaceId", "createdById", "updatedAt");

DO $$
BEGIN
    ALTER TABLE "Diagram"
        ADD CONSTRAINT "Diagram_workspaceId_fkey"
        FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE "Diagram"
        ADD CONSTRAINT "Diagram_createdById_fkey"
        FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
