import assert from "node:assert/strict";
import { test } from "node:test";

import { textoDeLaFranja } from "./franja-mensaje-fijado";

/*
  Lo que dice la franja del mensaje fijado (Chats, parte 4). Corre con:
    npx tsx --test src/components/chats/franja-mensaje-fijado.test.ts
*/

test("con texto muestra el texto, en una linea y recortado", () => {
  assert.equal(textoDeLaFranja({ id: "m1", texto: "  Calle 10 #20-30  ", tipo: "TEXT" }), "Calle 10 #20-30");
  assert.equal(
    textoDeLaFranja({ id: "m1", texto: "Talla M\n\ncolor negro", tipo: "TEXT" }),
    "Talla M color negro",
  );
  const largo = "a".repeat(300);
  const recortado = textoDeLaFranja({ id: "m1", texto: largo, tipo: "TEXT" });
  assert.ok(recortado && recortado.length <= 141, "el texto largo se recorta");
  assert.ok(recortado?.endsWith("…"), "el texto recortado termina en …");
});

test("una foto con pie muestra el pie, no 'Foto'", () => {
  assert.equal(textoDeLaFranja({ id: "m1", texto: "Esta es la referencia", tipo: "IMAGE" }), "Esta es la referencia");
});

test("sin texto dice que es por el tipo", () => {
  assert.equal(textoDeLaFranja({ id: "m1", texto: "", tipo: "IMAGE" }), "Foto");
  assert.equal(textoDeLaFranja({ id: "m1", texto: "   ", tipo: "DOCUMENT" }), "Documento");
  assert.equal(textoDeLaFranja({ id: "m1", texto: "", tipo: "AUDIO" }), "Audio");
  assert.equal(textoDeLaFranja({ id: "m1", texto: "", tipo: "VIDEO" }), "Video");
  assert.equal(textoDeLaFranja({ id: "m1", texto: "", tipo: "STICKER" }), "Sticker");
  assert.equal(textoDeLaFranja({ id: "m1", texto: "", tipo: "TEXT" }), "Mensaje");
});

test("sin fijado no hay franja", () => {
  assert.equal(textoDeLaFranja(null), null);
  assert.equal(textoDeLaFranja(undefined), null);
});
