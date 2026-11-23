import { test } from "node:test";
import assert from "node:assert/strict";

import { areasParaMover, esTipoArea, filtrarAreas } from "./areas-para-mover";

const tipos = new Map([
  ["area", { id: "area", nombre: "Área", padres: ["area"] }],
  ["idea", { id: "idea", nombre: "Idea", padres: ["area"] }],
  ["tarea", { id: "tarea", nombre: "Tarea", padres: ["idea", "area"] }],
  ["cambio", { id: "cambio", nombre: "Cambio", padres: [] }],
]);

const tarjetas = [
  { id: "empresa", titulo: "Empresa", tipoId: "area", padreId: null },
  { id: "ventas", titulo: "Ventas", tipoId: "area", padreId: "empresa" },
  { id: "chats", titulo: "Chats", tipoId: "area", padreId: "ventas" },
  { id: "gestion", titulo: "Gestión", tipoId: "area", padreId: null },
  { id: "idea1", titulo: "Una idea", tipoId: "idea", padreId: "ventas" },
  { id: "t871", titulo: "Descuento en SAL-96", tipoId: "tarea", padreId: "idea1" },
];

test("reconoce el tipo Área con o sin tilde", () => {
  assert.equal(esTipoArea("Área"), true);
  assert.equal(esTipoArea(" area "), true);
  assert.equal(esTipoArea("Áreas"), false);
});

test("una tarea ve todas las Áreas, con la ruta de arriba, y no las Ideas", () => {
  const areas = areasParaMover(tarjetas[5], tarjetas, tipos);
  assert.deepEqual(
    areas.map((area) => [area.titulo, area.ruta, area.actual]),
    [
      ["Empresa", "", false],
      ["Ventas", "Empresa", false],
      ["Chats", "Empresa › Ventas", false],
      ["Gestión", "", false],
    ],
  );
});

test("marca el Área donde ya está", () => {
  const idea = tarjetas[4];
  assert.equal(areasParaMover(idea, tarjetas, tipos).find((area) => area.actual)?.id, "ventas");
});

test("un Área no se puede mover dentro de sí misma ni de lo que cuelga de ella", () => {
  const ids = areasParaMover(tarjetas[1], tarjetas, tipos).map((area) => area.id);
  assert.deepEqual(ids.sort(), ["empresa", "gestion"]);
});

test("un tipo que no acepta Áreas como madre no ve ninguna", () => {
  assert.deepEqual(areasParaMover({ id: "c", titulo: "c", tipoId: "cambio", padreId: null }, tarjetas, tipos), []);
});

test("el buscador ignora tildes y mira también la ruta", () => {
  const areas = areasParaMover(tarjetas[5], tarjetas, tipos);
  assert.deepEqual(filtrarAreas(areas, "gestion").map((area) => area.id), ["gestion"]);
  assert.deepEqual(filtrarAreas(areas, "ventas").map((area) => area.id), ["ventas", "chats"]);
  assert.equal(filtrarAreas(areas, "  ").length, 4);
});
