-- El perfil del cliente ideal del producto: a quien le sirve y a quien no.
--
-- IF NOT EXISTS por el mismo motivo que la migracion anterior: esta base tiene cambios aplicados
-- con `db push` que no figuran en el historial, y un arranque de contenedor no puede caerse
-- porque una columna ya estuviera puesta.
ALTER TABLE "ProductPlaybook" ADD COLUMN IF NOT EXISTS "idealCustomer" TEXT;
