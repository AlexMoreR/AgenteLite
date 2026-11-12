// Seguimiento del chat con adjuntos (11-nov-2026). Correr: npm run test:seguimiento-con-adjuntos
import assert from "node:assert/strict";
import { test } from "node:test";

import { armarAccionesDelChat, esArchivoPropio } from "./acciones-del-chat";
import { diaMasHoraDeBogota, horaDeBogotaAUtc } from "./fecha-exacta";

const FOTO = { tipo: "IMAGE" as const, url: "https://crm.magilus.com/uploads/chat-media/a.jpg" };
const PDF = { tipo: "DOC" as const, url: "https://crm.magilus.com/uploads/chat-media/b.pdf" };
const AUDIO = { tipo: "AUDIO" as const, url: "https://crm.magilus.com/uploads/chat-audio/c.ogg" };

test("solo texto: un mensaje de texto, como antes", () => {
  assert.deepEqual(armarAccionesDelChat("  Hola  ", []), [{ order: 1, messageType: "TEXT", content: "Hola", mediaUrl: "" }]);
});

test("foto + texto + audio: el texto va debajo de la foto y el audio sale despues", () => {
  assert.deepEqual(armarAccionesDelChat("Mira", [AUDIO, FOTO, PDF]), [
    { order: 1, messageType: "IMAGE", content: "Mira", mediaUrl: FOTO.url },
    { order: 2, messageType: "DOC", content: "", mediaUrl: PDF.url },
    { order: 3, messageType: "AUDIO", content: "", mediaUrl: AUDIO.url },
  ]);
});

test("texto + audio sin foto: primero el texto y despues la nota de voz", () => {
  assert.deepEqual(
    armarAccionesDelChat("Hola", [AUDIO]).map((a) => a.messageType),
    ["TEXT", "AUDIO"],
  );
  assert.deepEqual(
    armarAccionesDelChat("", [AUDIO]).map((a) => a.messageType),
    ["AUDIO"],
  );
});

test("solo acepta archivos subidos a nuestro servidor", () => {
  const propios = new Set(["crm.magilus.com"]);
  assert.equal(esArchivoPropio(FOTO.url, propios), true);
  assert.equal(esArchivoPropio("https://otro.com/uploads/a.jpg", propios), false);
  assert.equal(esArchivoPropio("https://crm.magilus.com/api/a.jpg", propios), false);
  assert.equal(esArchivoPropio("javascript:alert(1)", propios), false);
  assert.equal(esArchivoPropio("no es una url", propios), false);
});

test("Mañana a las 9:00 es el dia siguiente en Colombia, aunque en UTC ya sea otro dia", () => {
  // 11-nov 21:30 en Colombia = 12-nov 02:30 UTC
  const ahora = new Date("2026-11-12T02:30:00Z");
  assert.equal(diaMasHoraDeBogota(ahora, 1, "09:00"), "2026-11-12T09:00");
  assert.equal(horaDeBogotaAUtc("2026-11-12T09:00")?.toISOString(), "2026-11-12T14:00:00.000Z");
  assert.equal(diaMasHoraDeBogota(ahora, 7, "15:30"), "2026-11-18T15:30");
  assert.equal(diaMasHoraDeBogota(ahora, 1, "9"), null);
});
