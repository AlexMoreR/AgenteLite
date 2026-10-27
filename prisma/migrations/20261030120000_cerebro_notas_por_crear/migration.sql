-- Cerebro: notas NUEVAS que crea aizen1 (el PC del dueño). La cuenta de servicio de Google no puede crear archivos en un
-- Drive personal (403 storageQuotaExceeded); editar sí. Cuando hay que crear una nota, el CRM deja aquí el pedido
-- (ruta dentro de la carpeta del cerebro + contenido) y el Coordinador de aizen1 la escribe en la bóveda local, que
-- Google Drive para escritorio sube a nombre del dueño. Estado: PENDIENTE -> CREADA | ERROR (con motivo).
-- Solo aditiva (una tabla nueva y sus índices) y se puede correr dos veces.
BEGIN;

CREATE TABLE IF NOT EXISTS "CerebroNotaPorCrear" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "ruta" TEXT NOT NULL,
    "contenido" TEXT NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'PENDIENTE',
    "motivo" TEXT,
    "userId" TEXT,
    "quienNombre" TEXT,
    "origen" TEXT NOT NULL,
    "tarjetaId" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creadaEn" TIMESTAMP(3),

    CONSTRAINT "CerebroNotaPorCrear_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CerebroNotaPorCrear_workspaceId_estado_creadoEn_idx" ON "CerebroNotaPorCrear"("workspaceId", "estado", "creadoEn");

COMMIT;
