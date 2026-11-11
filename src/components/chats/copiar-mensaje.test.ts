// Pruebas de lo que se copia de los mensajes del chat. Correr: npm run test:copiar-mensaje
import assert from "node:assert/strict";
import { test } from "node:test";

import type { SharedInboxMessageItem } from "./chat-inbox-types";
import { textoDeVariosParaCopiar, textoParaCopiar } from "./copiar-mensaje";

function mensaje(parcial: Partial<SharedInboxMessageItem>): SharedInboxMessageItem {
  return {
    id: "m1",
    content: null,
    direction: "INBOUND",
    createdAt: new Date("2026-11-11T10:00:00Z"),
    type: "TEXT",
    ...parcial,
  };
}

test("un texto da su texto", () => {
  assert.equal(textoParaCopiar(mensaje({ content: "  Hola, ¿cuánto vale?  " })), "Hola, ¿cuánto vale?");
});

test("una foto con texto da ese texto", () => {
  assert.equal(textoParaCopiar(mensaje({ type: "IMAGE", content: "Esta camilla en negro" })), "Esta camilla en negro");
});

test("una foto sin texto da null", () => {
  assert.equal(textoParaCopiar(mensaje({ type: "IMAGE", content: "Foto" })), null);
  assert.equal(textoParaCopiar(mensaje({ type: "IMAGE", content: "" })), null);
  assert.equal(textoParaCopiar(mensaje({ type: "IMAGE", content: null })), null);
});

test("un video con texto da ese texto, y sin texto da null", () => {
  assert.equal(textoParaCopiar(mensaje({ type: "VIDEO", content: "Así se arma" })), "Así se arma");
  assert.equal(textoParaCopiar(mensaje({ type: "VIDEO", content: "Video" })), null);
});

test("un documento con texto distinto del nombre del archivo da ese texto", () => {
  const doc = mensaje({
    type: "DOCUMENT",
    content: "Te mando la cotización",
    rawPayload: { fileName: "cotizacion.pdf", mimeType: "application/pdf" },
  });
  assert.equal(textoParaCopiar(doc), "Te mando la cotización");
});

test("un documento cuyo texto es el nombre del archivo da null", () => {
  const doc = mensaje({
    type: "DOCUMENT",
    content: "cotizacion.pdf",
    rawPayload: { fileName: "cotizacion.pdf", mimeType: "application/pdf" },
  });
  assert.equal(textoParaCopiar(doc), null);
  assert.equal(textoParaCopiar(mensaje({ type: "DOCUMENT", content: "Documento" })), null);
});

test("un archivo que no se pudo bajar da null", () => {
  assert.equal(
    textoParaCopiar(mensaje({ type: "DOCUMENT", content: "📎 Archivo: no se pudo descargar" })),
    null,
  );
});

test("un mensaje borrado, un audio y un sticker dan null", () => {
  assert.equal(textoParaCopiar(mensaje({ content: "hola", deletedAt: new Date() })), null);
  assert.equal(textoParaCopiar(mensaje({ type: "AUDIO", content: "Audio" })), null);
  assert.equal(textoParaCopiar(mensaje({ type: "STICKER", content: "Sticker" })), null);
});

test("3 mensajes, uno sin texto, dan 2 lineas", () => {
  const texto = textoDeVariosParaCopiar([
    mensaje({ id: "a", content: "Primero" }),
    mensaje({ id: "b", type: "IMAGE", content: "Foto" }),
    mensaje({ id: "c", type: "IMAGE", content: "Segundo" }),
  ]);
  assert.equal(texto, "Primero\nSegundo");
  assert.equal(texto?.split("\n").length, 2);
});

test("varios mensajes sin texto dan null", () => {
  assert.equal(
    textoDeVariosParaCopiar([mensaje({ type: "IMAGE", content: "Foto" }), mensaje({ type: "AUDIO" })]),
    null,
  );
});
