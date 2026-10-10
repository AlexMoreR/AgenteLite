-- Embudo F1 (medir sin cambiar nada): eventos de cada lead y la foto actual de cada lead.
-- Ver src/features/embudo.
--
-- Solo crea dos tablas nuevas y sus indices: no toca ninguna tabla existente y no tiene claves
-- foraneas (es un registro de medicion; no puede impedir borrar un chat ni hacer fallar nada).
BEGIN;

CREATE TABLE IF NOT EXISTS "EmbudoEvento" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "contactId" TEXT,
  "channelId" TEXT,
  "producto" TEXT,
  "paso" TEXT,
  "tipo" TEXT NOT NULL,
  "reglaId" TEXT,
  "reglaNombre" TEXT,
  "libroVersion" INTEGER,
  "origen" TEXT NOT NULL,
  "datos" JSONB,
  "claveUnica" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EmbudoEvento_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "EmbudoEvento_claveUnica_key"
  ON "EmbudoEvento"("claveUnica");
CREATE INDEX IF NOT EXISTS "EmbudoEvento_workspaceId_tipo_createdAt_idx"
  ON "EmbudoEvento"("workspaceId", "tipo", "createdAt");
CREATE INDEX IF NOT EXISTS "EmbudoEvento_conversationId_createdAt_idx"
  ON "EmbudoEvento"("conversationId", "createdAt");

CREATE TABLE IF NOT EXISTS "EmbudoLead" (
  "conversationId" TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "channelId" TEXT NOT NULL,
  "productoEntrada" TEXT,
  "productoActual" TEXT,
  "mezcla" BOOLEAN NOT NULL DEFAULT false,
  "anuncioId" TEXT,
  "anuncioTitulo" TEXT,
  "anuncioRed" TEXT,
  "entradaEn" TIMESTAMP(3) NOT NULL,
  "libroVersionEntrada" INTEGER,
  "pasoActual" TEXT,
  "pasoMaximo" TEXT,
  "temperatura" TEXT,
  "puntaje" INTEGER,
  "motivo" TEXT,
  "senales" JSONB,
  "transferencia" TEXT NOT NULL DEFAULT 'NO',
  "asignadaA" TEXT,
  "asignadaEn" TIMESTAMP(3),
  "primeraRespuestaAsesoraEn" TIMESTAMP(3),
  "ultimoClienteEn" TIMESTAMP(3),
  "ultimoBotEn" TIMESTAMP(3),
  "cotizacionRef" TEXT,
  "cotizacionEn" TIMESTAMP(3),
  "anticipoEn" TIMESTAMP(3),
  "ventaEn" TIMESTAMP(3),
  "revisadoEn" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EmbudoLead_pkey" PRIMARY KEY ("conversationId")
);

CREATE INDEX IF NOT EXISTS "EmbudoLead_workspaceId_entradaEn_idx"
  ON "EmbudoLead"("workspaceId", "entradaEn");
CREATE INDEX IF NOT EXISTS "EmbudoLead_workspaceId_transferencia_temperatura_idx"
  ON "EmbudoLead"("workspaceId", "transferencia", "temperatura");

COMMIT;
