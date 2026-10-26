-- Embudo 1: historial de etapas del CRM. Una fila por cada cambio de etapa de un contacto (quién, cuándo, de dónde a dónde).
-- Ver src/lib/historial-etapa.ts.
--
-- Aditiva: crea una tabla nueva ("HistorialEtapa") con su llave a "Contact" (ON DELETE CASCADE) y dos índices.
-- No borra, no renombra y no cambia ninguna columna existente. Nace vacía: no se inventan fechas viejas.
-- Se puede correr dos veces sin daño.
-- NO SE HA CORRIDO EN PRODUCCION: ensayarla antes dentro de una transaccion que se deshace.
-- Probada con PGlite sobre todas las migraciones: npm run test:historial-etapa-migracion
BEGIN;

CREATE TABLE IF NOT EXISTS "HistorialEtapa" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  "conversationId" TEXT,
  "etapaAnterior" TEXT,
  "etapaNueva" TEXT NOT NULL,
  "origen" TEXT NOT NULL,
  "quien" TEXT,
  "nota" TEXT,
  "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HistorialEtapa_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'HistorialEtapa_contactId_fkey') THEN
  ALTER TABLE "HistorialEtapa" ADD CONSTRAINT "HistorialEtapa_contactId_fkey" FOREIGN KEY ("contactId")
  REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE; END IF; END $$;

CREATE INDEX IF NOT EXISTS "HistorialEtapa_contactId_creadoEn_idx" ON "HistorialEtapa"("contactId", "creadoEn");
CREATE INDEX IF NOT EXISTS "HistorialEtapa_workspaceId_creadoEn_idx" ON "HistorialEtapa"("workspaceId", "creadoEn");

COMMIT;
