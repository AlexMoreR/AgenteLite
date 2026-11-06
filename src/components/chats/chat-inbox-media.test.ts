import { test } from "node:test";
import assert from "node:assert/strict";

import {
  calcularCajaDelMedio,
  extraerMiniaturaDelVideo,
  extraerTamanoDelMedio,
  MINIATURA_MAXIMA_CARACTERES,
} from "./chat-inbox-media";

/*
  El tamaño y la miniatura que se leen del mensaje para reservarle el lugar a la foto o al video
  antes de que carguen (Chats, parte 3: sin saltos).
*/

// Evolution (Baileys): todo en minuscula y con el sobre `evolution`.
const deEvolution = (nodo: string, datos: Record<string, unknown>) => ({
  evolution: { data: { message: { [nodo]: datos } } },
});
// evogo / traduccion de WAHA: `Message` con M mayuscula.
const deEvogo = (nodo: string, datos: Record<string, unknown>) => ({
  evolution: { data: { Message: { [nodo]: datos } } },
});

test("a) foto con tamaño en minuscula (Evolution)", () => {
  assert.deepEqual(
    extraerTamanoDelMedio(deEvolution("imageMessage", { width: 1080, height: 1920 }), "IMAGE"),
    { ancho: 1080, alto: 1920 },
  );
});

test("b) foto y video con mayusculas (evogo: Message, ImageMessage, Width/Height)", () => {
  assert.deepEqual(
    extraerTamanoDelMedio(deEvogo("ImageMessage", { Width: 800, Height: 600 }), "IMAGE"),
    { ancho: 800, alto: 600 },
  );
  assert.deepEqual(
    extraerTamanoDelMedio(deEvogo("videoMessage", { width: "1280", height: "720" }), "VIDEO"),
    { ancho: 1280, alto: 720 },
  );
});

test("c) sin el sobre `evolution` tambien se lee", () => {
  assert.deepEqual(
    extraerTamanoDelMedio({ message: { videoMessage: { width: 480, height: 848 } } }, "VIDEO"),
    { ancho: 480, alto: 848 },
  );
});

test("d) valores invalidos: cero, negativos, texto, NaN, gigantes o falta uno", () => {
  const casos: Array<Record<string, unknown>> = [
    { width: 0, height: 600 },
    { width: -10, height: 600 },
    { width: "ancho", height: 600 },
    { width: Number.NaN, height: 600 },
    { width: Number.POSITIVE_INFINITY, height: 600 },
    { width: 800, height: 999_999 },
    { width: 800 },
    { width: "12.5", height: 600 },
  ];
  for (const datos of casos) {
    assert.equal(extraerTamanoDelMedio(deEvolution("imageMessage", datos), "IMAGE"), null, JSON.stringify(datos));
  }
});

test("e) sin datos: payload vacio, nulo o de otro tipo", () => {
  assert.equal(extraerTamanoDelMedio(null, "IMAGE"), null);
  assert.equal(extraerTamanoDelMedio(undefined, "VIDEO"), null);
  assert.equal(extraerTamanoDelMedio({}, "IMAGE"), null);
  assert.equal(extraerTamanoDelMedio("texto", "IMAGE"), null);
  // Lo de un video no sirve para una foto.
  assert.equal(extraerTamanoDelMedio(deEvolution("videoMessage", { width: 1, height: 1 }), "IMAGE"), null);
});

test("e2) lo enviado desde el CRM (source manual) usa la caja fija aunque el gateway devuelva tamaño", () => {
  const enviado = {
    source: "manual",
    fileName: "foto.jpg",
    evolution: { message: { imageMessage: { width: 1080, height: 1920 } } },
  };
  assert.equal(extraerTamanoDelMedio(enviado, "IMAGE"), null);
});

test("f) no toma el tamaño de la foto del mensaje CITADO", () => {
  const payload = deEvolution("extendedTextMessage", {
    text: "esta",
    contextInfo: { quotedMessage: { imageMessage: { width: 640, height: 480 } } },
  });
  assert.equal(extraerTamanoDelMedio(payload, "IMAGE"), null);
});

