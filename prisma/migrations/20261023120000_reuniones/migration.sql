-- Módulo Reuniones: videollamada propia (LiveKit), grabada por persona, transcrita y con acta.
-- Ver src/features/reuniones.
--
-- Aditiva: solo crea un enum y tres tablas nuevas; no altera ninguna tabla existente.
-- NO SE HA CORRIDO EN PRODUCCION: ensayarla antes dentro de una transaccion que se deshace.
BEGIN;

DO $$ BEGIN
  CREATE TYPE "EstadoReunion" AS ENUM ('ESPERANDO', 'EN_VIVO', 'EN_COLA', 'TRANSCRIBIENDO', 'HACIENDO_ACTA', 'LISTA', 'ERROR');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "Reunion" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "creadaPorId" TEXT,
  "titulo" TEXT NOT NULL,
  "codigo" TEXT NOT NULL,
  "sala" TEXT NOT NULL,
  "origen" TEXT NOT NULL DEFAULT 'VIVO',
  "estado" "EstadoReunion" NOT NULL DEFAULT 'ESPERANDO',
  "aviso" TEXT,
  "motivoError" TEXT,
  "intentos" INTEGER NOT NULL DEFAULT 0,
  "empezoEn" TIMESTAMP(3),
  "terminoEn" TIMESTAMP(3),
  "transcripcion" JSONB,
  "textoTranscripcion" TEXT,
  "acta" JSONB,
  "textoActa" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Reunion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Reunion_workspaceId_fkey" FOREIGN KEY ("workspaceId")
    REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Reunion_creadaPorId_fkey" FOREIGN KEY ("creadaPorId")
    REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "Reunion_codigo_key" ON "Reunion"("codigo");
CREATE UNIQUE INDEX IF NOT EXISTS "Reunion_sala_key" ON "Reunion"("sala");
CREATE INDEX IF NOT EXISTS "Reunion_workspaceId_createdAt_idx" ON "Reunion"("workspaceId", "createdAt");
CREATE INDEX IF NOT EXISTS "Reunion_estado_idx" ON "Reunion"("estado");

CREATE TABLE IF NOT EXISTS "ReunionParticipante" (
  "id" TEXT NOT NULL,
  "reunionId" TEXT NOT NULL,
  "identidad" TEXT NOT NULL,
  "nombre" TEXT NOT NULL,
  "userId" TEXT,
  "entroEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "salioEn" TIMESTAMP(3),
  CONSTRAINT "ReunionParticipante_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ReunionParticipante_reunionId_fkey" FOREIGN KEY ("reunionId")
    REFERENCES "Reunion"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "ReunionParticipante_reunionId_identidad_key"
  ON "ReunionParticipante"("reunionId", "identidad");

CREATE TABLE IF NOT EXISTS "ReunionPista" (
  "id" TEXT NOT NULL,
  "reunionId" TEXT NOT NULL,
  "participanteId" TEXT,
  "egressId" TEXT,
  "trackSid" TEXT,
  "archivo" TEXT,
  "empiezaEn" TIMESTAMP(3),
  "terminaEn" TIMESTAMP(3),
  "bytes" INTEGER,
  "transcripcion" JSONB,
  "estado" TEXT NOT NULL DEFAULT 'GRABANDO',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReunionPista_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ReunionPista_reunionId_fkey" FOREIGN KEY ("reunionId")
    REFERENCES "Reunion"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ReunionPista_participanteId_fkey" FOREIGN KEY ("participanteId")
    REFERENCES "ReunionParticipante"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "ReunionPista_egressId_key" ON "ReunionPista"("egressId");
CREATE INDEX IF NOT EXISTS "ReunionPista_reunionId_idx" ON "ReunionPista"("reunionId");
-- Una pista de LiveKit se graba una sola vez aunque el aviso llegue repetido (los audios subidos van
-- con trackSid NULL, y varios NULL se permiten).
CREATE UNIQUE INDEX IF NOT EXISTS "ReunionPista_reunionId_trackSid_key" ON "ReunionPista"("reunionId", "trackSid");

COMMIT;
