// Pruebas de src/lib/busqueda-de-chats.ts (buscar chats cerrados, con o sin 57).
// Correr: npm run test:busqueda-de-chats
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);
const sourcePath = path.resolve("src/lib/busqueda-de-chats.ts");
const transpiled = ts.transpileModule(fs.readFileSync(sourcePath, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: sourcePath,
});
const mod = { exports: {} };
new Function("exports", "require", "module", "__filename", "__dirname", transpiled.outputText)(
  mod.exports,
  require,
  mod,
  sourcePath,
  path.dirname(sourcePath),
);
const { variantesDeCifras, estadoConBusqueda, whereDeBusquedaDeChats, whereDeBusquedaDeChatsOficiales } = mod.exports;

// Un telefono guardado coincide si alguna variante (o el texto) esta contenida en el.
const encuentra = (escrito, guardado) =>
  guardado.includes(escrito.trim()) || variantesDeCifras(escrito).some((c) => guardado.includes(c));

for (const guardado of ["573012175617", "3012175617"]) {
  for (const escrito of ["3012175617", "573012175617", "+57 301 217 5617", "57 3012175617"]) {
    assert.ok(encuentra(escrito, guardado), `"${escrito}" debe encontrar ${guardado}`);
  }
}
assert.deepEqual(variantesDeCifras("Pedro 2024"), []);
assert.deepEqual(variantesDeCifras("123"), []);

assert.equal(estadoConBusqueda("3012175617", "open"), "all");
assert.equal(estadoConBusqueda("  ", "open"), "open");
assert.equal(estadoConBusqueda("", "resolved"), "resolved");
assert.equal(estadoConBusqueda(undefined, "open"), "open");

// Las dos consultas incluyen la variante sin el 57.
const telefonos = (donde, campo) => donde.OR.map((o) => o.contact?.[campo]?.contains).filter(Boolean);
assert.ok(telefonos(whereDeBusquedaDeChats("573012175617"), "phoneNumber").includes("3012175617"));
assert.ok(telefonos(whereDeBusquedaDeChatsOficiales("57 3012175617"), "waId").includes("3012175617"));

console.log("busqueda-de-chats: OK");
