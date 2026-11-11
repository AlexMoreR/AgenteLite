/**
 * Prueba de la migración de respuestas rápidas de la empresa (prisma/migrations/20261116000200_respuesta_rapida_de_empresa)
 * contra un Postgres embebido (PGlite), sin tocar ninguna base real:
 *   npm run test:respuesta-rapida-empresa-migracion
 *
 * 1. Aplica las migraciones reales anteriores y crea 3 respuestas (dos con dueña, una sin repartir).
 * 2. Aplica la nueva: las 3 siguen ahí, con su título, su mensaje y su dueña, y las 3 son de la empresa.
 * 3. Una respuesta nueva nace como NO de la empresa.
 * 4. El SQL no tiene DROP, DELETE, TRUNCATE ni ALTER ... TYPE.
 * 5. Se vuelve a aplicar sin error y sin pisar lo cambiado después (la nueva sigue sin ser de la empresa).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CARPETA = path.join(RAIZ, "prisma", "migrations");
const NUEVA = "20261116000200_respuesta_rapida_de_empresa";

const migraciones = fs
  .readdirSync(CARPETA, { withFileTypes: true })
  .filter((entrada) => entrada.isDirectory())
  .map((entrada) => entrada.name)
  .sort();
assert.ok(migraciones.includes(NUEVA), `falta la migración ${NUEVA}`);

const leer = (nombre) => fs.readFileSync(path.join(CARPETA, nombre, "migration.sql"), "utf8");
const db = new PGlite();
let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}
const filas = async (texto, valores = []) => (await db.query(texto, valores)).rows;

for (const nombre of migraciones) {
  if (nombre === NUEVA) break;
  try {
    await db.exec(leer(nombre));
  } catch (fallo) {
    // La de trigramas necesita una extension que PGlite no trae; no toca QuickReply.
    if (nombre.includes("busqueda_por_texto")) continue;
    throw new Error(`La migración ${nombre} falló en PGlite: ${fallo.message}`);
  }
}

await db.exec(`
  INSERT INTO "User" ("id", "email", "password", "updatedAt") VALUES ('u1', 'u1@x.co', 'x', now()), ('u2', 'u2@x.co', 'x', now());
  INSERT INTO "Workspace" ("id", "name", "slug", "updatedAt") VALUES ('ws1', 'Magilus', 'magilus', now());
  INSERT INTO "QuickReply" ("id", "workspaceId", "title", "content", "updatedAt", "duenaId") VALUES
    ('r1', 'ws1', 'Saludo', 'Hola', now(), 'u1'),
    ('r2', 'ws1', 'Saludo', 'Hola', now(), 'u2'),
    ('r3', 'ws1', 'Precios', 'Lista de precios', now(), NULL);
`);

const sql = leer(NUEVA);
await db.exec(sql);

await prueba("no se pierde ninguna y todas quedan de la empresa, con su dueña", async () => {
  const todas = await filas(`SELECT "id", "title", "content", "duenaId", "deEmpresa" FROM "QuickReply" ORDER BY "id"`);
  assert.deepEqual(todas, [
    { id: "r1", title: "Saludo", content: "Hola", duenaId: "u1", deEmpresa: true },
    { id: "r2", title: "Saludo", content: "Hola", duenaId: "u2", deEmpresa: true },
    { id: "r3", title: "Precios", content: "Lista de precios", duenaId: null, deEmpresa: true },
  ]);
});

await prueba("una respuesta nueva nace sin ser de la empresa", async () => {
  await db.exec(`INSERT INTO "QuickReply" ("id", "workspaceId", "title", "content", "updatedAt", "duenaId") VALUES ('r4', 'ws1', 'Mía', 'Texto', now(), 'u1')`);
  const [nueva] = await filas(`SELECT "deEmpresa" FROM "QuickReply" WHERE "id" = 'r4'`);
  assert.equal(nueva.deEmpresa, false);
});

await prueba("el SQL no borra ni cambia tipos", async () => {
  const sinComentarios = sql.replace(/--.*$/gm, "");
  assert.doesNotMatch(sinComentarios, /\b(DROP|DELETE|TRUNCATE)\b/i);
  assert.doesNotMatch(sinComentarios, /ALTER\s+COLUMN[^;]*TYPE/i);
});

await prueba("se puede correr dos veces sin pisar lo de despues", async () => {
  await db.exec(sql);
  const [nueva] = await filas(`SELECT "deEmpresa" FROM "QuickReply" WHERE "id" = 'r4'`);
  assert.equal(nueva.deEmpresa, false, "la segunda corrida no marca de nuevo");
  const [{ total }] = await filas(`SELECT count(*)::int AS total FROM "QuickReply"`);
  assert.equal(total, 4);
});

console.log(`\n${pruebas} pruebas ok`);
