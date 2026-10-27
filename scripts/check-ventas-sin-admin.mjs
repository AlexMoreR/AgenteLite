// Pruebas de las ventas por asesora: la línea Admin nunca suma y un teléfono es una sola venta.
// Correr: npm run test:ventas-sin-admin
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);
const sourcePath = path.resolve("src/features/agentes-de-area/dominio/reglas.ts");
const transpiled = ts.transpileModule(fs.readFileSync(sourcePath, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: sourcePath,
});
const mod = { exports: {} };
new Function("exports", "require", "module", "__filename", "__dirname", transpiled.outputText)(mod.exports, require, mod, sourcePath, path.dirname(sourcePath));
const { contarEtapasPorAsesora, CANAL_ADMIN_ID } = mod.exports;

const cambio = (o) => ({ conversationId: "c", contactId: "k", asesoraId: "yair", etapaNueva: "GANADO", proposito: "SALES", canalId: "ventas1", ...o });
const ventas = (mapa, id) => mapa.get(id)?.ventas ?? 0;
let n = 0;
const prueba = (nombre, fn) => { fn(); n += 1; console.log(`ok - ${nombre}`); };

prueba("mismo teléfono GANADO en Ventas 1 (Yair) y en Admin (Ingrid): 1 venta, de Yair", () => {
  const m = contarEtapasPorAsesora([
    cambio({ conversationId: "c1", contactId: "573209557509", asesoraId: "yair" }),
    cambio({ conversationId: "c2", contactId: "573209557509", asesoraId: "ingrid", proposito: "ADMIN", canalId: CANAL_ADMIN_ID }),
  ]);
  assert.equal(ventas(m, "yair"), 1);
  assert.equal(ventas(m, "ingrid"), 0);
});
prueba("aunque la Admin llegue primero, la venta es de la línea de ventas", () => {
  const m = contarEtapasPorAsesora([
    cambio({ conversationId: "c2", asesoraId: "ingrid", proposito: "ADMIN", canalId: CANAL_ADMIN_ID }),
    cambio({ conversationId: "c1", asesoraId: "yair" }),
  ]);
  assert.equal(ventas(m, "yair"), 1);
  assert.equal(ventas(m, "ingrid"), 0);
});
prueba("un chat solo de Admin cuenta 0 (también por el id fijo con purpose mal puesto)", () => {
  assert.equal(contarEtapasPorAsesora([cambio({ asesoraId: "ingrid", proposito: "ADMIN", canalId: "otra" })]).size, 0);
  assert.equal(contarEtapasPorAsesora([cambio({ asesoraId: "ingrid", proposito: null, canalId: CANAL_ADMIN_ID })]).size, 0);
});
prueba("dos chats de ventas del mismo teléfono cuentan 1", () => {
  const m = contarEtapasPorAsesora([cambio({ conversationId: "c1" }), cambio({ conversationId: "c2", canalId: "ventas2", asesoraId: "otra" })]);
  assert.equal(ventas(m, "yair") + ventas(m, "otra"), 1);
});
prueba("una venta normal de Ventas 2 no cambia", () => {
  const m = contarEtapasPorAsesora([cambio({ contactId: "z", asesoraId: "ana", canalId: "ventas2" })]);
  assert.equal(ventas(m, "ana"), 1);
  assert.equal(m.get("ana").cotizaciones, 1);
});
prueba("cotizaciones: PROPUESTA y GANADO del mismo cliente cuentan una vez por asesora", () => {
  const m = contarEtapasPorAsesora([cambio({ etapaNueva: "PROPUESTA" }), cambio({ etapaNueva: "GANADO" })]);
  assert.deepEqual(m.get("yair"), { cotizaciones: 1, ventas: 1 });
});
console.log(`\n${n} pruebas pasaron`);
