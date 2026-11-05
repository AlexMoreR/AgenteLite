import { test } from "node:test";
import assert from "node:assert/strict";

import { ALTO_DE_FILA, FILAS_DE_MARGEN, calcularVentanaDeLaLista } from "./ventana-de-la-lista";

const TOTAL = 2500;
const ALTO_VISIBLE = 700;
const ALTO_TOTAL = TOTAL * ALTO_DE_FILA;

function sumaDeAltos(ventana: ReturnType<typeof calcularVentanaDeLaLista>) {
  return ventana.espacioArriba + (ventana.fin - ventana.inicio) * ALTO_DE_FILA + ventana.espacioAbajo;
}

test("a) con 2.500 filas se dibujan solo las visibles mas el margen", () => {
  const visibles = Math.ceil(ALTO_VISIBLE / ALTO_DE_FILA);
  const scrollTop = 1000 * ALTO_DE_FILA;
  const ventana = calcularVentanaDeLaLista({ total: TOTAL, scrollTop, altoVisible: ALTO_VISIBLE });
  const dibujadas = ventana.fin - ventana.inicio;
  assert.ok(dibujadas >= visibles, `dibuja ${dibujadas}, se ven ${visibles}`);
  assert.ok(dibujadas <= visibles + 1 + FILAS_DE_MARGEN * 2, `dibuja ${dibujadas}: demasiadas`);
  // La primera fila visible esta dibujada, con margen arriba.
  assert.equal(ventana.inicio, 1000 - FILAS_DE_MARGEN);
  // Y la ultima visible tambien, con margen abajo.
  assert.ok(ventana.fin >= 1000 + visibles + FILAS_DE_MARGEN);
});

test("b) los espacios de arriba y abajo mas las filas dibujadas suman exactamente el alto total", () => {
  for (let scrollTop = -200; scrollTop <= ALTO_TOTAL + 500; scrollTop += 937) {
    const ventana = calcularVentanaDeLaLista({ total: TOTAL, scrollTop, altoVisible: ALTO_VISIBLE });
    assert.equal(sumaDeAltos(ventana), ALTO_TOTAL, `scrollTop ${scrollTop}`);
    assert.ok(ventana.inicio >= 0 && ventana.fin <= TOTAL && ventana.inicio < ventana.fin);
  }
  // Arriba del todo y al fondo de todo.
  const arriba = calcularVentanaDeLaLista({ total: TOTAL, scrollTop: 0, altoVisible: ALTO_VISIBLE });
  assert.equal(arriba.inicio, 0);
  assert.equal(arriba.espacioArriba, 0);
  const fondo = calcularVentanaDeLaLista({ total: TOTAL, scrollTop: ALTO_TOTAL, altoVisible: ALTO_VISIBLE });
  assert.equal(fondo.fin, TOTAL);
  assert.equal(fondo.espacioAbajo, 0);
  assert.equal(sumaDeAltos(fondo), ALTO_TOTAL);
});

test("c) al bajar de a una fila de alto, el inicio de la ventana sube de a una fila", () => {
  let anterior = calcularVentanaDeLaLista({ total: TOTAL, scrollTop: 100 * ALTO_DE_FILA, altoVisible: ALTO_VISIBLE });
  for (let fila = 101; fila < 200; fila += 1) {
    const actual = calcularVentanaDeLaLista({ total: TOTAL, scrollTop: fila * ALTO_DE_FILA, altoVisible: ALTO_VISIBLE });
    assert.equal(actual.inicio, anterior.inicio + 1, `fila ${fila}`);
    assert.equal(actual.espacioArriba, anterior.espacioArriba + ALTO_DE_FILA);
    anterior = actual;
  }
  // Moverse menos de una fila no cambia nada: no hay que re-dibujar la lista.
  const quieta = calcularVentanaDeLaLista({ total: TOTAL, scrollTop: 300 * ALTO_DE_FILA, altoVisible: ALTO_VISIBLE });
  const casi = calcularVentanaDeLaLista({ total: TOTAL, scrollTop: 300 * ALTO_DE_FILA + ALTO_DE_FILA - 1, altoVisible: ALTO_VISIBLE });
  assert.deepEqual(casi, quieta);
});

test("d) con pocas filas se dibujan todas; sin alto medido, solo una pantalla", () => {
  assert.deepEqual(calcularVentanaDeLaLista({ total: 20, scrollTop: 0, altoVisible: ALTO_VISIBLE }), {
    inicio: 0,
    fin: 20,
    espacioArriba: 0,
    espacioAbajo: 0,
  });
  // Sin alto medido todavia (primer dibujo) NO se dibujan las 2.500: se supone una pantalla comun.
  const sinMedir = calcularVentanaDeLaLista({ total: TOTAL, scrollTop: 0, altoVisible: 0 });
  assert.equal(sinMedir.inicio, 0);
  assert.ok(sinMedir.fin < 40, `dibuja ${sinMedir.fin}`);
  assert.equal(sumaDeAltos(sinMedir), ALTO_TOTAL);
  assert.deepEqual(calcularVentanaDeLaLista({ total: 0, scrollTop: 0, altoVisible: ALTO_VISIBLE }), {
    inicio: 0,
    fin: 0,
    espacioArriba: 0,
    espacioAbajo: 0,
  });
});
