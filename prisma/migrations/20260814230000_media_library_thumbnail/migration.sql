-- La tapa del archivo (primera pagina del PDF), generada en el navegador al agregarlo.
-- Sin esto los ocho catalogos se ven identicos en la grilla: todos empiezan con "CATALOGO".
ALTER TABLE "MediaLibraryItem" ADD COLUMN IF NOT EXISTS "thumbnailUrl" TEXT;
