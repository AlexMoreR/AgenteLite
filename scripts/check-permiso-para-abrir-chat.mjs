// Pruebas de la regla "¿esta persona puede abrir este chat?" (abrir por ?chatKey=).
// Correr: npm run test:permiso-para-abrir-chat
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import ts from "typescript";

const archivo = path.resolve("src/features/chats/services/permiso-para-abrir-chat.ts");
const js = ts.transpileModule(fs.readFileSync(archivo, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { puedeAbrirChat } = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);

let pruebas = 0;
function prueba(nombre, fn) {
  fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const VENTAS = "canal-ventas";
const ADMINISTRATIVA = "canal-administrativa";
const OTRA_LINEA = "canal-otra";
const OFICIAL = "canal-oficial";

// Una asesora comun que ve ventas y oficial, pero no la administrativa.
const asesora = {
  origen: "agent",
  canalIds: [VENTAS],
  asignadoAUserId: "maria",
  userId: "maria",
  canalesVisibles: [VENTAS, OFICIAL],
  esJefeOSupervisora: false,
  canalesMonitoreados: [],
};

prueba("asesora con el chat de otra asesora: no", () => {
  assert.equal(puedeAbrirChat({ ...asesora, asignadoAUserId: "ingrid" }), false);
});
prueba("asesora con un chat sin asignar: no", () => {
  assert.equal(puedeAbrirChat({ ...asesora, asignadoAUserId: null }), false);
});
prueba("asesora con un chat de una linea que no ve (administrativa): no, aunque sea suyo", () => {
  assert.equal(puedeAbrirChat({ ...asesora, canalIds: [ADMINISTRATIVA] }), false);
});
prueba("asesora con un chat sin linea: no", () => {
  assert.equal(puedeAbrirChat({ ...asesora, canalIds: [] }), false);
});
prueba("asesora con su propio chat: si", () => {
  assert.equal(puedeAbrirChat(asesora), true);
});
prueba("dueño y administradora (ven todas las lineas) con cualquier chat: si", () => {
  const jefe = { ...asesora, canalesVisibles: null, esJefeOSupervisora: true };
  assert.equal(puedeAbrirChat({ ...jefe, asignadoAUserId: "ingrid" }), true);
  assert.equal(puedeAbrirChat({ ...jefe, canalIds: [ADMINISTRATIVA], asignadoAUserId: null }), true);
  assert.equal(puedeAbrirChat({ ...jefe, canalIds: [] }), true);
});
prueba("supervisora con un chat de otra asesora en su linea: si; en otra linea: no", () => {
  const supervisora = { ...asesora, userId: "stheffani", esJefeOSupervisora: true };
  assert.equal(puedeAbrirChat({ ...supervisora, asignadoAUserId: "ingrid" }), true);
  assert.equal(puedeAbrirChat({ ...supervisora, canalIds: [ADMINISTRATIVA], asignadoAUserId: "ingrid" }), false);
});
prueba("quien monitorea: chat de una linea que monitorea, de otra asesora o sin dueña: si", () => {
  const monitora = { ...asesora, userId: "laura", canalesVisibles: [VENTAS, OTRA_LINEA], canalesMonitoreados: [VENTAS] };
  assert.equal(puedeAbrirChat({ ...monitora, asignadoAUserId: "ingrid" }), true);
  assert.equal(puedeAbrirChat({ ...monitora, asignadoAUserId: null }), true);
});
prueba("quien monitorea: fuera de sus lineas: no, aunque el chat sea suyo", () => {
  const monitora = { ...asesora, userId: "laura", canalesVisibles: [VENTAS, OTRA_LINEA], canalesMonitoreados: [VENTAS] };
  assert.equal(puedeAbrirChat({ ...monitora, canalIds: [OTRA_LINEA], asignadoAUserId: "laura" }), false);
  assert.equal(puedeAbrirChat({ ...monitora, canalIds: [ADMINISTRATIVA], asignadoAUserId: "ingrid" }), false);
});
prueba("chat oficial con la linea oficial NO visible: no", () => {
  const oficial = { ...asesora, origen: "official", canalIds: [OFICIAL], canalesVisibles: [VENTAS] };
  assert.equal(puedeAbrirChat(oficial), false);
});
prueba("chat oficial: la asesora abre el suyo y no el de otra; el jefe abre cualquiera", () => {
  const oficial = { ...asesora, origen: "official", canalIds: [OFICIAL] };
  assert.equal(puedeAbrirChat(oficial), true);
  assert.equal(puedeAbrirChat({ ...oficial, asignadoAUserId: "ingrid" }), false);
  assert.equal(
    puedeAbrirChat({ ...oficial, asignadoAUserId: "ingrid", canalesVisibles: null, esJefeOSupervisora: true }),
    true,
  );
});
prueba("chat oficial sin linea registrada: solo la regla de la asesora (suyo si, ajeno no)", () => {
  const oficial = { ...asesora, origen: "official", canalIds: [] };
  assert.equal(puedeAbrirChat(oficial), true);
  assert.equal(puedeAbrirChat({ ...oficial, asignadoAUserId: "ingrid" }), false);
});

console.log(`\n${pruebas} pruebas ok`);
