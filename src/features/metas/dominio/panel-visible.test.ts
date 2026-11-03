import assert from "node:assert/strict";
import test from "node:test";

import { AVISO_FALTA_VENDEDORA_O_GANANCIA, AVISO_SIN_GESTION, METAS_POR_DEFECTO_NOV_2026, calcularPanel } from "./calculo";
import { leerVentasDeLaRespuesta, recortarPanel } from "./panel-visible";

const QUINCE_DE_NOVIEMBRE = new Date("2026-11-15T17:00:00Z");
// Noviembre de 2026 en hora de Colombia, como lo arma `limitesDelRango("2026-11-01", "2026-11-30")`.
const NOVIEMBRE = { desdeFecha: new Date("2026-11-01T00:00:00-05:00"), hastaFecha: new Date("2026-12-01T00:00:00-05:00") };

const metas = {
  ...METAS_POR_DEFECTO_NOV_2026,
  asesoras: METAS_POR_DEFECTO_NOV_2026.asesoras.map((asesora, indice) => ({ ...asesora, userId: `u${indice + 1}` })),
};

test("leerVentasDeLaRespuesta: lee los opcionales y salta lo que no se puede contar", () => {
  const ventas = leerVentasDeLaRespuesta(
    {
      ventas: [
        { id: 1, monto: "1000000", pagadaEn: "2026-11-03T15:00:00Z", vendedora: " Ingrid ", ganancia: 300000, ganancia_confiable: false },
        { id: "2", monto: 500000, pagadaEn: "2026-11-04T15:00:00Z" },
        { id: "3", monto: null, pagadaEn: "2026-11-04T15:00:00Z" },
        { monto: 1, pagadaEn: "2026-11-04T15:00:00Z" },
        { id: "4", monto: 2, pagadaEn: "2026-10-31T23:00:00-05:00" },
        { id: "5", monto: 3, pagadaEn: "no-es-fecha" },
        null,
      ],
    },
    NOVIEMBRE,
  );
  assert.deepEqual(ventas, [
    { id: "1", monto: 1_000_000, fechaPago: "2026-11-03T15:00:00Z", vendedora: "Ingrid", ganancia: 300_000, gananciaConfiable: false },
    { id: "2", monto: 500_000, fechaPago: "2026-11-04T15:00:00Z", vendedora: null, ganancia: null },
    { id: "5", monto: 3, fechaPago: "no-es-fecha", vendedora: null, ganancia: null },
  ]);
});

test("leerVentasDeLaRespuesta: sin lista es null", () => {
  assert.equal(leerVentasDeLaRespuesta({}, NOVIEMBRE), null);
  assert.equal(leerVentasDeLaRespuesta(null, NOVIEMBRE), null);
  assert.deepEqual(leerVentasDeLaRespuesta({ ventas: [] }, NOVIEMBRE), []);
});

const ventas = [
  { id: "a", monto: 5_000_000, fechaPago: "2026-11-02T15:00:00Z", vendedora: "Yair", ganancia: 1_000_000 },
  { id: "b", monto: 2_000_000, fechaPago: "2026-11-03T15:00:00Z", vendedora: "Ingrid", ganancia: 400_000 },
  { id: "c", monto: 1_000_000, fechaPago: "2026-11-04T15:00:00Z", vendedora: "Pedro", ganancia: 100_000 },
];

test("recortarPanel: la asesora ve solo su fila y la del equipo, sin ventas sin asignar", () => {
  const visible = recortarPanel(calcularPanel(metas, ventas, QUINCE_DE_NOVIEMBRE), "2026-11", { esJefe: false, userId: "u2" });
  assert.equal(visible.estado, "listo");
  if (visible.estado !== "listo") return;
  assert.deepEqual(visible.asesoras.map((fila) => fila.nombre), ["Ingrid"]);
  assert.equal(visible.asesoras[0].comisionEstimada, 40_000);
  assert.equal(visible.equipo.total, 8_000_000);
  assert.equal(visible.sinAsignar, null);
  assert.equal(visible.puedeEditar, false);
  // Nada de las demás viaja en lo que se muestra.
  assert.ok(!JSON.stringify(visible).includes("Yair"));
  assert.ok(!JSON.stringify(visible).includes("Pedro"));
});

test("recortarPanel: sin userId en la meta, la asesora no ve ninguna fila", () => {
  const sinIds = { ...metas, asesoras: metas.asesoras.map((asesora) => ({ ...asesora, userId: null })) };
  const visible = recortarPanel(calcularPanel(sinIds, ventas, QUINCE_DE_NOVIEMBRE), "2026-11", { esJefe: false, userId: "u2" });
  assert.equal(visible.estado === "listo" && visible.asesoras.length, 0);
});

test("recortarPanel: el jefe ve todas, las sin asignar y puede editar", () => {
  const visible = recortarPanel(calcularPanel(metas, ventas, QUINCE_DE_NOVIEMBRE), "2026-11", { esJefe: true, userId: "dueno" });
  assert.equal(visible.estado, "listo");
  if (visible.estado !== "listo") return;
  assert.equal(visible.asesoras.length, 3);
  assert.deepEqual(visible.sinAsignar, { cuantas: 1, monto: 1_000_000, vendedoras: ["Pedro"] });
  assert.equal(visible.puedeEditar, true);
  assert.deepEqual(visible.avisos, []);
});

test("recortarPanel: sin Gestión sale el aviso y sin cifras", () => {
  const visible = recortarPanel(calcularPanel(metas, null, QUINCE_DE_NOVIEMBRE), "2026-11", { esJefe: false, userId: "u1" });
  assert.equal(visible.estado, "listo");
  if (visible.estado !== "listo") return;
  assert.deepEqual(visible.avisos, [AVISO_SIN_GESTION]);
  assert.equal(visible.asesoras[0].vendido, null);
  assert.equal(visible.equipo.total, null);
});

test("recortarPanel: sin vendedora sale el aviso y la comisión queda por confirmar", () => {
  const sinVendedora = [...ventas, { id: "d", monto: 100, fechaPago: "2026-11-05T15:00:00Z", ganancia: 10 }];
  const visible = recortarPanel(calcularPanel(metas, sinVendedora, QUINCE_DE_NOVIEMBRE), "2026-11", { esJefe: false, userId: "u1" });
  assert.equal(visible.estado, "listo");
  if (visible.estado !== "listo") return;
  assert.deepEqual(visible.avisos, [AVISO_FALTA_VENDEDORA_O_GANANCIA]);
  assert.equal(visible.asesoras[0].comisionEstimada, null);
});
