// Revisa el pase de entrada de Reuniones: deja publicar micrófono y pantalla (no la cámara) y el
// grabador sigue tomando solo el audio del micrófono.
// Correr: npm run test:reuniones-pase
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cargar } from "./supervisor-cargar.mjs";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mocks = { "@/lib/prisma": { prisma: {} } };
const { esMicrofono } = cargar("src/features/reuniones/servicios/avisos-de-livekit.ts", mocks);

let casos = 0;
const prueba = (nombre, fn) => {
  fn();
  casos += 1;
  console.log(`ok - ${nombre}`);
};

const codigo = fs.readFileSync(path.join(RAIZ, "src/features/reuniones/servicios/livekit.ts"), "utf8");
const lista = /canPublishSources:\s*\[([^\]]*)\]/.exec(codigo);

prueba("el pase deja publicar micrófono y pantalla, y no la cámara", () => {
  assert.ok(lista, "no se encontró canPublishSources en livekit.ts");
  const fuentes = [...lista[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(fuentes.includes("microphone"), "falta microphone");
  assert.ok(fuentes.includes("screen_share"), "falta screen_share");
  assert.ok(fuentes.includes("screen_share_audio"), "falta screen_share_audio");
  assert.ok(!fuentes.includes("camera"), "la cámara no debe tener permiso");
});

prueba("el pase sigue sin permiso de grabar ni de administrar", () => {
  const pase = codigo.slice(codigo.indexOf("export function crearPaseDeEntrada"));
  const fin = pase.indexOf("\n}\n");
  const cuerpo = fin > 0 ? pase.slice(0, fin) : pase;
  assert.ok(!/roomRecord|roomAdmin/.test(cuerpo), "el pase no debe pedir roomRecord ni roomAdmin");
});

prueba("esMicrofono acepta el audio del micrófono", () => {
  assert.equal(esMicrofono({ sid: "TR_1", type: "AUDIO", source: "MICROPHONE" }), true);
  assert.equal(esMicrofono({ sid: "TR_1", source: "MICROPHONE" }), true);
});

prueba("esMicrofono rechaza la pantalla y el audio de la pantalla", () => {
  assert.equal(esMicrofono({ sid: "TR_1", type: "VIDEO", source: "SCREEN_SHARE" }), false);
  assert.equal(esMicrofono({ sid: "TR_1", type: "VIDEO", source: "screen_share" }), false);
  assert.equal(esMicrofono({ sid: "TR_1", type: "AUDIO", source: "SCREEN_SHARE_AUDIO" }), false);
  assert.equal(esMicrofono({ sid: "TR_1", source: "SCREEN_SHARE_AUDIO" }), false);
});

console.log(`\n${casos} pruebas del pase de Reuniones OK`);
