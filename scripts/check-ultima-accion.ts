import assert from "node:assert/strict";

import { quedarseConLaMasReciente } from "../src/features/actividad/services/ultima-accion";

// Por persona gana la acción más nueva, venga de la fuente que venga.
const t = (iso: string) => new Date(iso);
const salida = quedarseConLaMasReciente([
  { userId: "ana", tipo: "mensaje", cliente: "Salón Rosa", cuando: t("2026-11-24T15:00:00Z") },
  { userId: "ana", tipo: "llamada", cliente: " Spa Luna ", cuando: t("2026-11-24T16:00:00Z") },
  { userId: "ana", tipo: "etapa", cliente: "Barbería X", cuando: t("2026-11-23T10:00:00Z") },
  { userId: "luis", tipo: "asignacion", cliente: null, cuando: t("2026-11-20T10:00:00Z") },
  { userId: "luis", tipo: "mensaje", cliente: "", cuando: t("2026-11-19T10:00:00Z") },
  { userId: null, tipo: "mensaje", cliente: "Nadie", cuando: t("2026-11-24T20:00:00Z") },
  { userId: "eva", tipo: "mensaje", cliente: "Fecha rota", cuando: new Date("x") },
]);

assert.equal(salida.size, 2, "sin userId o con fecha inválida no cuenta");
assert.deepEqual(salida.get("ana"), {
  tipo: "llamada",
  texto: "Llamó",
  cliente: "Spa Luna",
  cuando: t("2026-11-24T16:00:00Z"),
});
assert.equal(salida.get("luis")?.tipo, "asignacion");
assert.equal(salida.get("luis")?.texto, "Asignó un chat");
assert.equal(salida.get("luis")?.cliente, null);
assert.equal(quedarseConLaMasReciente([]).size, 0);
console.log("pruebas de la última acción por persona: OK");
