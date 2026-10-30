import assert from "node:assert/strict";
import test from "node:test";
import {
  clasificarGesto,
  desplazamientoDelSwipe,
  swipeAlcanzaUmbral,
  SWIPE_REPLY_MAX_OFFSET,
  SWIPE_REPLY_THRESHOLD,
} from "./use-swipe-to-reply";

test("deslizar a la derecha mas alla del umbral cuenta como responder", () => {
  assert.equal(clasificarGesto(70, 4), "horizontal");
  assert.equal(swipeAlcanzaUmbral(SWIPE_REPLY_THRESHOLD), true);
  assert.equal(swipeAlcanzaUmbral(120), true);
});

test("deslizar poco no dispara nada", () => {
  assert.equal(swipeAlcanzaUmbral(SWIPE_REPLY_THRESHOLD - 1), false);
  assert.equal(clasificarGesto(4, 2), "indeciso");
});

test("un movimiento vertical es scroll", () => {
  assert.equal(clasificarGesto(5, 40), "vertical");
  assert.equal(clasificarGesto(30, 30), "vertical");
});

test("hacia la izquierda no es responder", () => {
  assert.equal(clasificarGesto(-60, 2), "vertical");
  assert.equal(desplazamientoDelSwipe(-30), 0);
});

test("la burbuja no se aleja mas del maximo", () => {
  assert.equal(desplazamientoDelSwipe(500), SWIPE_REPLY_MAX_OFFSET);
  assert.equal(desplazamientoDelSwipe(25), 25);
});
