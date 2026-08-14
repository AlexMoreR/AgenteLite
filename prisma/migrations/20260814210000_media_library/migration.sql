-- Biblioteca de archivos: los catalogos que se mandan todos los dias, subidos UNA vez.
--
-- No resuelve un problema de formato ni de permisos sino de TIEMPO: las asesoras trabajan desde el
-- celular y con mala señal un catalogo de 15 MB tarda entre 8 y 18 minutos en subir, y se corta
-- antes de terminar. Pero son siempre los mismos ocho archivos: subidos una vez, mandarlos deja de
-- ser una subida y pasa a ser una referencia a algo que ya esta en el servidor.
CREATE TABLE IF NOT EXISTS "MediaLibraryItem" (
  "id"          TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "title"       TEXT NOT NULL,
  "url"         TEXT NOT NULL,
  "fileName"    TEXT NOT NULL,
  "mimeType"    TEXT NOT NULL,
  "mediaType"   TEXT NOT NULL,
  "sizeBytes"   INTEGER NOT NULL DEFAULT 0,
  "sentCount"   INTEGER NOT NULL DEFAULT 0,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MediaLibraryItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "MediaLibraryItem_workspaceId_sentCount_idx" ON "MediaLibraryItem" ("workspaceId", "sentCount");
CREATE INDEX IF NOT EXISTS "MediaLibraryItem_workspaceId_createdAt_idx" ON "MediaLibraryItem" ("workspaceId", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MediaLibraryItem_workspaceId_fkey') THEN
    ALTER TABLE "MediaLibraryItem" ADD CONSTRAINT "MediaLibraryItem_workspaceId_fkey"
      FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
