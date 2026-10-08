// Pruebas de src/lib/contraentrega.ts (50 % anticipo y contraentrega del panel de envío, política de
// Alex del 07-10-2026). Correr: npm run test:contraentrega
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);
const sourcePath = path.resolve("src/lib/contraentrega.ts");
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
const { ENVIO_CONTRAENTREGA, esComboDeCamilla, envioContraentrega, opcionAnticipo, opcionContraentrega, pesos } =
  mod.exports;

let pruebas = 0;
function prueba(nombre, fn) {
  fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const combo = { nombre: "COMBO CAMILLA DIVAN", precio: 989000, codigo: "CMB05", categoria: "COMBO DE CAMILLAS" };
const silla = { nombre: "SILLA NEUMATICA", precio: 300000, codigo: "SIL01", categoria: "SILLAS" };
const ciudad = (nombre, envio) => ({ tipo: "ciudad", nombre, ciudad: nombre, envio });

prueba("valores de la política", () => {
  assert.equal(ENVIO_CONTRAENTREGA.bogota, 100000);
  assert.equal(ENVIO_CONTRAENTREGA.ciudadGratis, 150000);
  assert.equal(pesos(1139000), "$1.139.000");
});

prueba("combo de camilla por categoría o, sin categoría, por código CMB", () => {
  assert.equal(esComboDeCamilla(combo), true);
  assert.equal(esComboDeCamilla({ codigo: "CMB14", categoria: "Combo de Camillas" }), true);
  assert.equal(esComboDeCamilla({ codigo: "CMB05", categoria: null }), true);
  assert.equal(esComboDeCamilla(silla), false);
  assert.equal(esComboDeCamilla({ codigo: "MYS01", categoria: "COMBO MESAS Y SILLAS" }), false);
  assert.equal(esComboDeCamilla(null), false);
});

prueba("envío en contraentrega: Bogotá 100.000, ciudades gratis 150.000, resto se cotiza", () => {
  assert.equal(envioContraentrega(ciudad("Bogotá, D.C.", "GRATIS")), 100000);
  assert.equal(envioContraentrega(ciudad("Bogotá, D.C.", "COTIZAR")), 100000);
  assert.equal(envioContraentrega(ciudad("Santiago de Cali", "GRATIS")), 150000);
  assert.equal(envioContraentrega(ciudad("Medellín", "COTIZAR")), 150000);
  assert.equal(envioContraentrega(ciudad("Bucaramanga", "GRATIS")), 150000);
  assert.equal(envioContraentrega(ciudad("Pasto", "ADICIONAL")), null);
  assert.equal(envioContraentrega(ciudad("Morroa", "COTIZAR")), null);
  assert.equal(envioContraentrega(ciudad("Leticia", "NO_LLEGA")), null);
  // Corregimiento de Bogotá: vale Bogotá solo si Gestión lo tiene como gratis.
  assert.equal(envioContraentrega({ tipo: "corregimiento", nombre: "Usme", ciudad: "Bogotá, D.C.", envio: "GRATIS" }), 100000);
  assert.equal(envioContraentrega({ tipo: "corregimiento", nombre: "Sumapaz", ciudad: "Bogotá, D.C.", envio: "COTIZAR" }), null);
  // Sabanas de Cali (Morroa) NO es Cali.
  assert.equal(envioContraentrega({ tipo: "corregimiento", nombre: "Sabanas de Cali", ciudad: "Morroa", envio: "COTIZAR" }), null);
});

prueba("contraentrega del combo en Bogotá: un solo mensaje con el total", () => {
  const r = opcionContraentrega({ ubicacion: ciudad("Bogotá, D.C.", "GRATIS"), lugar: "Bogotá, D.C.", producto: combo, anticipoConEnvioGratis: true });
  assert.equal(r.estado, "TOTAL");
  assert.equal(r.envio, 100000);
  assert.equal(r.total, 1089000);
  assert.match(r.texto, /\$100\.000/);
  assert.match(r.texto, /\$989\.000/);
  assert.match(r.texto, /Total: \*\$1\.089\.000\*/);
  assert.match(r.texto, /envío te sale \*gratis\*/);
});

prueba("contraentrega del combo en Cali: 150.000 + combo", () => {
  const r = opcionContraentrega({ ubicacion: ciudad("Santiago de Cali", "GRATIS"), lugar: "Santiago de Cali", producto: combo, anticipoConEnvioGratis: true });
  assert.equal(r.estado, "TOTAL");
  assert.equal(r.total, 1139000);
});

prueba("contraentrega en ciudad no gratis: se cotiza con Ingrid, sin inventar cifra", () => {
  const r = opcionContraentrega({ ubicacion: ciudad("Pasto", "ADICIONAL"), lugar: "Pasto", producto: combo, anticipoConEnvioGratis: false });
  assert.equal(r.estado, "COTIZAR");
  assert.doesNotMatch(r.texto, /150\.000|100\.000/);
  assert.match(r.texto, /te lo cotizo/);
});

prueba("otros productos no tienen contraentrega", () => {
  const r = opcionContraentrega({ ubicacion: ciudad("Santiago de Cali", "GRATIS"), lugar: "Cali", producto: silla, anticipoConEnvioGratis: true });
  assert.deepEqual(r, { estado: "NO_APLICA", motivo: "Este producto no tiene contraentrega" });
  const sin = opcionContraentrega({ ubicacion: ciudad("Santiago de Cali", "GRATIS"), lugar: "Cali", producto: null, anticipoConEnvioGratis: true });
  assert.equal(sin.estado, "NO_APLICA");
  const noLlega = opcionContraentrega({ ubicacion: ciudad("Leticia", "NO_LLEGA"), lugar: "Leticia", producto: combo, anticipoConEnvioGratis: false });
  assert.equal(noLlega.estado, "NO_APLICA");
});

prueba("50 % anticipo en ciudad gratis: total, separar y envío gratis", () => {
  const r = opcionAnticipo({ estado: "GRATIS", lugar: "Medellín", producto: "COMBO CAMILLA DIVAN", total: 989000, precio: 989000 });
  assert.equal(r.estado, "TOTAL");
  assert.equal(r.separar, 494500);
  assert.equal(r.envioGratis, true);
  assert.match(r.texto, /\*\$989\.000\* en total/);
  assert.match(r.texto, /\*\$494\.500\*/);
  assert.match(r.texto, /gratis/);
});

prueba("50 % anticipo con envío adicional: total con envío incluido", () => {
  const r = opcionAnticipo({ estado: "ADICIONAL", lugar: "Pasto", producto: "COMBO CAMILLA DIVAN", total: 1089000, precio: 989000 });
  assert.equal(r.estado, "TOTAL");
  assert.equal(r.envio, 100000);
  assert.equal(r.envioGratis, false);
  assert.equal(r.separar, 544500);
  assert.match(r.texto, /incluido/);
});

prueba("50 % anticipo sin total o sin producto: ofrece cotizar; no llega: lo dice", () => {
  assert.equal(opcionAnticipo({ estado: "GRATIS", lugar: "X", producto: null, total: 989000, precio: 989000 }).estado, "COTIZAR");
  assert.equal(opcionAnticipo({ estado: "ADICIONAL", lugar: "X", producto: "Silla", total: null, precio: 1 }).estado, "COTIZAR");
  assert.equal(opcionAnticipo({ estado: "COTIZAR", lugar: "Morroa", producto: "Silla", total: null, precio: 1 }).estado, "COTIZAR");
  const no = opcionAnticipo({ estado: "NO_LLEGA", lugar: "Leticia", producto: "Silla", total: null, precio: 1 });
  assert.equal(no.estado, "NO_LLEGA");
  assert.match(no.texto, /no tenemos envío a \*Leticia\*/);
});

console.log(`\n${pruebas} pruebas OK`);
