import assert from "node:assert/strict";
import test from "node:test";

import { cortarTexto, jsonSeguro, textoSeguro } from "./json-seguro";

test("cortarTexto no parte un emoji por la mitad", () => {
  const texto = "a".repeat(79) + "😀 resto";
  const cortado = cortarTexto(texto, 80);
  assert.equal(cortado, "a".repeat(79));
  assert.equal(texto.slice(0, 80).length, 80); // el slice normal sí deja un surrogate suelto
});

test("textoSeguro quita nulos y surrogates sueltos y deja los emojis completos", () => {
  assert.equal(textoSeguro("hola\u0000 mundo"), "hola mundo");
  assert.equal(textoSeguro("x\ud83d"), "x");
  assert.equal(textoSeguro("\ude00y"), "y");
  assert.equal(textoSeguro("ok 😀 ñ"), "ok 😀 ñ");
});

test("jsonSeguro limpia a cualquier profundidad y el resultado es JSON válido para Postgres", () => {
  const sucio = { motivo: "a\u0000b", senales: [{ tipo: "x", fragmento: "z".repeat(79) + "😀".slice(0, 1) }], n: 3, nulo: null, ok: true };
  const limpio = jsonSeguro(sucio);
  assert.equal(limpio.motivo, "ab");
  assert.equal(limpio.senales[0].fragmento, "z".repeat(79));
  assert.equal(limpio.n, 3);
  assert.equal(limpio.nulo, null);
  assert.ok(!JSON.stringify(limpio).includes("\u0000"));
  assert.equal(textoSeguro(JSON.stringify(limpio)), JSON.stringify(limpio));
});
