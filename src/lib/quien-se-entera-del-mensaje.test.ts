import { test } from "node:test";
import assert from "node:assert/strict";

import { excluidosDelAviso } from "./quien-se-entera-del-mensaje";

// Miembros activos del negocio: dueño, administradora, monitora de la linea y dos asesoras.
const DUENO = "u-dueno";
const ADMIN = "u-admin";
const MONITORA = "u-monitora";
const INGRID = "u-ingrid";
const EMANUEL = "u-emanuel";
const MIEMBROS = [DUENO, ADMIN, MONITORA, INGRID, EMANUEL];

test("chat asignado a Ingrid: solo ella se entera; Emanuel, jefes y monitora quedan fuera", () => {
  const excluidos = excluidosDelAviso(MIEMBROS, INGRID);
  assert.deepEqual([...excluidos].sort(), [ADMIN, DUENO, EMANUEL, MONITORA].sort());
  assert.ok(!excluidos.includes(INGRID));
});

test("chat sin asignar: no se entera nadie", () => {
  assert.deepEqual([...excluidosDelAviso(MIEMBROS, null)].sort(), [...MIEMBROS].sort());
});

test("chat asignado a alguien que ya no esta activo: no se entera nadie mas", () => {
  assert.deepEqual([...excluidosDelAviso(MIEMBROS, "u-que-se-fue")].sort(), [...MIEMBROS].sort());
});
