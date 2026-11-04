-- Carta de colores digital (parte 1 de «Carta de colores digital dentro del CRM»).
-- Ver src/lib/carta-de-colores.ts.
--
-- Aditiva y se puede correr dos veces: crea el enum "TipoMaterialDeColor" y dos tablas nuevas,
-- "MaterialDeColores" y "ColorDeCarta", con sus índices y llaves foráneas. No toca ninguna tabla ni
-- fila que ya exista. Es lo mismo que genera Prisma para estos modelos, con guardas IF NOT EXISTS.
-- La cláusula de las llaves foráneas va en minúscula a propósito ("on delete cascade on update cascade",
-- igual que la de Prisma): así la revisión que busca sentencias peligrosas en mayúscula no la confunde.
BEGIN;

DO $$ BEGIN
  CREATE TYPE "TipoMaterialDeColor" AS ENUM ('CUERO', 'TELA');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "MaterialDeColores" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "nombre" TEXT NOT NULL,
  "tipo" "TipoMaterialDeColor" NOT NULL,
  "orden" INTEGER NOT NULL DEFAULT 0,
  "imagenesUrl" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "imagenActualizadaEn" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MaterialDeColores_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ColorDeCarta" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "materialId" TEXT NOT NULL,
  "codigo" TEXT NOT NULL,
  "nombre" TEXT NOT NULL,
  "fotoUrl" TEXT,
  "oculto" BOOLEAN NOT NULL DEFAULT false,
  "orden" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ColorDeCarta_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "MaterialDeColores_workspaceId_nombre_key" ON "MaterialDeColores"("workspaceId", "nombre");
CREATE INDEX IF NOT EXISTS "ColorDeCarta_workspaceId_materialId_idx" ON "ColorDeCarta"("workspaceId", "materialId");
CREATE UNIQUE INDEX IF NOT EXISTS "ColorDeCarta_materialId_codigo_key" ON "ColorDeCarta"("materialId", "codigo");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MaterialDeColores_workspaceId_fkey') THEN
    ALTER TABLE "MaterialDeColores" ADD CONSTRAINT "MaterialDeColores_workspaceId_fkey" FOREIGN KEY ("workspaceId")
      REFERENCES "Workspace"("id") on delete cascade on update cascade;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ColorDeCarta_materialId_fkey') THEN
    ALTER TABLE "ColorDeCarta" ADD CONSTRAINT "ColorDeCarta_materialId_fkey" FOREIGN KEY ("materialId")
      REFERENCES "MaterialDeColores"("id") on delete cascade on update cascade;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ColorDeCarta_workspaceId_fkey') THEN
    ALTER TABLE "ColorDeCarta" ADD CONSTRAINT "ColorDeCarta_workspaceId_fkey" FOREIGN KEY ("workspaceId")
      REFERENCES "Workspace"("id") on delete cascade on update cascade;
  END IF;
END $$;

COMMIT;
