import { test } from "node:test";
import assert from "node:assert/strict";

import { quitarArchivo } from "./quitar-archivo-de-la-vista-previa";

const ocho = ["f0", "f1", "f2", "f3", "f4", "f5", "f6", "f7"];

test("a) quitar el índice 2 de 8 deja 7 en el mismo orden y sin ese archivo", () => {
  const resultado = quitarArchivo(ocho, 2, 0);
  assert.deepEqual(resultado.archivos, ["f0", "f1", "f3", "f4", "f5", "f6", "f7"]);
  assert.equal(resultado.archivos.length, 7);
  assert.ok(!resultado.archivos.includes("f2"));
  // La grande (f0) no cambia.
  assert.equal(resultado.activo, 0);
  // No toca la lista original.
  assert.equal(ocho.length, 8);
});

test("b) quitar una del medio cuando la grande está después: la grande sigue siendo la misma", () => {
  const resultado = quitarArchivo(ocho, 2, 5);
  assert.equal(resultado.archivos[resultado.activo], "f5");
});

test("c) quitar la grande cuando está en medio muestra la siguiente", () => {
  const resultado = quitarArchivo(ocho, 3, 3);
  assert.equal(resultado.archivos.length, 7);
  assert.equal(resultado.archivos[resultado.activo], "f4");
});

test("d) quitar la última cuando es la grande deja la grande en la nueva última", () => {
  const resultado = quitarArchivo(ocho, 7, 7);
  assert.equal(resultado.archivos.length, 7);
  assert.equal(resultado.activo, 6);
  assert.equal(resultado.archivos[resultado.activo], "f6");
});

test("e) quitar de una lista de 1 deja la lista vacía", () => {
  const resultado = quitarArchivo(["solo"], 0, 0);
  assert.deepEqual(resultado.archivos, []);
  assert.equal(resultado.activo, 0);
});

test("f) un índice que no existe no cambia nada", () => {
  for (const indice of [-1, 8, 99, 1.5, Number.NaN]) {
    const resultado = quitarArchivo(ocho, indice, 4);
    assert.deepEqual(resultado.archivos, ocho);
    assert.equal(resultado.activo, 4);
  }
});

test("g) quitar todas una por una deja la lista vacía", () => {
  let estado = { archivos: [...ocho], activo: 0 };
  while (estado.archivos.length > 0) estado = quitarArchivo(estado.archivos, estado.activo, estado.activo);
  assert.deepEqual(estado.archivos, []);
});
