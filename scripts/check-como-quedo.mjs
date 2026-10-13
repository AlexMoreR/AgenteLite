// Pruebas de src/lib/llamada-pide-resultado.ts: a proveedores, equipo y clientes GANADO no se les
// pide "¿Cómo quedó?" (Alex, 13-10-2026). Correr: npm run test:como-quedo
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);
const sourcePath = path.resolve("src/lib/llamada-pide-resultado.ts");
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
const { llamadaPideResultado, normalizarEtiqueta, contactoDesdePrisma } = mod.exports;

let pruebas = 0;
function prueba(nombre, fn) {
  fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const tag = (name, slug = null) => ({ Tag: { name, slug } });

prueba("lead normal sí pide resultado", () => {
  assert.equal(llamadaPideResultado({ crmStage: "NEGOCIACION", etiquetas: [] }), true);
  assert.equal(llamadaPideResultado({ crmStage: "NUEVO", etiquetas: ["Cliente VIP", "Bogotá"] }), true);
  assert.equal(llamadaPideResultado({}), true);
  assert.equal(llamadaPideResultado(null), true);
});

prueba("GANADO no pide resultado", () => {
  assert.equal(llamadaPideResultado({ crmStage: "GANADO" }), false);
  assert.equal(llamadaPideResultado({ crmStage: "ganado", etiquetas: [] }), false);
});

prueba("PERDIDO y demás etapas sí piden", () => {
  for (const etapa of ["NUEVO", "CALIFICADO", "PROPUESTA", "NEGOCIACION", "PERDIDO"]) {
    assert.equal(llamadaPideResultado({ crmStage: etapa }), true, etapa);
  }
});

prueba("etiqueta PROVEEDOR / EQUIPO sin importar mayúsculas ni tildes", () => {
  for (const nombre of ["PROVEEDOR", "Proveedor", "proveedor ", "Provéedor", "Proveedores", "EQUIPO", "Equipo", "équipo"]) {
    assert.equal(llamadaPideResultado({ crmStage: "NEGOCIACION", etiquetas: [nombre] }), false, nombre);
  }
});

prueba("etiqueta como objeto Tag (name o slug)", () => {
  assert.equal(llamadaPideResultado({ etiquetas: [{ name: "Proveedor", slug: "proveedor" }] }), false);
  assert.equal(llamadaPideResultado({ etiquetas: [{ name: "Gente de la casa", slug: "equipo" }] }), false);
  assert.equal(llamadaPideResultado({ etiquetas: [{ name: "Interesada", slug: "interesada" }, null] }), true);
});

prueba("no confunde etiquetas parecidas", () => {
  for (const nombre of ["Equipo de spa", "Proveedor de telas", "Equipamiento"]) {
    assert.equal(llamadaPideResultado({ etiquetas: [nombre] }), true, nombre);
  }
});

prueba("contactoDesdePrisma arma la forma de la función", () => {
  const contacto = contactoDesdePrisma({ crmStage: "PROPUESTA", ContactTag: [tag("Bogotá"), tag("EQUIPO", "equipo")] });
  assert.equal(contacto.crmStage, "PROPUESTA");
  assert.equal(llamadaPideResultado(contacto), false);
  assert.equal(llamadaPideResultado(contactoDesdePrisma({ crmStage: "NUEVO", ContactTag: [] })), true);
  assert.equal(contactoDesdePrisma(null), null);
});

prueba("normalizarEtiqueta", () => {
  assert.equal(normalizarEtiqueta("  Provéedor "), "proveedor");
  assert.equal(normalizarEtiqueta(null), "");
});

// Que ninguno de los lugares que piden "¿Cómo quedó?" se haya olvidado del filtro.
prueba("aviso del chat, detalle, lista del equipo y Mi Día usan la función", () => {
  for (const archivo of [
    "src/lib/ultima-llamada.ts",
    "src/app/actions/call-actions.ts",
    "src/features/llamadas/services/getLlamadasData.ts",
  ]) {
    const texto = fs.readFileSync(path.resolve(archivo), "utf8");
    assert.match(texto, /llamadaPideResultado\(/, archivo);
  }
  const acciones = fs.readFileSync(path.resolve("src/app/actions/call-actions.ts"), "utf8");
  assert.doesNotMatch(acciones, /pendiente: isPendingCallResult\(/);
});

console.log(`\n${pruebas} pruebas OK`);
