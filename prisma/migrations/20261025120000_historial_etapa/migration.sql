-- Embudo 1: historial de cambios de etapa del CRM. Ver src/lib/historial-etapa.ts.
--
-- Aditiva: crea la tabla "HistorialEtapa" (una fila por cambio de etapa: quién, cuándo, de dónde a dónde).
-- No borra, no renombra y no cambia ninguna columna existente. Empieza vacía: no se inventan fechas viejas.
-- La llave a "Contact" borra el historial si se borra el cliente. Se puede correr dos veces sin daño.
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
