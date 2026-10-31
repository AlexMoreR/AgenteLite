import assert from "node:assert/strict";
import test from "node:test";

import { excluidosDelAviso } from "./quien-se-entera-del-mensaje";

// Miembros activos del negocio: dueño (OWNER), administrador (ADMIN), monitora y asesoras.
const dueno = "alex";
const administrador = "admin";
const monitora = "genesis";
const ingrid = "ingrid";
const emanuel = "emanuel";
const miembrosActivos = [dueno, administrador, monitora, ingrid, emanuel];

test("chat asignado a Ingrid: oye solo Ingrid", () => {
  const excluidos = excluidosDelAviso({ miembrosActivos, asignadoA: ingrid });
  assert.deepEqual(excluidos.sort(), [administrador, dueno, emanuel, monitora].sort());
  assert.ok(!excluidos.includes(ingrid));
});

test("a Emanuel, al jefe y a la monitora no les suena un chat ajeno", () => {
  const excluidos = excluidosDelAviso({ miembrosActivos, asignadoA: ingrid });
  assert.ok(excluidos.includes(emanuel));
  assert.ok(excluidos.includes(dueno));
  assert.ok(excluidos.includes(administrador));
  assert.ok(excluidos.includes(monitora));
});

test("chat sin asignar: no le suena a nadie", () => {
  assert.deepEqual(excluidosDelAviso({ miembrosActivos, asignadoA: null }), miembrosActivos);
});

test("chat asignado a alguien que ya no esta activo: no oye nadie mas", () => {
  assert.deepEqual(excluidosDelAviso({ miembrosActivos, asignadoA: "ex-asesora" }), miembrosActivos);
});
