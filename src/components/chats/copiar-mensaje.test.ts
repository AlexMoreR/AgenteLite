import { test } from "node:test";
import assert from "node:assert/strict";

import type { SharedInboxMessageItem } from "./chat-inbox-types";
import { copiarAlPortapapeles, textoDeVariosParaCopiar, textoParaCopiar } from "./copiar-mensaje";

/*
  Copiar el texto de un mensaje (Chats: "Copiar" como en WhatsApp, parte 1). El texto de una foto o
  de un documento vive en `content`; la etiqueta "Foto" o el nombre del archivo no son texto.
*/

let siguienteId = 0;
const mensaje = (datos: Partial<SharedInboxMessageItem>): SharedInboxMessageItem => ({
  id: `m${++siguienteId}`,
  content: null,
  direction: "INBOUND",
  createdAt: new Date("2026-11-11T12:00:00Z"),
  type: "TEXT",
  ...datos,
});

test("a) un texto da su texto", () => {
  assert.equal(textoParaCopiar(mensaje({ content: "  Hola, ¿cuánto vale?  " })), "Hola, ¿cuánto vale?");
});

test("b) una foto con texto da ese texto", () => {
  assert.equal(textoParaCopiar(mensaje({ type: "IMAGE", content: "Este es el modelo" })), "Este es el modelo");
});

test("c) un documento con texto distinto del nombre del archivo da ese texto", () => {
  const doc = mensaje({
    type: "DOCUMENT",
    content: "Te mando la cotización",
    rawPayload: { fileName: "cotizacion.pdf", mimeType: "application/pdf" },
  });
  assert.equal(textoParaCopiar(doc), "Te mando la cotización");
});

test("d) una foto con 'Foto' o vacia da null", () => {
  assert.equal(textoParaCopiar(mensaje({ type: "IMAGE", content: "Foto" })), null);
  assert.equal(textoParaCopiar(mensaje({ type: "IMAGE", content: "" })), null);
  assert.equal(textoParaCopiar(mensaje({ type: "IMAGE", content: null })), null);
});

test("e) un documento que solo trae su nombre da null", () => {
  const doc = mensaje({
    type: "DOCUMENT",
    content: "cotizacion.pdf",
    rawPayload: { fileName: "cotizacion.pdf", mimeType: "application/pdf" },
  });
  assert.equal(textoParaCopiar(doc), null);
  assert.equal(textoParaCopiar(mensaje({ type: "DOCUMENT", content: "Documento" })), null);
});

test("f) borrado, audio, sticker y archivo que no bajo dan null", () => {
  assert.equal(textoParaCopiar(mensaje({ content: "hola", deletedAt: new Date() })), null);
  assert.equal(textoParaCopiar(mensaje({ type: "AUDIO", content: "Audio" })), null);
  assert.equal(textoParaCopiar(mensaje({ type: "STICKER", content: "Sticker" })), null);
  assert.equal(
    textoParaCopiar(
      mensaje({ type: "DOCUMENT", content: "⚠️ Te mando una foto, pero no se pudo descargar. Pediselo de nuevo." }),
    ),
    null,
  );
});

test("g) 3 mensajes, uno sin texto: salen 2 lineas", () => {
  const texto = textoDeVariosParaCopiar([
    mensaje({ content: "Primero" }),
    mensaje({ type: "IMAGE", content: "Foto" }),
    mensaje({ type: "IMAGE", content: "Segundo" }),
  ]);
  assert.equal(texto, "Primero\nSegundo");
  assert.equal(texto?.split("\n").length, 2);
});

test("h) ninguno con texto da null", () => {
  assert.equal(textoDeVariosParaCopiar([mensaje({ type: "IMAGE", content: "Foto" })]), null);
  assert.equal(textoDeVariosParaCopiar([]), null);
});

test("i) copiarAlPortapapeles llama a writeText de inmediato, en el mismo toque", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const llamadas: string[] = [];
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      clipboard: {
        writeText: (texto: string) => {
          llamadas.push(texto);
          return Promise.resolve();
        },
      },
    },
  });
  try {
    const resultado = copiarAlPortapapeles("hola");
    // Ya se llamo, antes de esperar nada.
    assert.deepEqual(llamadas, ["hola"]);
    assert.equal(await resultado, true);
  } finally {
    if (original) {
      Object.defineProperty(globalThis, "navigator", original);
    } else {
      delete (globalThis as { navigator?: unknown }).navigator;
    }
  }
});

test("j) sin portapapeles ni documento (servidor) da false, sin romper", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: {} });
  try {
    assert.equal(await copiarAlPortapapeles("hola"), false);
  } finally {
    if (original) {
      Object.defineProperty(globalThis, "navigator", original);
    } else {
      delete (globalThis as { navigator?: unknown }).navigator;
    }
  }
});
