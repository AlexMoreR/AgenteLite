// Pruebas de la vista previa sin formato (lista de chats sin brincos). Correr: npm run test:lista-sin-brincos
import assert from "node:assert/strict";
import { test } from "node:test";

import { textoSinFormato } from "./texto-sin-formato";

test("quita los asteriscos de la negrita", () => {
  assert.equal(textoSinFormato("*Precio:* $250.000"), "Precio: $250.000");
});

test("quita un asterisco sin cierre (la vista previa va cortada)", () => {
  assert.equal(textoSinFormato("*Combo camillas incluye la"), "Combo camillas incluye la");
});

test("quita cursiva, tachado y monoespaciado", () => {
  assert.equal(textoSinFormato("Hola _amiga_ ~no~ ```codigo``` `x`"), "Hola amiga no codigo x");
  assert.equal(textoSinFormato("_~ambos~_"), "ambos");
});

test("deja los guiones bajos de correos y enlaces", () => {
  assert.equal(textoSinFormato("correo mi_nombre_x@x.com"), "correo mi_nombre_x@x.com");
  assert.equal(textoSinFormato("https://a.com/x_y_z"), "https://a.com/x_y_z");
});

test("una sola linea y sin espacios repetidos", () => {
  assert.equal(textoSinFormato("*Combo*\n\nincluye   envio"), "Combo incluye envio");
});

test("vacio o nulo da texto vacio", () => {
  assert.equal(textoSinFormato(null), "");
  assert.equal(textoSinFormato(undefined), "");
  assert.equal(textoSinFormato("**"), "");
});
