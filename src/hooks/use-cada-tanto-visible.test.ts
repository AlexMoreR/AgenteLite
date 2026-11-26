import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";

import { empezarCadaTantoVisible } from "./use-cada-tanto-visible";

// Un documento falso: solo lo que usa el reloj (visibilityState y el evento visibilitychange).
function documentoFalso(inicial: DocumentVisibilityState = "visible") {
  const oyentes = new Set<() => void>();
  const doc = {
    visibilityState: inicial,
    addEventListener: (_tipo: string, oyente: () => void) => void oyentes.add(oyente),
    removeEventListener: (_tipo: string, oyente: () => void) => void oyentes.delete(oyente),
  };
  const cambiar = (estado: DocumentVisibilityState) => {
    doc.visibilityState = estado;
    for (const oyente of oyentes) oyente();
  };
  return { doc: doc as unknown as Document, cambiar, oyentes };
}

const MINUTO = 60_000;

beforeEach(() => mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000 }));
afterEach(() => mock.timers.reset());

test("con la pestaña a la vista corre cada tanto, sin correr al empezar", () => {
  const { doc } = documentoFalso();
  let veces = 0;
  const apagar = empezarCadaTantoVisible(doc, () => () => void veces++, MINUTO);
  assert.equal(veces, 0);
  mock.timers.tick(MINUTO);
  assert.equal(veces, 1);
  mock.timers.tick(MINUTO);
  mock.timers.tick(MINUTO);
  assert.equal(veces, 3);
  apagar();
});

test("oculta no corre nada; al volver corre UNA vez si ya tocaba y retoma el ritmo", () => {
  const { doc, cambiar } = documentoFalso();
  let veces = 0;
  const apagar = empezarCadaTantoVisible(doc, () => () => void veces++, MINUTO);
  mock.timers.tick(10_000);
  cambiar("hidden");
  mock.timers.tick(3 * MINUTO);
  assert.equal(veces, 0);
  cambiar("visible");
  assert.equal(veces, 1);
  mock.timers.tick(MINUTO - 1);
  assert.equal(veces, 1);
  mock.timers.tick(1);
  assert.equal(veces, 2);
  apagar();
});

test("al volver antes de tiempo espera solo lo que falta", () => {
  const { doc, cambiar } = documentoFalso();
  let veces = 0;
  const apagar = empezarCadaTantoVisible(doc, () => () => void veces++, MINUTO);
  mock.timers.tick(20_000);
  cambiar("hidden");
  mock.timers.tick(10_000);
  cambiar("visible");
  assert.equal(veces, 0);
  mock.timers.tick(29_999);
  assert.equal(veces, 0);
  mock.timers.tick(1);
  assert.equal(veces, 1);
  apagar();
});

test("cambiar la tarea no reinicia el reloj", () => {
  const { doc } = documentoFalso();
  const corridas: string[] = [];
  let actual = () => void corridas.push("a");
  const apagar = empezarCadaTantoVisible(doc, () => actual, MINUTO);
  mock.timers.tick(30_000);
  actual = () => void corridas.push("b");
  mock.timers.tick(30_000);
  assert.deepEqual(corridas, ["b"]);
  apagar();
});

test("con alEmpezar corre de una; si arranca oculta, corre al volver", () => {
  const visible = documentoFalso();
  let veces = 0;
  const apagar1 = empezarCadaTantoVisible(visible.doc, () => () => void veces++, MINUTO, true);
  assert.equal(veces, 1);
  apagar1();

  const oculta = documentoFalso("hidden");
  let otras = 0;
  const apagar2 = empezarCadaTantoVisible(oculta.doc, () => () => void otras++, MINUTO, true);
  assert.equal(otras, 0);
  oculta.cambiar("visible");
  assert.equal(otras, 1);
  apagar2();
});

test("al apagar quita el oyente y no vuelve a correr", () => {
  const { doc, cambiar, oyentes } = documentoFalso();
  let veces = 0;
  const apagar = empezarCadaTantoVisible(doc, () => () => void veces++, MINUTO);
  apagar();
  assert.equal(oyentes.size, 0);
  mock.timers.tick(5 * MINUTO);
  cambiar("hidden");
  cambiar("visible");
  assert.equal(veces, 0);
});
