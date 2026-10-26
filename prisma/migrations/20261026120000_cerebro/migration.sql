-- Cerebro: copia en la base de la carpeta de Google Drive del negocio, la conexión y el registro de escrituras.
-- Solo aditiva (tablas nuevas) y se puede correr dos veces.
BEGIN;

CREATE TABLE IF NOT EXISTS "CerebroConexion" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "cuentaGoogle" TEXT,
    "tokenCifrado" TEXT,
    "carpetaId" TEXT,
    "carpetaNombre" TEXT,
    "conectadoPor" TEXT,
    "ultimaSincronizacion" TIMESTAMP(3),
    "ultimoError" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CerebroConexion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CerebroDocumento" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "driveId" TEXT NOT NULL,
    "padreId" TEXT,
    "nombre" TEXT NOT NULL,
    "ruta" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "esCarpeta" BOOLEAN NOT NULL DEFAULT false,
    "modificadoEnDrive" TIMESTAMP(3),
    "versionDrive" TEXT,
    "linkDrive" TEXT,
    "texto" TEXT,
    "textoTruncado" BOOLEAN NOT NULL DEFAULT false,
    "enDrive" BOOLEAN NOT NULL DEFAULT true,
    "sincronizadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CerebroDocumento_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CerebroCambio" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "quienNombre" TEXT NOT NULL,
    "origen" TEXT NOT NULL,
    "driveId" TEXT NOT NULL,
    "nombreDocumento" TEXT NOT NULL,
    "accion" TEXT NOT NULL,
    "antes" TEXT,
    "despues" TEXT NOT NULL,
    "textoConfirmacion" TEXT,
    "tarjetaId" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CerebroCambio_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CerebroConexion_workspaceId_key" ON "CerebroConexion"("workspaceId");
CREATE UNIQUE INDEX IF NOT EXISTS "CerebroDocumento_workspaceId_driveId_key" ON "CerebroDocumento"("workspaceId", "driveId");
CREATE INDEX IF NOT EXISTS "CerebroDocumento_workspaceId_padreId_idx" ON "CerebroDocumento"("workspaceId", "padreId");
CREATE INDEX IF NOT EXISTS "CerebroDocumento_workspaceId_enDrive_idx" ON "CerebroDocumento"("workspaceId", "enDrive");
CREATE INDEX IF NOT EXISTS "CerebroCambio_workspaceId_creadoEn_idx" ON "CerebroCambio"("workspaceId", "creadoEn");
CREATE INDEX IF NOT EXISTS "CerebroCambio_workspaceId_driveId_idx" ON "CerebroCambio"("workspaceId", "driveId");

COMMIT;
