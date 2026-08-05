-- Que le duele al cliente ideal. Es lo que se vende de verdad: nadie compra una camilla, compra
-- dejar de perder clientas porque el local se ve improvisado.
--
-- Las caracteristicas con su beneficio NO necesitan columna: van como reglas de tipo "BENEFICIO"
-- en ProductPlaybookRule (la caracteristica en "trigger", el beneficio en "text"), que es texto
-- libre justamente para poder sumar un tipo sin tocar la base.
ALTER TABLE "ProductPlaybook" ADD COLUMN IF NOT EXISTS "customerPain" TEXT;
