// Correr: npm run test:eco-de-lo-enviado
import { test } from "node:test";
import assert from "node:assert/strict";

import { salientesDesde, ultimoSalienteDelServidor } from "./eco-de-lo-enviado";

const m = (direction: "INBOUND" | "OUTBOUND", iso: string, type = "TEXT") => ({ direction, createdAt: iso, type });

const enPantalla = [
  m("INBOUND", "2026-11-20T20:00:00.000Z"),
  m("OUTBOUND", "2026-11-20T20:01:00.000Z"),
  m("INBOUND", "2026-11-20T20:02:00.000Z"),
];

test("el ultimo saliente es el mas nuevo de los salientes, no el ultimo mensaje", () => {
  assert.equal(ultimoSalienteDelServidor(enPantalla), Date.parse("2026-11-20T20:01:00.000Z"));
});

test("sin salientes en pantalla, cualquier saliente que llegue cuenta", () => {
  const desde = ultimoSalienteDelServidor([m("INBOUND", "2026-11-20T20:00:00.000Z")]);
  assert.equal(desde, Number.NEGATIVE_INFINITY);
  assert.equal(salientesDesde([m("OUTBOUND", "2026-11-20T20:05:00.000Z")], desde), 1);
});

test("el eco con el mensaje enviado cuenta uno; el chat sin el, cero", () => {
  const desde = ultimoSalienteDelServidor(enPantalla);
  assert.equal(salientesDesde(enPantalla, desde), 0);
  assert.equal(salientesDesde([...enPantalla, m("OUTBOUND", "2026-11-20T20:03:00.000Z")], desde), 1);
});

test("una nota del sistema o un mensaje de la clienta no se toman por el eco", () => {
  const desde = ultimoSalienteDelServidor(enPantalla);
  const llegaron = [
    ...enPantalla,
    m("OUTBOUND", "2026-11-20T20:03:00.000Z", "SYSTEM"),
    m("INBOUND", "2026-11-20T20:03:30.000Z"),
  ];
  assert.equal(salientesDesde(llegaron, desde), 0);
});

test("varios envios seguidos: cuenta todos los salientes nuevos (fechas como Date o texto)", () => {
  const desde = ultimoSalienteDelServidor(enPantalla);
  const llegaron = [
    ...enPantalla,
    { direction: "OUTBOUND" as const, createdAt: new Date("2026-11-20T20:03:00.000Z"), type: "IMAGE" },
    m("OUTBOUND", "2026-11-20T20:03:01.000Z", "IMAGE"),
  ];
  assert.equal(salientesDesde(llegaron, desde), 2);
});
