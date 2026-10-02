-- Numero de cotizacion de Gestion al marcar Ganado (02-10-2026). Columna nueva y opcional: no toca datos.
ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "wonQuoteRef" TEXT;
