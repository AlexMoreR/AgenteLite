-- Como se reconoce un producto en una conversacion, sin depender de que el agente lo haya marcado.
--
-- Medido en produccion: de las conversaciones de los ultimos 2 dias, 193 tenian producto marcado y
-- 178 no. Las que atiende una persona —que suelen ser las mas avanzadas— quedaban invisibles,
-- porque el producto solo se marcaba cuando el agente procesaba el mensaje.
ALTER TABLE "ProductPlaybook" ADD COLUMN IF NOT EXISTS "matchKeywords" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "ProductPlaybook" ADD COLUMN IF NOT EXISTS "matchAdTitles" TEXT[] DEFAULT ARRAY[]::TEXT[];
