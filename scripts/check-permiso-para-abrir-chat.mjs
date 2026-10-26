// Pruebas de la regla "¿puede abrir este chat?" (?chatKey= y /api/cliente/chats/live).
// Correr: npm run test:permiso-abrir-chat
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import ts from "typescript";

const archivo = path.resolve("src/features/chats/services/permiso-para-abrir-chat.ts");
const js = ts.transpileModule(fs.readFileSync(archivo, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { puedeAbrirChat } = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);

const VENTAS = "canal-ventas";
const ADMIN = "canal-administrativo";
const OFICIAL = "canal-oficial";

const base = { esDuenoOAdmin: false, esJefe: false, canalesMonitoreados: [] };
const asesora = { ...base, userId: "maria", canalesVisibles: [VENTAS, OFICIAL] };
const dueno = { ...base, userId: "alex", esDuenoOAdmin: true, esJefe: true, canalesVisibles: null };
const supervisora = { ...base, userId: "sup", esJefe: true, canalesVisibles: [VENTAS] };
const monitora = { ...base, userId: "mon", canalesVisibles: [VENTAS, ADMIN], canalesMonitoreados: [VENTAS] };

let n = 0;
function prueba(nombre, fn) {
  fn();
  n += 1;
  console.log(`ok - ${nombre}`);
}

prueba("asesora con el chat de otra asesora: no", () =>
  assert.equal(puedeAbrirChat(asesora, { channelId: VENTAS, assignedToUserId: "ingrid" }), false));
prueba("asesora con un chat sin asignar: no", () =>
  assert.equal(puedeAbrirChat(asesora, { channelId: VENTAS, assignedToUserId: null }), false));
prueba("asesora con un chat de una linea que no ve: no", () =>
  assert.equal(puedeAbrirChat(asesora, { channelId: ADMIN, assignedToUserId: "maria" }), false));
prueba("asesora con su propio chat: si", () =>
  assert.equal(puedeAbrirChat(asesora, { channelId: VENTAS, assignedToUserId: "maria" }), true));
prueba("dueño y administradora con cualquier chat: si", () => {
  assert.equal(puedeAbrirChat(dueno, { channelId: ADMIN, assignedToUserId: "ingrid" }), true);
  assert.equal(puedeAbrirChat(dueno, { channelId: null, assignedToUserId: null }), true);
});
prueba("supervisora: chat de otra asesora en su linea si, en otra linea no", () => {
  assert.equal(puedeAbrirChat(supervisora, { channelId: VENTAS, assignedToUserId: "ingrid" }), true);
  assert.equal(puedeAbrirChat(supervisora, { channelId: ADMIN, assignedToUserId: "ingrid" }), false);
});
prueba("quien monitorea: linea monitoreada si (de quien sea), fuera de ella no", () => {
  assert.equal(puedeAbrirChat(monitora, { channelId: VENTAS, assignedToUserId: "ingrid" }), true);
  assert.equal(puedeAbrirChat(monitora, { channelId: ADMIN, assignedToUserId: "mon" }), false);
});
prueba("chat oficial con la linea oficial no visible: no", () => {
  const sinOficial = { ...asesora, canalesVisibles: [VENTAS] };
  assert.equal(puedeAbrirChat(sinOficial, { channelId: OFICIAL, assignedToUserId: "maria" }), false);
  assert.equal(puedeAbrirChat(asesora, { channelId: OFICIAL, assignedToUserId: "maria" }), true);
});
prueba("chat sin linea conocida: no para quien no es jefe total", () =>
  assert.equal(puedeAbrirChat(supervisora, { channelId: null, assignedToUserId: null }), false));

console.log(`\n${n} pruebas OK`);
