-- Tablero IA, fase 2: el TRABAJADOR (un PC aparte, "aizen1") toma las Tareas aprobadas, arma un plan,
-- lo construye en una rama y, con el sí final del dueño, lo sube. Ver src/features/tableros-inteligentes
-- (services/reglas-trabajador.ts y services/trabajador.ts) y trabajador-tablero/.
--
-- Aditiva: agrega 6 valores al enum "EstadoTarjeta" (FALLIDO se queda), 7 columnas a "TarjetaTablero"
-- (todas nulas o con valor por defecto) y crea dos tablas. No borra, no renombra ni reescribe nada.
--
-- OJO con el enum: un valor agregado con ALTER TYPE ... ADD VALUE no se puede USAR (insertar ni
-- comparar) dentro de la misma transacción. Por eso esta migración NO usa ninguno de los valores nuevos
-- (ni en defaults, ni en CHECK, ni en índices parciales): recién se usan desde el código, ya commiteada.
-- NO SE HA CORRIDO EN PRODUCCION: ensayarla antes dentro de una transaccion que se deshace.
-- Probada con PGlite sobre todas las migraciones y con datos previos: npm run test:tablero-trabajador-migracion
BEGIN;

ALTER TYPE "EstadoTarjeta" ADD VALUE IF NOT EXISTS 'PLANEANDO';
ALTER TYPE "EstadoTarjeta" ADD VALUE IF NOT EXISTS 'PLAN_LISTO';
ALTER TYPE "EstadoTarjeta" ADD VALUE IF NOT EXISTS 'PLAN_APROBADO';
ALTER TYPE "EstadoTarjeta" ADD VALUE IF NOT EXISTS 'POR_REVISAR';
ALTER TYPE "EstadoTarjeta" ADD VALUE IF NOT EXISTS 'SUBIENDO';
ALTER TYPE "EstadoTarjeta" ADD VALUE IF NOT EXISTS 'ERROR';

-- En qué repositorio trabaja (clave de una lista fija en el código: 'gestion', 'aizencrm'); el plan que
-- escribió el trabajador; su resultado ({resumen, pruebas, paso, rama, linkRama, commit, migracion, ...});
-- las zonas protegidas que toca (META_ADS, BOT_VENTAS, LIBRO_V3: solo se aprueban en la pantalla); cuántas
-- veces la tomó; y el candado del trabajador (desde cuándo y hasta cuándo la tiene).
ALTER TABLE "TarjetaTablero" ADD COLUMN IF NOT EXISTS "repo" TEXT;
ALTER TABLE "TarjetaTablero" ADD COLUMN IF NOT EXISTS "plan" TEXT;
ALTER TABLE "TarjetaTablero" ADD COLUMN IF NOT EXISTS "resultado" JSONB;
ALTER TABLE "TarjetaTablero" ADD COLUMN IF NOT EXISTS "zonaProtegida" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "TarjetaTablero" ADD COLUMN IF NOT EXISTS "intentos" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "TarjetaTablero" ADD COLUMN IF NOT EXISTS "trabajoIniciadoEn" TIMESTAMP(3);
ALTER TABLE "TarjetaTablero" ADD COLUMN IF NOT EXISTS "trabajoVenceEn" TIMESTAMP(3);

-- Quién más (además del dueño) puede aprobar tarjetas de un negocio. alcance: TODO | DESARROLLO (solo
-- tarjetas con repo 'gestion' o 'aizencrm'). puedeSubir queda guardado, pero HOY el sí final lo da solo
-- el dueño (regla en el código: SI_FINAL_SOLO_DUENO en services/reglas-trabajador.ts).
CREATE TABLE IF NOT EXISTS "AprobadorTablero" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "alcance" TEXT NOT NULL DEFAULT 'DESARROLLO',
  "puedeSubir" BOOLEAN NOT NULL DEFAULT false,
  "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AprobadorTablero_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AprobadorTablero_alcance_check" CHECK ("alcance" IN ('TODO', 'DESARROLLO')),
  CONSTRAINT "AprobadorTablero_workspaceId_fkey" FOREIGN KEY ("workspaceId")
    REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AprobadorTablero_userId_fkey" FOREIGN KEY ("userId")
    REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "AprobadorTablero_workspaceId_userId_key"
  ON "AprobadorTablero"("workspaceId", "userId");
CREATE INDEX IF NOT EXISTS "AprobadorTablero_userId_idx" ON "AprobadorTablero"("userId");

-- La clave con que el trabajador entra a /api/trabajador/tablero/*. Se guarda solo su huella (sha256):
-- la clave se muestra UNA vez al crearla. Revocar = poner revocadaEn (no se borra: queda el rastro).
CREATE TABLE IF NOT EXISTS "ClaveTrabajador" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "nombre" TEXT NOT NULL,
  "hash" TEXT NOT NULL,
  "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ultimoUsoEn" TIMESTAMP(3),
  "revocadaEn" TIMESTAMP(3),
  CONSTRAINT "ClaveTrabajador_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ClaveTrabajador_workspaceId_fkey" FOREIGN KEY ("workspaceId")
    REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "ClaveTrabajador_hash_key" ON "ClaveTrabajador"("hash");
CREATE INDEX IF NOT EXISTS "ClaveTrabajador_workspaceId_idx" ON "ClaveTrabajador"("workspaceId");

COMMIT;
