import assert from "node:assert/strict";
import test from "node:test";

import { calcularPanel, type MetasDelMes } from "./calculo";
import { panelPara, ventaDesdeGestion } from "./panel-visible";

const metas: MetasDelMes = {
  asesoras: [
    { userId: "u_yair", nombre: "Yair", meta: 25_000_000, reto: 32_500_000 },
    { userId: "u_ingrid", nombre: "Ingrid", meta: 20_000_000, reto: 26_000_000 },
    { userId: null, nombre: "María Camila", meta: 10_000_000, reto: 15_000_000 },
  ],
  metaEquipo: 55_000_000,
  minimoEquipo: 30_000_000,
  bono: 300_000,
  porcentajeHastaMeta: 0.1,
  porcentajeSobreMeta: 0.2,
};
const hoy = new Date("2026-11-15T15:00:00Z");
const ventas = [
  { id: "1", monto: 4_000_000, fechaPago: "2026-11-03T15:00:00Z", vendedora: "Yair", ganancia: 1_000_000 },
  { id: "2", monto: 3_000_000, fechaPago: "2026-11-04T15:00:00Z", vendedora: "Ingrid", ganancia: 800_000 },
  { id: "3", monto: 1_000_000, fechaPago: "2026-11-05T15:00:00Z", vendedora: "Pedro", ganancia: 200_000 },
];
const panel = calcularPanel(metas, ventas, hoy);

test("el jefe ve todas las filas, el equipo, las ventas sin asignar y puede editar", () => {
  const visto = panelPara(panel, "2026-11", { esJefe: true, userId: "u_jefe" });
  assert.equal(visto.estado, "listo");
  if (visto.estado !== "listo") return;
  assert.equal(visto.puedeEditar, true);
  assert.equal(visto.asesoras.length, 3);
  assert.equal(visto.equipo.total, 8_000_000);
  assert.deepEqual(visto.sinAsignar, { cantidad: 1, monto: 1_000_000 });
});

test("la asesora solo ve su fila y la del equipo, nunca las cifras ni la comisión de las demás", () => {
  const visto = panelPara(panel, "2026-11", { esJefe: false, userId: "u_ingrid" });
  assert.equal(visto.estado, "listo");
  if (visto.estado !== "listo") return;
  assert.equal(visto.puedeEditar, false);
  assert.deepEqual(visto.asesoras.map((fila) => fila.nombre), ["Ingrid"]);
  assert.equal(visto.asesoras[0].vendido, 3_000_000);
  assert.equal(visto.sinAsignar, null);
  assert.equal(visto.equipo.total, 8_000_000);
  const texto = JSON.stringify(visto);
  assert.ok(!texto.includes("Yair") && !texto.includes("u_yair") && !texto.includes("Pedro"));
});

test("una asesora sin meta este mes no ve ninguna fila de asesora, y una fila sin userId no es de nadie", () => {
  const visto = panelPara(panel, "2026-11", { esJefe: false, userId: "u_otra" });
  assert.equal(visto.estado === "listo" && visto.asesoras.length, 0);
});

test("sin Gestión, la asesora ve su fila en blanco con el aviso", () => {
  const visto = panelPara(calcularPanel(metas, null, hoy), "2026-11", { esJefe: false, userId: "u_yair" });
  assert.equal(visto.estado === "listo" && visto.asesoras[0].vendido, null);
  assert.ok(visto.estado === "listo" && visto.avisos.includes("No se pudo leer Gestión"));
});

test("la venta de Gestión lee vendedora, ganancia y ganancia_confiable como opcionales", () => {
  assert.deepEqual(
    ventaDesdeGestion({
      id: 7,
      monto: "1500000",
      pagadaEn: "2026-11-02T10:00:00Z",
      vendedora: " Ingrid ",
      ganancia: 400000,
      ganancia_confiable: false,
    }),
    { id: "7", monto: 1_500_000, fechaPago: "2026-11-02T10:00:00Z", vendedora: "Ingrid", ganancia: 400_000, gananciaConfiable: false },
  );
  assert.deepEqual(ventaDesdeGestion({ id: "8", monto: 100, pagadaEn: "2026-11-02" }), {
    id: "8",
    monto: 100,
    fechaPago: "2026-11-02",
  });
  assert.equal(ventaDesdeGestion({ id: "9", monto: null, pagadaEn: "2026-11-02" }), null);
  assert.equal(ventaDesdeGestion({ monto: 100, pagadaEn: "2026-11-02" }), null);
  assert.equal(ventaDesdeGestion("basura"), null);
  assert.equal(ventaDesdeGestion({ id: "10", monto: 1, pagadaEn: "x", ganancia: "abc" })?.ganancia, undefined);
});
