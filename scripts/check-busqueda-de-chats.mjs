// Pruebas de src/lib/busqueda-de-chats.ts (buscador de la bandeja: numero con/sin 57, estado ignorado al buscar).
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
const { whereDeBusquedaDeChats, whereDeBusquedaDeChatsOficiales, cifrasSinIndicativo, estadoEfectivoConBusqueda } =
  mod.exports;

// Los telefonos que el WHERE intentaria encontrar con `contains`.
function fragmentos(where, campo) {
  return where.OR.flatMap((c) => (c.contact?.[campo] ? [c.contact[campo].contains] : []));
}
// ¿Algun fragmento esta dentro del telefono guardado?
const encuentra = (where, campo, guardado) => fragmentos(where, campo).some((f) => guardado.includes(f));

for (const escrito of ["3012175617", "573012175617", "+57 301 217 5617", "57 3012175617"]) {
  const w = whereDeBusquedaDeChats(escrito);
  assert.ok(encuentra(w, "phoneNumber", "573012175617"), `${escrito} no encuentra 573012175617`);
  assert.ok(encuentra(w, "phoneNumber", "3012175617"), `${escrito} no encuentra 3012175617`);
  const o = whereDeBusquedaDeChatsOficiales(escrito);
  assert.ok(encuentra(o, "waId", "573012175617"), `oficial: ${escrito} no encuentra 573012175617`);
  assert.ok(encuentra(o, "waId", "3012175617"), `oficial: ${escrito} no encuentra 3012175617`);
}

assert.equal(cifrasSinIndicativo("573012175617"), "3012175617");
assert.equal(cifrasSinIndicativo("3012175617"), null);
assert.equal(cifrasSinIndicativo("Pedro 573012175617"), null);
assert.deepEqual(whereDeBusquedaDeChats("  "), {});

// Con busqueda el estado no filtra; sin busqueda queda como estaba.
assert.equal(estadoEfectivoConBusqueda("3012175617", "open"), "all");
assert.equal(estadoEfectivoConBusqueda("Pedro", "resolved"), "all");
assert.equal(estadoEfectivoConBusqueda("", "open"), "open");
assert.equal(estadoEfectivoConBusqueda("   ", "resolved"), "resolved");

console.log("busqueda-de-chats: OK");
