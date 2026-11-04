// Pruebas de src/lib/buscar-producto-de-envio.ts. Correr: npm run test:buscar-producto-de-envio
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buscarProductosDeEnvio,
  coincideProducto,
  etiquetaDeProducto,
  normalizarTexto,
} from "./buscar-producto-de-envio";

const divan = { codigo: "CMB005", nombre: "Combo Camilla Diván" };
const largo = { codigo: "CMB010", nombre: "COMBO CAMILLA 3 CUERPOS + SILLA + CARRITO AUXILIAR" };
const silla = { codigo: "SIL001", nombre: "Silla de manicure" };
const productos = [divan, largo, silla];

test("la etiqueta lleva el código, ' · ' y el nombre", () => {
  assert.equal(etiquetaDeProducto(divan), "CMB005 · Combo Camilla Diván");
  assert.equal(etiquetaDeProducto({ codigo: "", nombre: "Sin código" }), "Sin código");
  assert.equal(etiquetaDeProducto({ codigo: " CMB005 ", nombre: "" }), "CMB005");
});

test("'CMB005', 'cmb005' y 'divan' encuentran el Combo Diván", () => {
  for (const texto of ["CMB005", "cmb005", "divan", "Diván", "  DIVAN  "]) {
    assert.deepEqual(buscarProductosDeEnvio(productos, texto), [divan], texto);
  }
});

test("parte del código o varias palabras del nombre", () => {
  assert.deepEqual(buscarProductosDeEnvio(productos, "cmb"), [divan, largo]);
  assert.deepEqual(buscarProductosDeEnvio(productos, "camilla 3"), [largo]);
  assert.deepEqual(buscarProductosDeEnvio(productos, "silla"), [largo, silla]);
  assert.equal(coincideProducto(largo, "carrito cmb010"), true);
});

test("texto vacío devuelve todos y 'zzz' ninguno", () => {
  assert.deepEqual(buscarProductosDeEnvio(productos, ""), productos);
  assert.deepEqual(buscarProductosDeEnvio(productos, "   "), productos);
  assert.deepEqual(buscarProductosDeEnvio(productos, "zzz"), []);
});

test("normalizar quita tildes, mayúsculas y espacios de más", () => {
  assert.equal(normalizarTexto("  Camilla   DIVÁN "), "camilla divan");
});
