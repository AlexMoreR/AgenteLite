-- "Si no contesta" por etapa del embudo del producto.
--
-- El seguimiento correcto depende del producto Y de la etapa: no es lo mismo que el cliente se
-- calle en Presentacion —ni sabemos que quiere— que en Cierre, donde ya sabe el precio y lo esta
-- pensando. Una FollowRule por workspace no puede expresar esa diferencia, por eso el dato vive
-- en la etapa.
--
-- Aditivo y anulable: una etapa sin estos campos simplemente no tiene seguimiento.
--
-- Idempotente (IF NOT EXISTS) como las anteriores: esta base tiene cambios aplicados con
-- `db push` que no figuran en el historial.
ALTER TABLE "ProductFunnelStage" ADD COLUMN IF NOT EXISTS "followUpDays" INTEGER;
ALTER TABLE "ProductFunnelStage" ADD COLUMN IF NOT EXISTS "followUpMessage" TEXT;
