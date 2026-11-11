import { test } from "node:test";
import assert from "node:assert/strict";

import { acomodarListaQuieta } from "./lista-quieta";

type Fila = { id: string; texto?: string };

const filas = (...ids: string[]): Fila[] => ids.map((id) => ({ id }));
const ids = (lista: Fila[]) => lista.map((fila) => fila.id);

test("a) sin cambios se dibuja la lista nueva tal cual", () => {
  const resultado = acomodarListaQuieta(filas("A", "B", "C"), filas("A", "B", "C"));
  assert.deepEqual(ids(resultado.filas), ["A", "B", "C"]);
  assert.equal(resultado.hayCambios, false);
});

test("b) un chat que sube queda en su lugar y avisa", () => {
  const resultado = acomodarListaQuieta(filas("A", "B", "C"), [{ id: "C", texto: "nuevo" }, { id: "A" }, { id: "B" }]);
  assert.deepEqual(ids(resultado.filas), ["A", "B", "C"]);
  // El texto si se actualiza, en su lugar.
  assert.equal(resultado.filas[2].texto, "nuevo");
  assert.equal(resultado.hayCambios, true);
});

test("c) un chat nuevo arriba no se inserta", () => {
  const resultado = acomodarListaQuieta(filas("A", "B"), filas("N", "A", "B"));
  assert.deepEqual(ids(resultado.filas), ["A", "B"]);
  assert.equal(resultado.hayCambios, true);
});

test("d) un chat que se fue se queda con lo ultimo que se supo", () => {
  const base: Fila[] = [{ id: "A" }, { id: "B", texto: "viejo" }, { id: "C" }];
  const resultado = acomodarListaQuieta(base, filas("A", "C"));
  assert.deepEqual(ids(resultado.filas), ["A", "B", "C"]);
  assert.equal(resultado.filas[1].texto, "viejo");
  assert.equal(resultado.hayCambios, true);
});

test("e) la pagina siguiente se agrega al final sin contar como cambio", () => {
  const resultado = acomodarListaQuieta(filas("A", "B"), filas("A", "B", "C", "D"));
  assert.deepEqual(ids(resultado.filas), ["A", "B", "C", "D"]);
  assert.equal(resultado.hayCambios, false);
  assert.equal(resultado.agregadasAlFinal, 2);
});

test("f) pagina siguiente y un chat que sube a la vez", () => {
  const resultado = acomodarListaQuieta(filas("A", "B", "C"), filas("C", "A", "B", "D"));
  assert.deepEqual(ids(resultado.filas), ["A", "B", "C", "D"]);
  assert.equal(resultado.hayCambios, true);
  assert.equal(resultado.agregadasAlFinal, 1);
});

test("g) si la lista se reemplazo entera no se agrega nada", () => {
  const resultado = acomodarListaQuieta(filas("A", "B"), filas("X", "Y"));
  assert.deepEqual(ids(resultado.filas), ["A", "B"]);
  assert.equal(resultado.hayCambios, true);
  assert.equal(resultado.agregadasAlFinal, 0);
});
