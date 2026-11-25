import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// La consulta de la última acción por persona (pantalla Equipo) no puede volver a recorrer todos los
// mensajes de 30 días: va por persona, por el índice parcial, con LIMIT 1 y con tope de 5 s.
const raiz = path.resolve(__dirname, "..");
const actividad = fs.readFileSync(path.join(raiz, "src/features/actividad/services/actividad.ts"), "utf8");

const inicio = actividad.indexOf("export async function ultimaAccionPorPersona");
assert.ok(inicio >= 0, "actividad.ts debe tener ultimaAccionPorPersona");
const fin = actividad.indexOf("\nexport async function", inicio + 1);
const funcion = actividad.slice(inicio, fin === -1 ? undefined : fin);

assert.ok(!actividad.includes('DISTINCT ON (m."rawPayload"'), 'actividad.ts no debe usar DISTINCT ON (m."rawPayload"...)');
for (const pedazo of ["LATERAL", "LIMIT 1", '"workspaceId" =', '"createdAt" >=', "statement_timeout"]) {
  assert.ok(funcion.includes(pedazo), `ultimaAccionPorPersona debe tener ${pedazo}`);
}
assert.ok(funcion.includes("userIds: string[]"), "ultimaAccionPorPersona debe recibir userIds");
assert.match(funcion, /userIds\.length === 0\) return new Map\(\)/, "sin personas no se consulta");
assert.match(funcion, /SET LOCAL statement_timeout = '5s'/, "el tope es de 5 s");
assert.match(funcion, /console\.warn/, "si falla o se pasa de tiempo, avisa y devuelve un Map vacío");

// La migración: solo BEGIN, dos CREATE INDEX IF NOT EXISTS y COMMIT (los comentarios no cuentan).
const migracion = fs.readFileSync(
  path.join(raiz, "prisma/migrations/20261125000000_indices_ultima_accion/migration.sql"),
  "utf8",
);
const sentencias = migracion
  .split("\n")
  .filter((linea) => !linea.trim().startsWith("--"))
  .join("\n")
  .split(";")
  .map((sentencia) => sentencia.replace(/\s+/g, " ").trim())
  .filter(Boolean);
assert.equal(sentencias.length, 4, "la migración tiene 4 sentencias");
assert.equal(sentencias[0], "BEGIN");
assert.equal(sentencias[3], "COMMIT");
assert.ok(sentencias[1].startsWith('CREATE INDEX IF NOT EXISTS "Message_ultima_accion_enviado_idx" ON "Message"'));
assert.ok(sentencias[2].startsWith('CREATE INDEX IF NOT EXISTS "Message_ultima_accion_actor_idx" ON "Message"'));
assert.doesNotMatch(migracion, /drop|delete|update|truncate|rename/i, "la migración solo agrega");

console.log("pruebas de la consulta de la última acción: OK");
