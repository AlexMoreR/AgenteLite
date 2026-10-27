// Pruebas de quien puede abrir un chat por ?chatKey= (seguridad de la bandeja).
// Correr: npm run test:permiso-para-abrir-chat
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import ts from "typescript";

// Solo se prueba la regla pura: se corta el archivo antes de la parte que lee la base.
const archivo = path.resolve("src/features/chats/services/permiso-para-abrir-chat.ts");
const fuente = fs.readFileSync(archivo, "utf8");
const corte = fuente.indexOf("export async function puedeAbrirChatPorClave");
assert.ok(corte > 0, "no se encontro el limite de la regla pura");
const pura = fuente.slice(0, corte).replace(/^import .*$/m, "");
const js = ts.transpileModule(pura, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const m = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);

let pruebas = 0;
function prueba(nombre, fn) {
  fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const VENTAS = "canal-ventas";
const ADMINISTRATIVA = "canal-admin";
const OTRA = "canal-otra";
const OFICIAL = "canal-oficial";

const base = {
  esJefe: false,
  esSupervisora: false,
  userId: "ana",
  canalesVisibles: [VENTAS, OFICIAL],
  canalesMonitoreados: [],
};
const chat = (canalIds, assignedToUserId) => ({ chat: { canalIds, assignedToUserId } });

prueba("asesora con el chat de otra asesora: no", () => {
  assert.equal(m.puedeAbrirChat({ ...base, ...chat([VENTAS], "bea") }), false);
});
prueba("asesora con un chat sin asignar: no", () => {
  assert.equal(m.puedeAbrirChat({ ...base, ...chat([VENTAS], null) }), false);
});
prueba("asesora con un chat de una linea que no ve (administrativa): no", () => {
  assert.equal(m.puedeAbrirChat({ ...base, ...chat([ADMINISTRATIVA], "ana") }), false);
});
prueba("asesora con su propio chat: si", () => {
  assert.equal(m.puedeAbrirChat({ ...base, ...chat([VENTAS], "ana") }), true);
});
prueba("dueño y administradora con cualquier chat: si", () => {
  const jefe = { ...base, esJefe: true, canalesVisibles: null };
  assert.equal(m.puedeAbrirChat({ ...jefe, ...chat([ADMINISTRATIVA], "bea") }), true);
  assert.equal(m.puedeAbrirChat({ ...jefe, ...chat([VENTAS], null) }), true);
});
prueba("supervisora: chat de otra asesora en su linea si, en otra linea no", () => {
  const sup = { ...base, esSupervisora: true };
  assert.equal(m.puedeAbrirChat({ ...sup, ...chat([VENTAS], "bea") }), true);
  assert.equal(m.puedeAbrirChat({ ...sup, ...chat([OTRA], "bea") }), false);
});
prueba("quien monitorea: lineas que vigila si, fuera de ellas no", () => {
  const mon = { ...base, canalesVisibles: [VENTAS, OTRA], canalesMonitoreados: [VENTAS] };
  assert.equal(m.puedeAbrirChat({ ...mon, ...chat([VENTAS], "bea") }), true);
  assert.equal(m.puedeAbrirChat({ ...mon, ...chat([OTRA], "bea") }), false);
});
prueba("chat oficial: con la linea oficial visible y asignado a ella si; ajeno no", () => {
  assert.equal(m.puedeAbrirChat({ ...base, ...chat([OFICIAL], "ana") }), true);
  assert.equal(m.puedeAbrirChat({ ...base, ...chat([OFICIAL], "bea") }), false);
});
prueba("chat oficial con la linea oficial no visible: no", () => {
  assert.equal(m.puedeAbrirChat({ ...base, canalesVisibles: [VENTAS], ...chat([OFICIAL], "ana") }), false);
});
prueba("chat sin linea (canal borrado): no para quien no es jefe", () => {
  assert.equal(m.puedeAbrirChat({ ...base, ...chat([], "ana") }), false);
});

console.log(`${pruebas} pruebas ok`);
