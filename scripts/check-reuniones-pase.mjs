// Pruebas del pase de entrada a la sala: deja compartir pantalla, no deja cámara, y el grabador
// sigue tomando solo el micrófono (la pantalla no se graba).
// Correr: npm run test:reuniones-pase
import assert from "node:assert/strict";
import { cargar } from "./supervisor-cargar.mjs";

const { crearPaseDeEntrada, verificarJwt } = cargar("src/features/reuniones/servicios/livekit.ts");
const { esMicrofono } = cargar("src/features/reuniones/servicios/avisos-de-livekit.ts");

let casos = 0;
const prueba = (nombre, fn) => {
  fn();
  casos += 1;
  console.log(`ok - ${nombre}`);
};

const SECRETO = "secreto-de-prueba-del-crm";
const config = { apiKey: "clave", apiSecret: SECRETO };
const video = verificarJwt(crearPaseDeEntrada(config, { sala: "sala1", identidad: "yo", nombre: "Yo" }), SECRETO).video;

prueba("el pase deja publicar micrófono y pantalla (con su audio)", () => {
  assert.ok(video.canPublishSources.includes("microphone"));
  assert.ok(video.canPublishSources.includes("screen_share"));
  assert.ok(video.canPublishSources.includes("screen_share_audio"));
});

prueba("el pase no deja publicar cámara ni grabar ni administrar", () => {
  assert.ok(!video.canPublishSources.includes("camera"));
  assert.equal(video.roomRecord, undefined);
  assert.equal(video.roomAdmin, undefined);
});

prueba("el grabador toma el micrófono y rechaza la pantalla", () => {
  assert.equal(esMicrofono({ sid: "TR_1", type: "AUDIO", source: "MICROPHONE" }), true);
  assert.equal(esMicrofono({ sid: "TR_2", type: "VIDEO", source: "SCREEN_SHARE" }), false);
  assert.equal(esMicrofono({ sid: "TR_3", type: "AUDIO", source: "SCREEN_SHARE_AUDIO" }), false);
  assert.equal(esMicrofono({ sid: "TR_4", type: "VIDEO", source: "CAMERA" }), false);
});

console.log(`\n${casos} pruebas del pase OK`);
