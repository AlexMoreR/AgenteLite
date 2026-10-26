// Revisa el pase de entrada a la sala (Reuniones): que deje publicar micrófono y pantalla pero no la
// cámara, y que el grabador siga tomando solo el audio del micrófono.
// Correr: npm run test:reuniones-pase
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cargar } from "./supervisor-cargar.mjs";

let casos = 0;
const prueba = (nombre, fn) => {
  fn();
  casos += 1;
  console.log(`ok - ${nombre}`);
};

// a) Los orígenes que el pase deja publicar, leídos del código fuente.
const fuente = readFileSync("src/features/reuniones/servicios/livekit.ts", "utf8");
const coincidencia = fuente.match(/canPublishSources:\s*\[([^\]]*)\]/);
assert.ok(coincidencia, "no se encontró canPublishSources en livekit.ts");
const origenes = [...coincidencia[1].matchAll(/["']([a-z_]+)["']/g)].map((m) => m[1]);

prueba("el pase deja publicar el micrófono", () => assert.ok(origenes.includes("microphone"), `origenes: ${origenes}`));
prueba("el pase deja compartir pantalla", () => assert.ok(origenes.includes("screen_share"), `origenes: ${origenes}`));
prueba("el pase deja el audio de la pantalla", () => assert.ok(origenes.includes("screen_share_audio"), `origenes: ${origenes}`));
prueba("el pase NO deja publicar la cámara", () => assert.ok(!origenes.includes("camera"), `origenes: ${origenes}`));

// b) El grabador solo toma el audio del micrófono.
const { esMicrofono } = cargar("src/features/reuniones/servicios/avisos-de-livekit.ts", { "@/lib/prisma": { prisma: {} } });

prueba("esMicrofono acepta el audio del micrófono", () => {
  assert.equal(esMicrofono({ sid: "TR_1", type: "AUDIO", source: "MICROPHONE" }), true);
});
prueba("esMicrofono rechaza el video de la pantalla", () => {
  assert.equal(esMicrofono({ sid: "TR_2", type: "VIDEO", source: "SCREEN_SHARE" }), false);
  assert.equal(esMicrofono({ sid: "TR_2", type: "VIDEO", source: "screen_share" }), false);
});
prueba("esMicrofono rechaza el audio de la pantalla", () => {
  assert.equal(esMicrofono({ sid: "TR_3", type: "AUDIO", source: "SCREEN_SHARE_AUDIO" }), false);
});

console.log(`\n${casos} pruebas OK`);
