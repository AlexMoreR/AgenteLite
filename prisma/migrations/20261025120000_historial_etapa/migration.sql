-- Historial de etapas del CRM: una fila por cada cambio de etapa. Solo aditiva y se puede correr dos veces.
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

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'HistorialEtapa_contactId_fkey') THEN
    ALTER TABLE "HistorialEtapa"
      ADD CONSTRAINT "HistorialEtapa_contactId_fkey"
      FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "HistorialEtapa_contactId_creadoEn_idx" ON "HistorialEtapa"("contactId", "creadoEn");
CREATE INDEX IF NOT EXISTS "HistorialEtapa_workspaceId_creadoEn_idx" ON "HistorialEtapa"("workspaceId", "creadoEn");

COMMIT;
