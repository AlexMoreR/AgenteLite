-- Espacio (antes Tablero IA): bases de datos (28-nov-2026). Aditiva: dos tablas nuevas, nada de lo que existe cambia.
-- Una base de datos es una tarjeta del tipo «Base de datos» (el tipo se crea solo en cada espacio la primera vez):
-- BaseDeDatosTarjeta guarda sus columnas y FilaBaseDeDatos sus filas. Borrar la tarjeta (de verdad) borra todo.
-- Probada con PGlite sobre todas las migraciones: npm run test:migraciones-pglite
BEGIN;

CREATE TABLE IF NOT EXISTS "BaseDeDatosTarjeta" (
    "tarjetaId" TEXT NOT NULL,
    "columnas" JSONB NOT NULL DEFAULT '[]',
    "siguienteNumero" INTEGER NOT NULL DEFAULT 1,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BaseDeDatosTarjeta_pkey" PRIMARY KEY ("tarjetaId"),
    CONSTRAINT "BaseDeDatosTarjeta_tarjetaId_fkey" FOREIGN KEY ("tarjetaId") REFERENCES "TarjetaTablero"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "FilaBaseDeDatos" (
    "id" TEXT NOT NULL,
    "baseId" TEXT NOT NULL,
    "numero" INTEGER NOT NULL,
    "valores" JSONB NOT NULL DEFAULT '{}',
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FilaBaseDeDatos_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "FilaBaseDeDatos_baseId_fkey" FOREIGN KEY ("baseId") REFERENCES "BaseDeDatosTarjeta"("tarjetaId") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "FilaBaseDeDatos_baseId_numero_key" ON "FilaBaseDeDatos"("baseId", "numero");

COMMIT;
