/**
 * Ensayo de TODAS las migraciones (prisma/migrations, en orden) sobre un Postgres embebido vacío
 * (PGlite), sin tocar ninguna base real:
 *   npm run test:migraciones-pglite
 *
 * Lo usa el trabajador del Tablero IA (trabajador-tablero/) antes de entregar o subir un cambio con
 * una migración nueva: si alguna falla acá, no sigue. No reemplaza el ensayo en producción dentro de
 * una transacción que se deshace (ese lo hace el trabajador por ssh), ni la prueba con datos previos
 * de cada migración (scripts/check-*-migracion.mjs).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CARPETA = path.join(RAIZ, "prisma", "migrations");

const migraciones = fs
  .readdirSync(CARPETA, { withFileTypes: true })
  .filter((entrada) => entrada.isDirectory() && fs.existsSync(path.join(CARPETA, entrada.name, "migration.sql")))
  .map((entrada) => entrada.name)
  .sort();

const db = new PGlite();
for (const nombre of migraciones) {
  try {
    await db.exec(fs.readFileSync(path.join(CARPETA, nombre, "migration.sql"), "utf8"));
  } catch (error) {
    console.error(`FALLÓ la migración ${nombre}: ${error.message}`);
    await db.close();
    process.exit(1);
  }
}
await db.close();
console.log(`ok - ${migraciones.length} migraciones aplicadas en orden en PGlite`);
