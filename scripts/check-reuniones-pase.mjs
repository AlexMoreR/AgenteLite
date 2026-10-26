// Pruebas del pase de entrada de Reuniones: puede publicar micrófono y pantalla, nunca cámara,
// y el grabador solo toma el micrófono (la pantalla compartida no se graba).
// Correr: npm run test:reuniones-pase
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { cargar } from "./supervisor-cargar.mjs";

const conDefault = (modulo) => ({ ...modulo, default: modulo });
const mocks = { "@/lib/prisma": { prisma: {} }, "node:crypto": conDefault(crypto) };
const { crearPaseDeEntrada } = cargar("src/features/reuniones/servicios/livekit.ts", mocks);
const { esMicrofono } = cargar("src/features/reuniones/servicios/avisos-de-livekit.ts", {
  ...mocks,
  "node:path": conDefault(await import("node:path")),
  "node:os": conDefault(await import("node:os")),
});

let casos = 0;
const prueba = (nombre, fn) => {
  fn();
  casos += 1;
  console.log(`ok - ${nombre}`);
};

const pase = crearPaseDeEntrada({ apiKey: "k", apiSecret: "s" }, { sala: "sala", identidad: "u1", nombre: "Ana" });
const video = JSON.parse(Buffer.from(pase.split(".")[1], "base64url").toString("utf8")).video;

prueba("el pase deja publicar la pantalla y su audio", () => {
  assert.ok(video.canPublishSources.includes("screen_share"));
  assert.ok(video.canPublishSources.includes("screen_share_audio"));
  assert.ok(video.canPublishSources.includes("microphone"));
});
prueba("el pase no deja publicar la cámara ni grabar ni administrar", () => {
  assert.ok(!video.canPublishSources.includes("camera"));
  assert.equal(video.roomRecord, undefined);
  assert.equal(video.roomAdmin, undefined);
});
prueba("el grabador acepta el micrófono y rechaza la pantalla", () => {
  assert.equal(esMicrofono({ sid: "TR_1", type: "AUDIO", source: "MICROPHONE" }), true);
  assert.equal(esMicrofono({ sid: "TR_2", type: "VIDEO", source: "SCREEN_SHARE" }), false);
  assert.equal(esMicrofono({ sid: "TR_3", type: "AUDIO", source: "SCREEN_SHARE_AUDIO" }), false);
  assert.equal(esMicrofono({ sid: "TR_4", type: "VIDEO", source: "CAMERA" }), false);
});

console.log(`${casos} pruebas de pase de Reuniones: OK`);
