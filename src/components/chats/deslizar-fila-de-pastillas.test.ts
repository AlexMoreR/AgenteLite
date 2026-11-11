import assert from "node:assert/strict";
import { test } from "node:test";

import { esArrastre, filaDesborda, movimientoDeLaRueda, UMBRAL_DE_ARRASTRE_PX } from "./deslizar-fila-de-pastillas";

// Una fila de 300 px de ancho con 800 px de pastillas: se puede mover hasta 500.
const ANCHA = { scrollWidth: 800, clientWidth: 300 };

test("(a) rueda hacia abajo con la fila al inicio: se mueve 100 a la derecha y frena la pagina", () => {
  assert.deepEqual(movimientoDeLaRueda({ deltaX: 0, deltaY: 100 }, { ...ANCHA, scrollLeft: 0 }), {
    mover: 100,
    frenarPagina: true,
  });
});

test("(b) en el extremo derecho, rueda hacia abajo: no se mueve y NO frena la pagina", () => {
  assert.deepEqual(movimientoDeLaRueda({ deltaX: 0, deltaY: 100 }, { ...ANCHA, scrollLeft: 500 }), {
    mover: 0,
    frenarPagina: false,
  });
  // Un scrollLeft con decimales en el extremo tambien cuenta como extremo.
  assert.equal(movimientoDeLaRueda({ deltaX: 0, deltaY: 100 }, { ...ANCHA, scrollLeft: 499.5 }).frenarPagina, false);
});

test("en el extremo izquierdo, rueda hacia arriba: no frena la pagina", () => {
  assert.deepEqual(movimientoDeLaRueda({ deltaX: 0, deltaY: -100 }, { ...ANCHA, scrollLeft: 0 }), {
    mover: 0,
    frenarPagina: false,
  });
});

test("cerca del extremo solo se mueve lo que falta", () => {
  assert.deepEqual(movimientoDeLaRueda({ deltaX: 0, deltaY: 100 }, { ...ANCHA, scrollLeft: 450 }), {
    mover: 50,
    frenarPagina: true,
  });
  assert.deepEqual(movimientoDeLaRueda({ deltaX: 0, deltaY: -100 }, { ...ANCHA, scrollLeft: 30 }), {
    mover: -30,
    frenarPagina: true,
  });
});

test("(c) con deltaX mayor que deltaY manda deltaX (touchpad o rueda lateral)", () => {
  assert.deepEqual(movimientoDeLaRueda({ deltaX: 40, deltaY: 10 }, { ...ANCHA, scrollLeft: 100 }), {
    mover: 40,
    frenarPagina: true,
  });
  assert.deepEqual(movimientoDeLaRueda({ deltaX: -40, deltaY: 10 }, { ...ANCHA, scrollLeft: 100 }), {
    mover: -40,
    frenarPagina: true,
  });
  // Con deltaY mayor, manda deltaY.
  assert.equal(movimientoDeLaRueda({ deltaX: 10, deltaY: 40 }, { ...ANCHA, scrollLeft: 100 }).mover, 40);
});

test("(d) si la fila cabe entera nunca frena la pagina", () => {
  for (const deltaY of [-100, -1, 0, 1, 100]) {
    for (const deltaX of [-50, 0, 50]) {
      const resultado = movimientoDeLaRueda({ deltaX, deltaY }, { scrollLeft: 0, scrollWidth: 300, clientWidth: 300 });
      assert.deepEqual(resultado, { mover: 0, frenarPagina: false });
    }
  }
  assert.equal(filaDesborda({ scrollWidth: 300, clientWidth: 300 }), false);
  assert.equal(filaDesborda({ scrollWidth: 301, clientWidth: 300 }), false);
  assert.equal(filaDesborda(ANCHA), true);
});

test("rueda en lineas (deltaMode 1) se pasa a pixeles", () => {
  assert.equal(movimientoDeLaRueda({ deltaX: 0, deltaY: 3, deltaMode: 1 }, { ...ANCHA, scrollLeft: 0 }).mover, 48);
});

test("una rueda en cero no mueve ni frena", () => {
  assert.deepEqual(movimientoDeLaRueda({ deltaX: 0, deltaY: 0 }, { ...ANCHA, scrollLeft: 100 }), {
    mover: 0,
    frenarPagina: false,
  });
});

test("(e) 5 px o menos no es arrastre; mas de 5 px si", () => {
  assert.equal(UMBRAL_DE_ARRASTRE_PX, 5);
  for (const px of [0, 1, 4, 5, -5, -3]) assert.equal(esArrastre(px), false, `${px} px`);
  for (const px of [5.5, 6, 20, -6, -100]) assert.equal(esArrastre(px), true, `${px} px`);
});
