-- Contactos bloqueados desde la bandeja (02-10-2026). Columna nueva y opcional: no toca datos.
ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "bloqueadoEn" TIMESTAMP(3);
