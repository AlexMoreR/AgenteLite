// Pruebas de las reglas de ventas de src/features/agentes-de-area/dominio/reglas.ts: la línea Admin
// nunca suma venta y un teléfono es una sola venta. Correr: npm run test:ventas-sin-admin
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import ts from "typescript";

const sourcePath = path.resolve("src/features/agentes-de-area/dominio/reglas.ts");
const transpiled = ts.transpileModule(fs.readFileSync(sourcePath, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: sourcePath,
});
const mod = { exports: {} };
new Function("exports", "require", "module", transpiled.outputText)(mod.exports, () => ({}), mod);
const { contarEtapasPorAsesora, CANAL_ADMIN_ID } = mod.exports;

const cambio = (asesoraId, conversationId, contactId, canalId, proposito = "SALES", etapaNueva = "GANADO") => ({
  asesoraId, conversationId, contactId, etapaNueva, canalId, proposito,
});
const ventas = (mapa, id) => mapa.get(id)?.ventas ?? 0;

let pruebas = 0;
function prueba(nombre, fn) {
  fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

prueba("mismo teléfono GANADO en Ventas 1 (Yair) y en Admin (Ingrid): 1 venta, a Yair", () => {
  const r = contarEtapasPorAsesora([
    cambio("yair", "c1", "tel573209557509", "ventas1"),
    cambio("ingrid", "c2", "tel573209557509", CANAL_ADMIN_ID, "ADMIN"),
  ]);
  assert.equal(ventas(r, "yair"), 1);
  assert.equal(ventas(r, "ingrid"), 0);
});

prueba("el orden no importa: si Admin llegó primero, igual cuenta Yair", () => {
  const r = contarEtapasPorAsesora([
    cambio("ingrid", "c2", "t", CANAL_ADMIN_ID, "ADMIN"),
    cambio("yair", "c1", "t", "ventas1"),
  ]);
  assert.equal(ventas(r, "yair"), 1);
  assert.equal(ventas(r, "ingrid"), 0);
});

prueba("un chat solo de Admin cuenta 0 (por id fijo aunque purpose esté mal puesto)", () => {
  const r = contarEtapasPorAsesora([cambio("ingrid", "c2", "t", CANAL_ADMIN_ID, "SALES")]);
  assert.equal(r.size, 0);
  const r2 = contarEtapasPorAsesora([cambio("ingrid", "c2", "t", "otraAdmin", "ADMIN")]);
  assert.equal(r2.size, 0);
});

prueba("dos chats de ventas del mismo teléfono cuentan 1", () => {
  const r = contarEtapasPorAsesora([cambio("yair", "c1", "t", "ventas1"), cambio("ana", "c3", "t", "ventas2")]);
  assert.equal(ventas(r, "yair") + ventas(r, "ana"), 1);
});

prueba("una venta normal de Ventas 2 no cambia", () => {
  const r = contarEtapasPorAsesora([cambio("ana", "c4", "t2", "ventas2")]);
  assert.equal(ventas(r, "ana"), 1);
  assert.equal(r.get("ana").cotizaciones, 1);
});

prueba("cotizaciones: Admin no suma y la propuesta que luego se gana no se cuenta doble", () => {
  const r = contarEtapasPorAsesora([
    cambio("yair", "c1", "t", "ventas1", "SALES", "PROPUESTA"),
    cambio("yair", "c1", "t", "ventas1", "SALES", "GANADO"),
    cambio("ingrid", "c2", "t", CANAL_ADMIN_ID, "ADMIN", "NEGOCIACION"),
  ]);
  assert.equal(r.get("yair").cotizaciones, 1);
  assert.equal(r.get("yair").ventas, 1);
  assert.equal(r.has("ingrid"), false);
});

console.log(`${pruebas} pruebas ok`);
