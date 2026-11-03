-- Coach de ventas con Opus (parte 1, 3-nov-2026): la revisión diaria de los chats de UNA asesora,
-- escrita por Opus desde aizen1. Una fila por negocio, día (AAAA-MM-DD) y asesora.
--
-- Solo aditiva: crea una tabla nueva y sus dos índices. No toca ninguna tabla existente ni lleva
-- llaves foráneas (es un registro del coach y no tiene por qué impedir borrar nada).
-- No reemplaza al Coach viejo (CoachInforme / CoachAsesora), que sigue igual.
BEGIN;

CREATE TABLE IF NOT EXISTS "CoachRevision" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "fecha" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "nombre" TEXT NOT NULL,
  "modelo" TEXT NOT NULL,
  "resumen" TEXT NOT NULL,
  "chats" JSONB NOT NULL,
  "chatsLeidos" INTEGER NOT NULL DEFAULT 0,
  "avisadoEn" TIMESTAMP(3),
  "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actualizadoEn" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CoachRevision_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CoachRevision_workspaceId_fecha_userId_key"
  ON "CoachRevision"("workspaceId", "fecha", "userId");
CREATE INDEX IF NOT EXISTS "CoachRevision_workspaceId_userId_fecha_idx"
  ON "CoachRevision"("workspaceId", "userId", "fecha");

COMMIT;
