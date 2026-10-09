-- Coach de ventas: un informe por negocio y dia, y la parte de cada asesora (aciertos, errores,
-- puntaje y pendientes para el dia siguiente). Ver src/features/coach.
--
-- Solo crea dos tablas nuevas: no toca ninguna existente. La unica clave foranea es de la parte de
-- la asesora a su informe (se borran juntas). Sin claves al negocio ni a los usuarios a proposito:
-- es un registro del coach y no tiene por que impedir borrar nada.
BEGIN;

CREATE TABLE IF NOT EXISTS "CoachInforme" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "fecha" TIMESTAMP(3) NOT NULL,
  "estado" TEXT NOT NULL DEFAULT 'EN_CURSO',
  "origen" TEXT NOT NULL DEFAULT 'reloj',
  "versionPolitica" TEXT NOT NULL,
  "modelo" TEXT,
  "resumenEquipo" JSONB,
  "chatsLeidos" INTEGER NOT NULL DEFAULT 0,
  "llamadasIA" INTEGER NOT NULL DEFAULT 0,
  "tokensEntrada" INTEGER NOT NULL DEFAULT 0,
  "tokensSalida" INTEGER NOT NULL DEFAULT 0,
  "costoUsd" DECIMAL(10,4) NOT NULL DEFAULT 0,
  "error" TEXT,
  "iniciadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "terminadoEn" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CoachInforme_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CoachInforme_workspaceId_fecha_key"
  ON "CoachInforme"("workspaceId", "fecha");
CREATE INDEX IF NOT EXISTS "CoachInforme_workspaceId_createdAt_idx"
  ON "CoachInforme"("workspaceId", "createdAt");

CREATE TABLE IF NOT EXISTS "CoachAsesora" (
  "id" TEXT NOT NULL,
  "informeId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "nombre" TEXT NOT NULL,
  "chats" INTEGER NOT NULL DEFAULT 0,
  "puntaje" DECIMAL(4,1),
  "puntajes" JSONB,
  "aciertos" JSONB NOT NULL,
  "errores" JSONB NOT NULL,
  "pendientes" JSONB NOT NULL,
  "resumen" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CoachAsesora_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CoachAsesora_informeId_fkey" FOREIGN KEY ("informeId")
    REFERENCES "CoachInforme"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "CoachAsesora_informeId_userId_key"
  ON "CoachAsesora"("informeId", "userId");
CREATE INDEX IF NOT EXISTS "CoachAsesora_workspaceId_userId_createdAt_idx"
  ON "CoachAsesora"("workspaceId", "userId", "createdAt");

COMMIT;
