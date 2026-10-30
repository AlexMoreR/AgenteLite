-- Reuniones: salas fijas por área (como un canal de Teams). Cada sala tiene un link fijo y su historial.
-- Ver src/features/reuniones/servicios/salas.ts.
--
-- Aditiva y se puede correr dos veces: crea la tabla "SalaDeReuniones" y agrega la columna opcional
-- "salaFijaId" a "Reunion". No cambia ni borra ninguna fila ni columna; las reuniones que ya existen
-- quedan con "salaFijaId" vacío (sueltas, como hoy).
BEGIN;

CREATE TABLE IF NOT EXISTS "SalaDeReuniones" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "nombre" TEXT NOT NULL,
  "codigo" TEXT NOT NULL,
  "liderId" TEXT,
  "sinGrabar" BOOLEAN NOT NULL DEFAULT false,
  "creadaPorId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SalaDeReuniones_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SalaDeReuniones_workspaceId_fkey" FOREIGN KEY ("workspaceId")
    REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SalaDeReuniones_liderId_fkey" FOREIGN KEY ("liderId")
    REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "SalaDeReuniones_creadaPorId_fkey" FOREIGN KEY ("creadaPorId")
    REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "SalaDeReuniones_codigo_key" ON "SalaDeReuniones"("codigo");
CREATE INDEX IF NOT EXISTS "SalaDeReuniones_workspaceId_idx" ON "SalaDeReuniones"("workspaceId");

ALTER TABLE "Reunion" ADD COLUMN IF NOT EXISTS "salaFijaId" TEXT;
CREATE INDEX IF NOT EXISTS "Reunion_salaFijaId_createdAt_idx" ON "Reunion"("salaFijaId", "createdAt");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Reunion_salaFijaId_fkey') THEN
    ALTER TABLE "Reunion" ADD CONSTRAINT "Reunion_salaFijaId_fkey" FOREIGN KEY ("salaFijaId")
      REFERENCES "SalaDeReuniones"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

COMMIT;
