import assert from "node:assert/strict";
import { test } from "node:test";
import { quedaContenidoALaDerecha } from "./use-hay-mas-a-la-derecha";

test("todo entra: no hay nada a la derecha", () => {
  assert.equal(quedaContenidoALaDerecha(0, 360, 360), false);
});

test("hay botones escondidos a la derecha al empezar", () => {
  assert.equal(quedaContenidoALaDerecha(0, 360, 520), true);
});

test("deslizada hasta el final: ya no hay mas", () => {
  assert.equal(quedaContenidoALaDerecha(160, 360, 520), false);
});

test("anchos con decimales: medio pixel de diferencia no cuenta", () => {
  assert.equal(quedaContenidoALaDerecha(159.5, 360, 520), false);
  assert.equal(quedaContenidoALaDerecha(158, 360, 520), true);
});
