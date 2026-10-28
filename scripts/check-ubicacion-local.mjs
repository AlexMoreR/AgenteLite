// Prueba del rótulo del pin de "Enviar local" (src/lib/evolution.ts). En WAHA el rótulo es la dirección escrita y,
// sin dirección, el nombre; la ruta de Evolution manda name y address aparte. Sin base ni red. 28-10-2026.
import assert from "node:assert/strict";
import fs from "node:fs";

const evo = fs.readFileSync("src/lib/evolution.ts", "utf8");
const fn = evo.slice(evo.indexOf("export async function sendEvolutionLocationMessage"));
const cuerpo = fn.slice(0, fn.indexOf("export async function deleteEvolutionMessageForEveryone"));

assert.match(cuerpo, /titulo: input\.address\?\.trim\(\) \|\| input\.name\?\.trim\(\) \|\| null/, "WAHA: rótulo = dirección, si no nombre");
assert.match(cuerpo, /latitud: input\.latitude,\s*longitud: input\.longitude/, "WAHA: coordenadas completas");
assert.match(cuerpo, /body = \{[^}]*name,[^}]*address,[^}]*latitude: input\.latitude,[^}]*longitude: input\.longitude/s, "Evolution: name y address aparte");

// Misma regla del rótulo, ejecutada.
const titulo = (a, n) => a?.trim() || n?.trim() || null;
assert.equal(titulo("Carrera 27 # 72 x 25, Omar Torrijos, Cali", "Magilus"), "Carrera 27 # 72 x 25, Omar Torrijos, Cali");
assert.equal(titulo("", "Magilus"), "Magilus");
assert.equal(titulo(null, null), null);

const accion = fs.readFileSync("src/app/actions/agent-actions.ts", "utf8");
assert.match(accion.slice(accion.indexOf("export async function sendChatLocationReplyAction")), /address: address \|\| null/, "la dirección llega al envío");

console.log("ubicación local (rótulo): OK");
