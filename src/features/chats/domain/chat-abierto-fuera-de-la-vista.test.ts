// Pruebas del chat abierto que no cumple el filtro. Correr: npm run test:pastillas-coinciden
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  debeMarcarseFueraDeLaVista,
  dentroDeLaVista,
  filasVisibles,
} from "./chat-abierto-fuera-de-la-vista";

type Fila = { id: string; fueraDeLaVista?: boolean };

test("el chat abierto que no cumple el filtro queda marcado y no sale en filasVisibles", () => {
  const marcado = debeMarcarseFueraDeLaVista({ vinoEnLaTanda: false, cumpleElFiltro: false });
  assert.equal(marcado, true);

  const filas: Fila[] = [
    { id: "agent:573196892277", fueraDeLaVista: marcado },
    { id: "agent:a", fueraDeLaVista: false },
    { id: "agent:b" },
  ];
  assert.deepEqual(
    filasVisibles(filas).map((fila) => fila.id),
    ["agent:a", "agent:b"],
  );
});

test("si cumple el filtro sale, aunque no haya venido en la tanda (el chat viejo de Mi dia sigue primero)", () => {
  const marcado = debeMarcarseFueraDeLaVista({ vinoEnLaTanda: false, cumpleElFiltro: true });
  assert.equal(marcado, false);

  const filas: Fila[] = [
    { id: "agent:viejo", fueraDeLaVista: marcado },
    { id: "agent:a", fueraDeLaVista: false },
  ];
  assert.deepEqual(
    filasVisibles(filas).map((fila) => fila.id),
    ["agent:viejo", "agent:a"],
  );
});

test("si vino en la tanda nunca se marca", () => {
  assert.equal(debeMarcarseFueraDeLaVista({ vinoEnLaTanda: true, cumpleElFiltro: false }), false);
  assert.equal(debeMarcarseFueraDeLaVista({ vinoEnLaTanda: true, cumpleElFiltro: true }), false);
});

test("una fila que llega de /list borra la marca", () => {
  const antes: Fila = { id: "agent:x", fueraDeLaVista: true };
  assert.deepEqual(filasVisibles([antes]), []);

  const deList = dentroDeLaVista<Fila>({ id: "agent:x" });
  assert.equal(deList.fueraDeLaVista, false);
  // Al pisar la fila vieja con la de /list, la marca se va.
  const pisada = { ...antes, ...deList };
  assert.deepEqual(filasVisibles([pisada]).map((fila) => fila.id), ["agent:x"]);
});
