// Pruebas de quien es el lider de ventas. Correr: npm run test:listo-para-pagar
import assert from "node:assert/strict";
import { test } from "node:test";

import { elegirLiderDeVentas } from "./lider-de-ventas";

test("el elegido activo gana", () => {
  assert.equal(elegirLiderDeVentas("u1", ["s1"], new Set(["u1", "s1"])), "u1");
});

test("el elegido que ya no está activo cae en la primera supervisora activa", () => {
  assert.equal(elegirLiderDeVentas("u1", ["s1", "s2"], new Set(["s1", "s2"])), "s1");
  assert.equal(elegirLiderDeVentas("u1", ["s1", "s2"], new Set(["s2"])), "s2");
});

test("sin elegir, la primera supervisora activa", () => {
  assert.equal(elegirLiderDeVentas(null, ["s1", "s2"], new Set(["s2"])), "s2");
});

test("sin elegido ni supervisoras activas, nadie", () => {
  assert.equal(elegirLiderDeVentas(null, [], new Set(["u1"])), null);
  assert.equal(elegirLiderDeVentas("u1", ["s1"], new Set()), null);
});
