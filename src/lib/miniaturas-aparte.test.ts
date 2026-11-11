// Pruebas de las miniaturas aparte (velocidad del chat). Correr: npm run test:velocidad-chat
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  LARGO_EN_LINEA,
  bytesDeLaMiniatura,
  esMiniaturaAparte,
  miniaturaEnLaRuta,
  sacarMiniaturasPesadas,
  urlDeMiniatura,
} from "./miniaturas-aparte";

const grande = "A".repeat(LARGO_EN_LINEA + 10);

test("la miniatura grande de un enlace se cambia por su direccion y el resto queda igual", () => {
  const crudo = {
    evolution: { data: { message: { extendedTextMessage: { text: "hola", title: "Magilus", jpegThumbnail: grande } } } },
  };
  const salida = sacarMiniaturasPesadas(crudo, "msg1") as typeof crudo;
  const nodo = salida.evolution.data.message.extendedTextMessage;
  assert.equal(nodo.text, "hola");
  assert.equal(nodo.title, "Magilus");
  assert.equal(nodo.jpegThumbnail, urlDeMiniatura("msg1", ["evolution", "data", "message", "extendedTextMessage", "jpegThumbnail"]));
  assert.ok(esMiniaturaAparte(nodo.jpegThumbnail));
  // El original no se toca.
  assert.equal(crudo.evolution.data.message.extendedTextMessage.jpegThumbnail, grande);
});

test("las chicas, las otras claves y lo que no es miniatura quedan adentro (mismo objeto)", () => {
  const crudo = { data: { Message: { ImageMessage: { JPEGThumbnail: "QUJD", url: "x", base64: grande } } } };
  assert.equal(sacarMiniaturasPesadas(crudo, "msg1"), crudo);
});

test("bytes en arreglo, en Buffer de JSON y en objeto numerico tambien salen", () => {
  const bytes = Array.from({ length: LARGO_EN_LINEA }, () => 255);
  const comoObjeto = Object.fromEntries(bytes.map((byte, i) => [String(i), byte]));
  const crudo = {
    video: { jpegThumbnail: bytes },
    foto: { jpegThumbnail: { type: "Buffer", data: bytes } },
    anuncio: { contextInfo: { externalAdReply: { thumbnail: comoObjeto, thumbnailUrl: "https://x" } } },
  };
  const salida = sacarMiniaturasPesadas(crudo, "m") as Record<string, Record<string, unknown>>;
  assert.ok(esMiniaturaAparte(salida.video.jpegThumbnail));
  assert.ok(esMiniaturaAparte(salida.foto.jpegThumbnail));
  const ad = (salida.anuncio.contextInfo as { externalAdReply: Record<string, unknown> }).externalAdReply;
  assert.ok(esMiniaturaAparte(ad.thumbnail));
  assert.equal(ad.thumbnailUrl, "https://x");
});

test("la ruta lleva a la misma miniatura y solo a claves de miniatura", () => {
  const crudo = { lista: [{ jpegThumbnail: grande }], secreto: { token: "abc" } };
  assert.equal(miniaturaEnLaRuta(crudo, "lista.0.jpegThumbnail"), grande);
  assert.equal(miniaturaEnLaRuta(crudo, "secreto.token"), null, "nunca otra clave");
  assert.equal(miniaturaEnLaRuta(crudo, "lista.9.jpegThumbnail"), null);
  assert.equal(miniaturaEnLaRuta(crudo, "__proto__.jpegThumbnail"), null);
  assert.equal(miniaturaEnLaRuta(crudo, ""), null);
});

test("bytesDeLaMiniatura acepta base64 y bytes, y rechaza texto raro", () => {
  assert.equal(bytesDeLaMiniatura("QUJD"), "QUJD");
  assert.equal(bytesDeLaMiniatura('"><script>'), null);
  assert.deepEqual(bytesDeLaMiniatura([1, 2, 3]), [1, 2, 3]);
  assert.deepEqual(bytesDeLaMiniatura({ type: "Buffer", data: [4, 5] }), [4, 5]);
  assert.deepEqual(bytesDeLaMiniatura({ 1: 9, 0: 8 }), [8, 9]);
  assert.equal(bytesDeLaMiniatura({}), null);
});

test("sin id de mensaje no se toca nada", () => {
  const crudo = { jpegThumbnail: grande };
  assert.equal(sacarMiniaturasPesadas(crudo, ""), crudo);
});
