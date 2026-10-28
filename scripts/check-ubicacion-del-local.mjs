// Pruebas del botón "Ubicación" del chat (src/lib/workspace-business-config.ts): el pin abre el punto exacto por
// coordenadas, no busca "Magilus" en Google Maps (28-10-2026). Sin base ni red. Correr: npm run test:ubicacion-del-local
import assert from "node:assert/strict";
import fs from "node:fs";

import { cargar } from "./supervisor-cargar.mjs";

const cfg = cargar("src/lib/workspace-business-config.ts");

const link = cfg.linkDeMapsPorCoordenadas(3.425198316126408, -76.48618108220883);
assert.equal(link, "https://www.google.com/maps/search/?api=1&query=3.425198,-76.486181");
assert.ok(!/magilus/i.test(link), "el link no lleva el nombre");

const texto = cfg.textoDeLaUbicacionDelLocal({
  nombre: "Magilus",
  direccion: "Carrera 27 # 72 x 25, Omar Torrijos, Cali",
  latitude: 3.425198316126408,
  longitude: -76.48618108220883,
});
assert.equal(texto, `📍 Magilus\nCarrera 27 # 72 x 25, Omar Torrijos, Cali\n${link}`);

const accion = fs.readFileSync("src/app/actions/agent-actions.ts", "utf8");
const envio = accion.slice(accion.indexOf("export async function sendChatLocationReplyAction"));
assert.match(envio, /sendEvolutionLocationMessage\(\{[^}]*name: null,[^}]*address: null,/s, "el pin va sin nombre");
assert.match(envio, /textoDeLaUbicacionDelLocal\(/, "detrás va la dirección escrita con el link");

console.log("ubicación del local: OK");
