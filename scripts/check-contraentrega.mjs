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
const {
  esComboDeCamilla,
  envioContraentrega,
  opcionAnticipo,
  opcionContraentrega,
  pesos,
  validarEnvioContraentrega,
  leerEnvioContraentregaGuardado,
  puedeEditarEnvioContraentrega,
  claveEnvioContraentrega,
} = mod.exports;

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

prueba("envío en contraentrega sin valor guardado: nunca valor fijo, se confirma con Ingrid (14-oct)", () => {
  for (const [nombre, envio] of [["Bogotá, D.C.", "GRATIS"], ["Santiago de Cali", "GRATIS"], ["Medellín", "COTIZAR"], ["Pasto", "ADICIONAL"], ["Leticia", "NO_LLEGA"]]) {
    assert.equal(envioContraentrega(ciudad(nombre, envio)), null);
  }
});

prueba("contraentrega del combo en Cali: envío por confirmar, combo al recibir, ofrece el 50 %", () => {
  const r = opcionContraentrega({ ubicacion: ciudad("Santiago de Cali", "GRATIS"), lugar: "Santiago de Cali", producto: combo, anticipoConEnvioGratis: true });
  assert.equal(r.estado, "COTIZAR");
  assert.equal(r.producto, 989000);
  assert.doesNotMatch(r.texto, /150\.000|100\.000/);
  assert.match(r.texto, /costo adicional/);
  assert.match(r.texto, /\*50%\*/);
});

prueba("contraentrega en ciudad no gratis: se cotiza con Ingrid, sin inventar cifra", () => {
  const r = opcionContraentrega({ ubicacion: ciudad("Pasto", "ADICIONAL"), lugar: "Pasto", producto: combo, anticipoConEnvioGratis: false });
  assert.equal(r.estado, "COTIZAR");
  assert.doesNotMatch(r.texto, /150\.000|100\.000/);
  assert.match(r.texto, /te lo confirmo/);
});

prueba("envío guardado por el admin: se usa para esa ubicación; NO_LLEGA o inválido no cuentan", () => {
  assert.equal(envioContraentrega(ciudad("Pasto", "ADICIONAL"), 180000), 180000);
  assert.equal(envioContraentrega(ciudad("Pasto", "ADICIONAL"), null), null);
  assert.equal(envioContraentrega(ciudad("Leticia", "NO_LLEGA"), 180000), null);
  assert.equal(envioContraentrega(ciudad("Pasto", "ADICIONAL"), 0), null);
  assert.equal(envioContraentrega(ciudad("Pasto", "ADICIONAL"), 2000000), null);
});

prueba("contraentrega con valor guardado: envío por adelantado + combo al recibir + total", () => {
  const r = opcionContraentrega({ ubicacion: ciudad("Pasto", "ADICIONAL"), lugar: "Pasto", producto: combo, anticipoConEnvioGratis: false, envioGuardado: 180000 });
  assert.equal(r.estado, "TOTAL");
  assert.equal(r.envio, 180000);
  assert.equal(r.producto, 989000);
  assert.equal(r.total, 1169000);
  assert.match(r.texto, /\*\$180\.000\*/);
  assert.match(r.texto, /Total: \*\$1\.169\.000\*/);
  const cali = opcionContraentrega({ ubicacion: ciudad("Santiago de Cali", "GRATIS"), lugar: "Santiago de Cali", producto: combo, anticipoConEnvioGratis: true, envioGuardado: 120000 });
  assert.equal(cali.estado, "TOTAL");
  assert.match(cali.texto, /\*50%\*/);
  const silla = opcionContraentrega({ ubicacion: ciudad("Pasto", "ADICIONAL"), lugar: "Pasto", producto: { nombre: "SILLA", precio: 300000, codigo: "SIL01", categoria: "SILLAS" }, anticipoConEnvioGratis: false, envioGuardado: 180000 });
  assert.equal(silla.estado, "NO_APLICA");
});

prueba("validación del valor: entero COP > 0 y < 2.000.000, acepta puntos, comas y $", () => {
  assert.deepEqual(validarEnvioContraentrega("150000"), { ok: true, valor: 150000 });
  assert.deepEqual(validarEnvioContraentrega("$150.000"), { ok: true, valor: 150000 });
  assert.deepEqual(validarEnvioContraentrega("150,000"), { ok: true, valor: 150000 });
  assert.deepEqual(validarEnvioContraentrega(99000), { ok: true, valor: 99000 });
  assert.deepEqual(validarEnvioContraentrega(1999999), { ok: true, valor: 1999999 });
  for (const malo of ["", "abc", "-5000", "0", 0, -1, 1.5, 2000000, "2.000.000", "15e4", null, undefined, {}]) {
    assert.equal(validarEnvioContraentrega(malo).ok, false, `debería rechazar ${JSON.stringify(malo)}`);
  }
});

prueba("lectura de lo guardado: JSON dañado o valor inválido = sin valor", () => {
  const ok = leerEnvioContraentregaGuardado(JSON.stringify({ valor: 150000, nombre: "Pasto", actualizadoPor: "Alex", fecha: "2026-10-15T00:00:00.000Z" }));
  assert.deepEqual(ok, { valor: 150000, nombre: "Pasto", actualizadoPor: "Alex", fecha: "2026-10-15T00:00:00.000Z" });
  assert.equal(leerEnvioContraentregaGuardado(null), null);
  assert.equal(leerEnvioContraentregaGuardado("{roto"), null);
  assert.equal(leerEnvioContraentregaGuardado(JSON.stringify({ valor: "150000" })), null);
  assert.equal(leerEnvioContraentregaGuardado(JSON.stringify({ valor: 5000000 })), null);
});

prueba("quién edita: dueño o administrador; asesora y supervisora no", () => {
  assert.equal(puedeEditarEnvioContraentrega({ isOwner: true, role: "CLIENTE", membershipRole: "OWNER" }), true);
  assert.equal(puedeEditarEnvioContraentrega({ isOwner: false, role: "ADMIN", membershipRole: "AGENT" }), true);
  assert.equal(puedeEditarEnvioContraentrega({ isOwner: false, role: "EMPLEADO", membershipRole: "ADMIN" }), true);
  assert.equal(puedeEditarEnvioContraentrega({ isOwner: false, role: "EMPLEADO", membershipRole: "AGENT" }), false);
  assert.equal(puedeEditarEnvioContraentrega({ isOwner: false, role: "CLIENTE", membershipRole: "VIEWER" }), false);
});

prueba("clave por negocio, tipo e id de Gestión", () => {
  assert.equal(claveEnvioContraentrega("ws1", "ciudad", "abc"), "envio:contraentrega:ws1:ciudad:abc");
  assert.notEqual(claveEnvioContraentrega("ws1", "ciudad", "abc"), claveEnvioContraentrega("ws1", "corregimiento", "abc"));
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
