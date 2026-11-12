// Pruebas del alcance de "No leido" y "Sin responder". Correr: npm run test:pastillas-coinciden
import assert from "node:assert/strict";
import { test } from "node:test";

import { alcanceDeLasPastillas, type RolDeQuienCuenta } from "./alcance-de-las-pastillas";

const jefe: RolDeQuienCuenta = { tipo: "jefe" };
const asesora: RolDeQuienCuenta = { tipo: "asesora" };
const monitora: RolDeQuienCuenta = { tipo: "monitora", lineas: ["linea1", "linea2"] };

test("mine: cuentan los mios", () => {
  assert.deepEqual(alcanceDeLasPastillas("mine", jefe), {
    asignacion: "mine",
    quienes: { tipo: "mios" },
    lineas: null,
  });
});

test("unassigned: cuentan los sin asesora", () => {
  assert.deepEqual(alcanceDeLasPastillas("unassigned", jefe), {
    asignacion: "unassigned",
    quienes: { tipo: "sin_asesora" },
    lineas: null,
  });
});

test("user:<id> con jefe: cuentan los de esa asesora (o esas asesoras)", () => {
  assert.deepEqual(alcanceDeLasPastillas("user:abc123", jefe), {
    asignacion: "user:abc123",
    quienes: { tipo: "asesoras", ids: ["abc123"] },
    lineas: null,
  });
  assert.deepEqual(alcanceDeLasPastillas("user:abc,def", jefe).quienes, { tipo: "asesoras", ids: ["abc", "def"] });
});

test("user:<id> sin jefe: cuentan los mios", () => {
  assert.deepEqual(alcanceDeLasPastillas("user:abc123", asesora), {
    asignacion: "mine",
    quienes: { tipo: "mios" },
    lineas: null,
  });
});

test("user: mal escrito no pasa (queda Todas, igual que /list)", () => {
  assert.equal(alcanceDeLasPastillas("user:", jefe).asignacion, "all");
  assert.equal(alcanceDeLasPastillas("user:a b", jefe).asignacion, "all");
  assert.equal(alcanceDeLasPastillas("user:a;drop", jefe).asignacion, "all");
});

test("all: cuenta todo, como hoy", () => {
  assert.deepEqual(alcanceDeLasPastillas("all", jefe), {
    asignacion: "all",
    quienes: { tipo: "todo" },
    lineas: null,
  });
});

test("sin assigned (pestaña vieja): cuenta todo, como hoy", () => {
  for (const nada of [null, undefined, "", "   ", "cualquiera"]) {
    assert.deepEqual(alcanceDeLasPastillas(nada, jefe), {
      asignacion: "all",
      quienes: { tipo: "todo" },
      lineas: null,
    });
  }
});

test("asesora que no es monitora: siempre los mios", () => {
  for (const pedido of [null, "all", "mine", "unassigned", "user:otra"]) {
    assert.deepEqual(alcanceDeLasPastillas(pedido, asesora), {
      asignacion: "mine",
      quienes: { tipo: "mios" },
      lineas: null,
    });
  }
});

test("monitora: siempre dentro de sus lineas, y respeta la asignacion", () => {
  assert.deepEqual(alcanceDeLasPastillas(null, monitora), {
    asignacion: "all",
    quienes: { tipo: "todo" },
    lineas: ["linea1", "linea2"],
  });
  assert.deepEqual(alcanceDeLasPastillas("mine", monitora), {
    asignacion: "mine",
    quienes: { tipo: "mios" },
    lineas: ["linea1", "linea2"],
  });
  assert.deepEqual(alcanceDeLasPastillas("unassigned", monitora).quienes, { tipo: "sin_asesora" });
  assert.deepEqual(alcanceDeLasPastillas("user:abc", monitora), {
    asignacion: "user:abc",
    quienes: { tipo: "asesoras", ids: ["abc"] },
    lineas: ["linea1", "linea2"],
  });
});
