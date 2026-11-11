import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { SharedInboxMessageItem } from "./chat-inbox-types";
import { copiarAlPortapapeles, textoDeVariosParaCopiar, textoParaCopiar } from "./copiar-mensaje";

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

describe("textoParaCopiar", () => {
  it("un texto da su texto", () => {
    assert.equal(textoParaCopiar(mensaje({ content: "  Hola, ¿tienen talla M?  " })), "Hola, ¿tienen talla M?");
  });

  it("una foto con texto da el texto que la acompaña", () => {
    assert.equal(textoParaCopiar(mensaje({ type: "IMAGE", content: "Este es el modelo" })), "Este es el modelo");
  });

  it("un documento con texto distinto del nombre del archivo da ese texto", () => {
    const doc = mensaje({
      type: "DOCUMENT",
      content: "Te mando la cotizacion",
      rawPayload: { fileName: "cotizacion.pdf" },
    });
    assert.equal(textoParaCopiar(doc), "Te mando la cotizacion");
  });

  it("un documento cuyo texto es solo el nombre del archivo da null", () => {
    const doc = mensaje({ type: "DOCUMENT", content: "cotizacion.pdf", rawPayload: { fileName: "cotizacion.pdf" } });
    assert.equal(textoParaCopiar(doc), null);
    assert.equal(textoParaCopiar(mensaje({ type: "DOCUMENT", content: "Documento" })), null);
  });

  it("una foto sin texto (\"Foto\" o vacio) da null", () => {
    assert.equal(textoParaCopiar(mensaje({ type: "IMAGE", content: "Foto" })), null);
    assert.equal(textoParaCopiar(mensaje({ type: "IMAGE", content: "" })), null);
    assert.equal(textoParaCopiar(mensaje({ type: "IMAGE", content: null })), null);
    assert.equal(textoParaCopiar(mensaje({ type: "VIDEO", content: "Video" })), null);
  });

  it("un mensaje borrado, un audio, un sticker o un archivo que no bajo dan null", () => {
    assert.equal(textoParaCopiar(mensaje({ content: "hola", deletedAt: new Date() })), null);
    assert.equal(textoParaCopiar(mensaje({ type: "AUDIO", content: "Audio" })), null);
    assert.equal(textoParaCopiar(mensaje({ type: "STICKER", content: "Sticker" })), null);
    assert.equal(
      textoParaCopiar(mensaje({ type: "IMAGE", content: "📎 El archivo no se pudo descargar" })),
      null,
    );
  });
});

describe("textoDeVariosParaCopiar", () => {
  it("3 mensajes, uno sin texto, dan 2 lineas", () => {
    const texto = textoDeVariosParaCopiar([
      mensaje({ id: "a", content: "Primero" }),
      mensaje({ id: "b", type: "IMAGE", content: "Foto" }),
      mensaje({ id: "c", type: "IMAGE", content: "Con texto" }),
    ]);
    assert.equal(texto, "Primero\nCon texto");
    assert.equal(texto?.split("\n").length, 2);
  });

  it("sin ningun texto da null", () => {
    assert.equal(textoDeVariosParaCopiar([mensaje({ type: "IMAGE", content: "Foto" })]), null);
    assert.equal(textoDeVariosParaCopiar([]), null);
  });
});

describe("copiarAlPortapapeles", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  afterEach(() => {
    if (original) Object.defineProperty(globalThis, "navigator", original);
  });

  it("llama a writeText de inmediato, en el mismo toque", async () => {
    const copiados: string[] = [];
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { clipboard: { writeText: (t: string) => (copiados.push(t), Promise.resolve()) } },
    });
    const resultado = copiarAlPortapapeles("hola");
    // Sin esperar nada: ya se llamo.
    assert.deepEqual(copiados, ["hola"]);
    assert.equal(await resultado, true);
  });

  it("sin portapapeles ni documento da false", () => {
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: {} });
    assert.equal(copiarAlPortapapeles("hola"), false);
  });
});
