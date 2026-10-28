// Pruebas del botón "Ubicación" del chat (src/lib/workspace-business-config.ts): el pin abre el punto exacto por
// coordenadas, no busca "Magilus" en Google Maps, y debajo va solo la dirección escrita, sin link de Maps (su vista
// previa salía con un mapa de Europa). 28-10-2026. Sin base ni red. Correr: npm run test:ubicacion-del-local
import assert from "node:assert/strict";
import fs from "node:fs";

import { cargar } from "./supervisor-cargar.mjs";

const cfg = cargar("src/lib/workspace-business-config.ts");

assert.equal(
  cfg.textoDeLaUbicacionDelLocal({ nombre: "Magilus", direccion: "Carrera 27 # 72 x 25, Omar Torrijos, Cali" }),
  "📍 Magilus - Carrera 27 # 72 x 25, Omar Torrijos, Cali",
);
assert.equal(cfg.textoDeLaUbicacionDelLocal({ nombre: "Magilus", direccion: "" }), "📍 Magilus");

const accion = fs.readFileSync("src/app/actions/agent-actions.ts", "utf8");
const envio = accion.slice(accion.indexOf("export async function sendChatLocationReplyAction"));
assert.match(envio, /sendEvolutionLocationMessage\(\{[^}]*name: null,[^}]*address: address \|\| null,/s, "el pin va sin nombre y con la dirección");
assert.match(envio, /textoDeLaUbicacionDelLocal\(/, "debajo va la dirección escrita");
assert.ok(!/google\.com\/maps|linkDeMaps/.test(envio.slice(0, 6000)), "sin link de Google Maps");

console.log("ubicación del local: OK");
