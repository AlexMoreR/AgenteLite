// Pruebas de lo que cuentan "No leido" y "Sin responder". Correr: npm run test:pastillas-coinciden
import assert from "node:assert/strict";
import { test } from "node:test";

import { alcanceDeLasPastillas, type QuienPideLasPastillas } from "./alcance-de-las-pastillas";

const JEFE: QuienPideLasPastillas = { tipo: "jefe" };
const ASESORA: QuienPideLasPastillas = { tipo: "asesora" };
const MONITORA: QuienPideLasPastillas = { tipo: "monitora", lineas: ["linea1", "linea2"] };

test("jefe con Mias: solo los suyos", () => {
  assert.deepEqual(alcanceDeLasPastillas("mine", JEFE), {
    asignacion: { tipo: "mios" },
    lineas: null,
    asignacionOficial: "mine",
  });
});

test("jefe con Sin asignar: solo los que no tienen asesora", () => {
  assert.deepEqual(alcanceDeLasPastillas("unassigned", JEFE), {
    asignacion: { tipo: "sinAsesora" },
    lineas: null,
    asignacionOficial: "unassigned",
  });
});

test("jefe con una o varias asesoras: los de ellas", () => {
  assert.deepEqual(alcanceDeLasPastillas("user:abc123", JEFE), {
    asignacion: { tipo: "asesoras", ids: ["abc123"] },
    lineas: null,
    asignacionOficial: "user:abc123",
  });
  assert.deepEqual(alcanceDeLasPastillas("user:abc,def", JEFE).asignacion, { tipo: "asesoras", ids: ["abc", "def"] });
});

test("asesora que pide otra asesora: los suyos (no se espian chats ajenos)", () => {
  assert.deepEqual(alcanceDeLasPastillas("user:otra", ASESORA), {
    asignacion: { tipo: "mios" },
    lineas: null,
    asignacionOficial: "mine",
  });
});

test("un user: mal escrito no se entiende: cuenta todo, como /list", () => {
  assert.equal(alcanceDeLasPastillas("user:", JEFE).asignacion.tipo, "todo");
  assert.equal(alcanceDeLasPastillas("user:a b", JEFE).asignacion.tipo, "todo");
  assert.equal(alcanceDeLasPastillas("user:a'--", JEFE).asignacion.tipo, "todo");
});

test("Todas o sin assigned: todo lo que ve, como hoy", () => {
  const todo = { asignacion: { tipo: "todo" }, lineas: null, asignacionOficial: "all" };
  assert.deepEqual(alcanceDeLasPastillas("all", JEFE), todo);
  assert.deepEqual(alcanceDeLasPastillas(null, JEFE), todo);
  assert.deepEqual(alcanceDeLasPastillas(undefined, JEFE), todo);
  assert.deepEqual(alcanceDeLasPastillas("", JEFE), todo);
});

test("la asesora que no es monitora: siempre los suyos", () => {
  for (const pedido of ["all", "mine", "unassigned", "user:abc", null]) {
    assert.deepEqual(alcanceDeLasPastillas(pedido, ASESORA), {
      asignacion: { tipo: "mios" },
      lineas: null,
      asignacionOficial: "mine",
    });
  }
});

test("la monitora: siempre dentro de sus lineas, con la asignacion puesta", () => {
  assert.deepEqual(alcanceDeLasPastillas(null, MONITORA), {
    asignacion: { tipo: "todo" },
    lineas: ["linea1", "linea2"],
    asignacionOficial: "all",
  });
  assert.deepEqual(alcanceDeLasPastillas("all", MONITORA).lineas, ["linea1", "linea2"]);
  assert.deepEqual(alcanceDeLasPastillas("unassigned", MONITORA), {
    asignacion: { tipo: "sinAsesora" },
    lineas: ["linea1", "linea2"],
    asignacionOficial: "unassigned",
  });
  assert.deepEqual(alcanceDeLasPastillas("mine", MONITORA).lineas, ["linea1", "linea2"]);
  assert.deepEqual(alcanceDeLasPastillas("user:abc", MONITORA), {
    asignacion: { tipo: "asesoras", ids: ["abc"] },
    lineas: ["linea1", "linea2"],
    asignacionOficial: "user:abc",
  });
});
