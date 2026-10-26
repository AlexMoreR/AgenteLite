-- Embudo 3: versiones del embudo de cada producto y la versión con la que entró cada chat.
-- Solo aditiva y se puede correr dos veces.
BEGIN;

CREATE TABLE IF NOT EXISTS "EmbudoVersion" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "numero" INTEGER NOT NULL,
    "nota" TEXT,
    "quienId" TEXT,
    "quienNombre" TEXT,
    "origen" TEXT NOT NULL,
    "huella" TEXT NOT NULL,
    "contenido" JSONB NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmbudoVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "EmbudoChatVersion" (
    "conversationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "numero" INTEGER NOT NULL,
    "asignadaPor" TEXT NOT NULL DEFAULT 'vigente',
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmbudoChatVersion_pkey" PRIMARY KEY ("conversationId")
);

CREATE UNIQUE INDEX IF NOT EXISTS "EmbudoVersion_productId_numero_key" ON "EmbudoVersion"("productId", "numero");
CREATE INDEX IF NOT EXISTS "EmbudoVersion_workspaceId_creadoEn_idx" ON "EmbudoVersion"("workspaceId", "creadoEn");
CREATE INDEX IF NOT EXISTS "EmbudoChatVersion_versionId_idx" ON "EmbudoChatVersion"("versionId");
CREATE INDEX IF NOT EXISTS "EmbudoChatVersion_workspaceId_productId_creadoEn_idx" ON "EmbudoChatVersion"("workspaceId", "productId", "creadoEn");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'EmbudoVersion_productId_fkey') THEN
    ALTER TABLE "EmbudoVersion"
      ADD CONSTRAINT "EmbudoVersion_productId_fkey"
      FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'EmbudoChatVersion_versionId_fkey') THEN
    ALTER TABLE "EmbudoChatVersion"
      ADD CONSTRAINT "EmbudoChatVersion_versionId_fkey"
      FOREIGN KEY ("versionId") REFERENCES "EmbudoVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

COMMIT;
