// Pruebas de la marca "Sin responder". Correr: npm run test:sin-responder
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  colorSinResponder,
  marcaSinResponder,
  minutosSinResponder,
  siguienteSinResponderDesde,
  textoSinResponder,
} from "./sin-responder";

const AHORA = new Date("2026-11-06T15:00:00.000Z");
const haceMinutos = (min: number, extraMs = 0) => new Date(AHORA.getTime() - min * 60_000 - extraMs);

test("los minutos son enteros y nunca negativos", () => {
  assert.equal(minutosSinResponder(haceMinutos(15, 59_000), AHORA), 15);
  assert.equal(minutosSinResponder(haceMinutos(0, 30_000), AHORA), 0);
  assert.equal(minutosSinResponder(new Date(AHORA.getTime() + 120_000), AHORA), 0);
  assert.equal(minutosSinResponder(haceMinutos(3).toISOString(), AHORA), 3);
  assert.equal(minutosSinResponder(null, AHORA), null);
  assert.equal(minutosSinResponder("no-es-fecha", AHORA), null);
});

test("15 min es amarillo y 16 min es rojo", () => {
  assert.equal(colorSinResponder(0), "amarillo");
  assert.equal(colorSinResponder(15), "amarillo");
  assert.equal(colorSinResponder(16), "rojo");
  assert.deepEqual(marcaSinResponder({ desde: haceMinutos(15), resuelto: false, ahora: AHORA }), {
    minutos: 15,
    texto: "Sin responder · 15 min",
    color: "amarillo",
  });
  assert.deepEqual(marcaSinResponder({ desde: haceMinutos(16), resuelto: false, ahora: AHORA }), {
    minutos: 16,
    texto: "Sin responder · 16 min",
    color: "rojo",
  });
});

test("59 min sigue en minutos y 60 min da 1 h", () => {
  assert.equal(textoSinResponder(59), "Sin responder · 59 min");
  assert.equal(textoSinResponder(60), "Sin responder · 1 h");
  assert.equal(textoSinResponder(119), "Sin responder · 1 h");
  assert.equal(textoSinResponder(120), "Sin responder · 2 h");
});

test("23 h 59 min sigue en horas y 24 h da 1 d", () => {
  assert.equal(textoSinResponder(24 * 60 - 1), "Sin responder · 23 h");
  assert.equal(textoSinResponder(24 * 60), "Sin responder · 1 d");
  assert.equal(textoSinResponder(3 * 24 * 60 + 5), "Sin responder · 3 d");
});

test("un chat resuelto o ya respondido no lleva marca", () => {
  assert.equal(marcaSinResponder({ desde: haceMinutos(40), resuelto: true, ahora: AHORA }), null);
  assert.equal(marcaSinResponder({ desde: null, resuelto: false, ahora: AHORA }), null);
});

test("siguienteSinResponderDesde: una saliente valida (asesora o bot) quita la marca", () => {
  const desde = haceMinutos(30);
  for (const status of ["SENT", "DELIVERED", "READ", "QUEUED", null]) {
    assert.equal(
      siguienteSinResponderDesde(desde, { direccion: "OUTBOUND", tipo: "TEXT", status, fecha: AHORA }),
      null,
    );
  }
  assert.equal(siguienteSinResponderDesde(null, { direccion: "OUTBOUND", tipo: "TEMPLATE", status: "SENT", fecha: AHORA }), null);
});

test("siguienteSinResponderDesde: una entrante empieza el reloj o lo deja en el primer mensaje", () => {
  const primero = haceMinutos(30);
  assert.equal(
    siguienteSinResponderDesde(null, { direccion: "INBOUND", tipo: "TEXT", status: "RECEIVED", fecha: AHORA }),
    AHORA,
  );
  assert.equal(
    siguienteSinResponderDesde(primero, { direccion: "INBOUND", tipo: "AUDIO", status: "RECEIVED", fecha: AHORA }),
    primero,
  );
});

test("siguienteSinResponderDesde: SYSTEM o FAILED no cambian nada", () => {
  const desde = haceMinutos(30);
  for (const actual of [desde, null]) {
    // Nota interna o de actividad (saliente SYSTEM) y llamada (SYSTEM en cualquier sentido).
    assert.equal(siguienteSinResponderDesde(actual, { direccion: "OUTBOUND", tipo: "SYSTEM", status: "SENT", fecha: AHORA }), actual);
    assert.equal(siguienteSinResponderDesde(actual, { direccion: "INBOUND", tipo: "SYSTEM", status: "RECEIVED", fecha: AHORA }), actual);
    // Saliente que fallo: no le llego al cliente.
    assert.equal(siguienteSinResponderDesde(actual, { direccion: "OUTBOUND", tipo: "TEXT", status: "FAILED", fecha: AHORA }), actual);
  }
});