test("g) miniatura del video en texto (evogo/WAHA, JPEGThumbnail)", () => {
  const payload = deEvogo("videoMessage", { JPEGThumbnail: "/9j/4AAQSkZJRg==" });
  assert.equal(extraerMiniaturaDelVideo(payload), "data:image/jpeg;base64,/9j/4AAQSkZJRg==");
});

test("h) miniatura del video en bytes (Evolution: arreglo, objeto numerado o Buffer en JSON)", () => {
  const esperado = `data:image/jpeg;base64,${Buffer.from([255, 216, 255]).toString("base64")}`;
  assert.equal(extraerMiniaturaDelVideo(deEvolution("videoMessage", { jpegThumbnail: [255, 216, 255] })), esperado);
  assert.equal(
    extraerMiniaturaDelVideo(deEvolution("videoMessage", { jpegThumbnail: { 0: 255, 1: 216, 2: 255 } })),
    esperado,
  );
  assert.equal(
    extraerMiniaturaDelVideo(deEvolution("videoMessage", { jpegThumbnail: { type: "Buffer", data: [255, 216, 255] } })),
    esperado,
  );
});

test("i) miniatura: sin datos, no es base64, demasiado grande o es de una foto", () => {
  assert.equal(extraerMiniaturaDelVideo(null), null);
  assert.equal(extraerMiniaturaDelVideo(deEvolution("videoMessage", {})), null);
  assert.equal(extraerMiniaturaDelVideo(deEvolution("videoMessage", { jpegThumbnail: "\"><script>" })), null);
  assert.equal(extraerMiniaturaDelVideo(deEvolution("videoMessage", { jpegThumbnail: [] })), null);
  assert.equal(
    extraerMiniaturaDelVideo(deEvolution("videoMessage", { jpegThumbnail: "A".repeat(MINIATURA_MAXIMA_CARACTERES + 4) })),
    null,
  );
  // La miniatura de una FOTO no se usa como poster de nada.
  assert.equal(extraerMiniaturaDelVideo(deEvolution("imageMessage", { jpegThumbnail: "QUJD" })), null);
});

const TOPES_FOTO = { anchoMaximo: 360, altoMaximo: 260, ladoMinimo: 120 };

test("j) caja: entra en los topes y conserva la proporcion", () => {
  // Vertical 9:16 -> manda el alto.
  assert.deepEqual(calcularCajaDelMedio({ ancho: 1080, alto: 1920 }, TOPES_FOTO), { ancho: 146, alto: 260 });
  // Horizontal 4:3: a 360 de ancho mediria 270 de alto y se pasa, asi que tambien manda el alto.
  assert.deepEqual(calcularCajaDelMedio({ ancho: 800, alto: 600 }, TOPES_FOTO), { ancho: 347, alto: 260 });
  // Panoramica 3:1 -> manda el ancho.
  assert.deepEqual(calcularCajaDelMedio({ ancho: 3000, alto: 1000 }, TOPES_FOTO), { ancho: 360, alto: 120 });
  // Chica: se agranda hasta el tope, como hacia antes con w-full.
  assert.deepEqual(calcularCajaDelMedio({ ancho: 100, alto: 100 }, TOPES_FOTO), { ancho: 260, alto: 260 });
});

test("k) caja: una foto muy alargada no queda como una tira (lado minimo)", () => {
  assert.deepEqual(calcularCajaDelMedio({ ancho: 100, alto: 5000 }, TOPES_FOTO), { ancho: 120, alto: 260 });
  assert.deepEqual(calcularCajaDelMedio({ ancho: 9000, alto: 100 }, TOPES_FOTO), { ancho: 360, alto: 120 });
  const video = calcularCajaDelMedio({ ancho: 480, alto: 848 }, { anchoMaximo: 260, altoMaximo: 260, ladoMinimo: 140 });
  assert.deepEqual(video, { ancho: 147, alto: 260 });
});

test("l) caja: sin tamaño no hay caja (se usa la fija)", () => {
  assert.equal(calcularCajaDelMedio(null, TOPES_FOTO), null);
});
