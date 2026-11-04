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
// envios-gestion.ts se carga igual, con la conexión a Gestión de mentira (no se usa: solo se lee un lugar).
const gestionPath = path.resolve("src/lib/envios-gestion.ts");
const gestionJs = ts.transpileModule(fs.readFileSync(gestionPath, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: gestionPath,
});
const gestion = { exports: {} };
const requireGestion = (nombre) =>
  nombre === "@/lib/sincronizacion-gestion" ? { leerConexionConGestion: async () => null } : require(nombre);
new Function("exports", "require", "module", "__filename", "__dirname", gestionJs.outputText)(
  gestion.exports,
  requireGestion,
  gestion,
  gestionPath,
  path.dirname(gestionPath),
);
const { leerUbicacionDeGestion } = gestion.exports;

const {
  lineaContraentregaDeLista,
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

// Línea de contraentrega de la LISTA (pedido del 4-nov): el dato lo manda Gestión por lugar.
prueba("lista 1: combo + envío $100.000 + precio $989.000 → línea con envío y lo que paga al recibir", () => {
  assert.equal(
    lineaContraentregaDeLista({ envio: "GRATIS", contraentrega: { aplica: true, envio: 100000, alRecibir: 989000 } }),
    "Contraentrega: envío $100.000 (paga al recibir $989.000)",
  );
});

prueba("lista 2: combo sin valor de envío en Gestión → se cotiza", () => {
  assert.equal(
    lineaContraentregaDeLista({ envio: "COTIZAR", contraentrega: { aplica: true, envio: null, alRecibir: 989000 } }),
    "Contraentrega: se cotiza",
  );
});

prueba("lista 3: producto sin contraentrega (silla, lavacabezas) → nada", () => {
  assert.equal(lineaContraentregaDeLista({ envio: "GRATIS", contraentrega: { aplica: false, envio: 100000, alRecibir: 300000 } }), null);
});

prueba("lista 4: lugar \"No llegamos\" → nada, aunque Gestión diga que aplica", () => {
  assert.equal(lineaContraentregaDeLista({ envio: "NO_LLEGA", contraentrega: { aplica: true, envio: 150000, alRecibir: 989000 } }), null);
});

prueba("lista 5: Gestión sin el dato nuevo → nada, y el lugar se lee igual que hoy con contraentrega null", () => {
  assert.equal(lineaContraentregaDeLista({ envio: "GRATIS" }), null);
  assert.equal(lineaContraentregaDeLista({ envio: "GRATIS", contraentrega: null }), null);
  const lugar = leerUbicacionDeGestion({
    tipo: "ciudad",
    id: 11001,
    cityId: 11001,
    nombre: "Bogotá, D.C.",
    ciudad: "Bogotá, D.C.",
    departamento: "Cundinamarca",
    envio: "gratis",
    pendienteRevision: false,
    exacta: true,
    cotizacion: { tipo: "GRATIS", envio: 0, total: 989000 },
  });
  assert.deepEqual(lugar, {
    tipo: "ciudad",
    id: "11001",
    cityId: "11001",
    nombre: "Bogotá, D.C.",
    ciudad: "Bogotá, D.C.",
    departamento: "Cundinamarca",
    envio: "GRATIS",
    pendienteRevision: false,
    exacta: true,
    cotizacion: { tipo: "GRATIS", envio: 0, total: 989000 },
    contraentrega: null,
  });
  const conDato = leerUbicacionDeGestion({ id: 1, cityId: 1, nombre: "Bogotá", envio: "GRATIS", contraentrega: { aplica: true, envio: "100000", alRecibir: 989000 } });
  assert.deepEqual(conDato.contraentrega, { aplica: true, envio: 100000, alRecibir: 989000 });
  assert.equal(lineaContraentregaDeLista(conDato), "Contraentrega: envío $100.000 (paga al recibir $989.000)");
});

prueba("lista 6: dato mal formado → nada, y el lugar no se cae de la lista", () => {
  for (const malo of ["sí", 1, [], { aplica: "true", envio: 100000 }, { envio: 100000 }]) {
    const lugar = leerUbicacionDeGestion({ id: 2, cityId: 2, nombre: "Cali", envio: "GRATIS", contraentrega: malo });
    assert.ok(lugar, `el lugar debería seguir con contraentrega=${JSON.stringify(malo)}`);
    assert.equal(lugar.contraentrega, null);
    assert.equal(lineaContraentregaDeLista(lugar), null);
    assert.equal(lineaContraentregaDeLista({ envio: "GRATIS", contraentrega: malo }), null);
  }
  // Valor de envío imposible (negativo o enorme): no se muestra la cifra, se cotiza.
  assert.equal(lineaContraentregaDeLista({ envio: "GRATIS", contraentrega: { aplica: true, envio: -5, alRecibir: 989000 } }), "Contraentrega: se cotiza");
});

console.log(`\n${pruebas} pruebas OK`);
