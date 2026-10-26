// Revisa el pase de entrada de Reuniones: deja compartir pantalla pero no la cámara, y el grabador
// sigue tomando solo el audio del micrófono (no el de la pantalla).
// Correr: npm run test:reuniones-pase
import assert from "node:assert/strict";
import fs from "node:fs";
import { cargar } from "./supervisor-cargar.mjs";

let casos = 0;
const prueba = (nombre, fn) => {
  fn();
  casos += 1;
  console.log(`ok - ${nombre}`);
};

prueba("el pase deja publicar la pantalla y no la cámara", () => {
  const codigo = fs.readFileSync("src/features/reuniones/servicios/livekit.ts", "utf8");
  const lista = codigo.match(/canPublishSources:\s*\[([^\]]*)\]/);
  assert.ok(lista, "no se encontró canPublishSources en livekit.ts");
  assert.match(lista[1], /"screen_share"/);
  assert.match(lista[1], /"screen_share_audio"/);
  assert.match(lista[1], /"microphone"/);
  assert.doesNotMatch(lista[1], /camera/);
});

// avisos-de-livekit importa @/lib/prisma: acá no se usa la base.
const { esMicrofono } = cargar("src/features/reuniones/servicios/avisos-de-livekit.ts", { "@/lib/prisma": { prisma: {} } });

prueba("esMicrofono acepta el audio del micrófono", () => {
  assert.equal(esMicrofono({ sid: "TR_1", type: "AUDIO", source: "MICROPHONE" }), true);
  assert.equal(esMicrofono({ sid: "TR_1", source: "MICROPHONE" }), true);
});

prueba("esMicrofono rechaza la pantalla y el audio de la pantalla", () => {
  assert.equal(esMicrofono({ sid: "TR_2", type: "VIDEO", source: "SCREEN_SHARE" }), false);
  assert.equal(esMicrofono({ sid: "TR_2", type: "VIDEO", source: "screen_share" }), false);
  assert.equal(esMicrofono({ sid: "TR_3", type: "AUDIO", source: "SCREEN_SHARE_AUDIO" }), false);
});

console.log(`\n${casos} pruebas pasaron`);
