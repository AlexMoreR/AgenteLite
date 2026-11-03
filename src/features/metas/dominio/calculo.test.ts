import assert from "node:assert/strict";
import test from "node:test";

import {
  AVISO_FALTA_VENDEDORA_O_GANANCIA,
  AVISO_SIN_GESTION,
  METAS_POR_DEFECTO_NOV_2026,
  asignarVentas,
  bonoGanado,
  calcularPanel,
  colorDeAvance,
  comisionPorTramos,
  esperadoALaFecha,
  limpiarNombre,
  type VentaDeGestion,
} from "./calculo";

// 15 de noviembre de 2026 a mediodía en Bogotá (UTC-5).
const QUINCE_DE_NOVIEMBRE = new Date("2026-11-15T17:00:00Z");
const metas = METAS_POR_DEFECTO_NOV_2026;
const fila = (panel: ReturnType<typeof calcularPanel>, nombre: string) => {
  const encontrada = panel.asesoras.find((asesora) => asesora.nombre === nombre);
  assert.ok(encontrada, `no está la fila de ${nombre}`);
  return encontrada;
};

const venta = (datos: Partial<VentaDeGestion> & { monto: number }): VentaDeGestion => ({
  id: datos.id ?? `v-${datos.monto}-${datos.fechaPago ?? ""}`,
  fechaPago: "2026-11-05T15:00:00Z",
  vendedora: "Yair",
  ganancia: datos.monto / 5,
  ...datos,
});

test("Yair vende 20 M con 4 M de ganancia: comisión de 400.000", () => {
  const ventas = [venta({ monto: 20_000_000, ganancia: 4_000_000 })];
  assert.deepEqual(comisionPorTramos(ventas, 25_000_000, 0.1, 0.2), { comision: 400_000, porConfirmar: false });

  const panel = calcularPanel(metas, ventas, QUINCE_DE_NOVIEMBRE);
  const yair = fila(panel, "Yair");
  assert.equal(yair.vendido, 20_000_000);
  assert.equal(yair.falta, 5_000_000);
  assert.equal(yair.comisionEstimada, 400_000);
  assert.equal(yair.porConfirmar, false);
  assert.deepEqual(panel.avisos, []);
});

test("la venta que cruza la meta se reparte entre el 10 % y el 20 %", () => {
  const ventas = [
    venta({ id: "a", monto: 20_000_000, ganancia: 4_000_000, fechaPago: "2026-11-03T15:00:00Z" }),
    // Cruza la meta de 25 M: 5 M quedan bajo la meta (1 M de ganancia al 10 %) y 5 M pasan (1 M al 20 %).
    venta({ id: "b", monto: 10_000_000, ganancia: 2_000_000, fechaPago: "2026-11-10T15:00:00Z" }),
  ];
  assert.equal(comisionPorTramos(ventas, 25_000_000, 0.1, 0.2).comision, 400_000 + 100_000 + 200_000);

  // calcularPanel ordena por fecha de pago antes de calcular: el orden de llegada no cambia el resultado.
  const panel = calcularPanel(metas, [...ventas].reverse(), QUINCE_DE_NOVIEMBRE);
  assert.equal(fila(panel, "Yair").comisionEstimada, 700_000);
  assert.equal(fila(panel, "Yair").falta, 0);
});

test("una ganancia no confiable deja la comisión por confirmar", () => {
  const ventas = [venta({ monto: 1_000_000, ganancia: 200_000, gananciaConfiable: false })];
  assert.deepEqual(comisionPorTramos(ventas, 25_000_000, 0.1, 0.2), { comision: 20_000, porConfirmar: true });
});

test("el bono se gana con 55 M y no con 54,9 M", () => {
  assert.equal(bonoGanado(55_000_000, 55_000_000), true);
  assert.equal(bonoGanado(54_900_000, 55_000_000), false);

  const justo = calcularPanel(metas, [venta({ monto: 55_000_000 })], QUINCE_DE_NOVIEMBRE);
  assert.equal(justo.equipo.bonoGanado, true);
  const casi = calcularPanel(metas, [venta({ monto: 54_900_000 })], QUINCE_DE_NOVIEMBRE);
  assert.equal(casi.equipo.bonoGanado, false);
  assert.equal(casi.equipo.metaSemanal, 13_750_000);
  assert.equal(casi.equipo.minimo, 30_000_000);
});

test("colores en el límite del 100 % y del 80 %", () => {
  assert.equal(colorDeAvance(10_000_000, 10_000_000), "verde");
  assert.equal(colorDeAvance(9_999_999, 10_000_000), "amarillo");
  assert.equal(colorDeAvance(8_000_000, 10_000_000), "amarillo");
  assert.equal(colorDeAvance(7_999_999, 10_000_000), "rojo");
});

test("el 15 de noviembre el esperado es 15/30 de la meta", () => {
  assert.equal(esperadoALaFecha(25_000_000, QUINCE_DE_NOVIEMBRE, "America/Bogota"), 12_500_000);
  // A las 23:00 del 15 en Bogotá ya es 16 en UTC: cuenta el día de Bogotá.
  assert.equal(esperadoALaFecha(30_000_000, new Date("2026-11-16T04:00:00Z")), 15_000_000);
  const panel = calcularPanel(metas, [], QUINCE_DE_NOVIEMBRE);
  assert.equal(fila(panel, "Ingrid").esperado, 10_000_000);
  assert.equal(panel.equipo.esperado, 27_500_000);
});

test("cruce de nombres: tildes, mayúsculas, sin coincidencia y nombreEnGestion", () => {
  assert.equal(limpiarNombre("  María   CAMILA "), "maria camila");
  const asesoras = [
    { userId: "u1", nombre: "María Camila", meta: 10, reto: 15 },
    { userId: "u2", nombre: "Ingrid", nombreEnGestion: "Ingrid Rojas", meta: 20, reto: 26 },
    { userId: "u3", nombre: "Yair", meta: 25, reto: 32 },
  ];
  const ventas = [
    venta({ id: "tildes", monto: 1, vendedora: "Maria Camila" }),
    venta({ id: "mayusculas", monto: 1, vendedora: "YAIR" }),
    venta({ id: "gestion", monto: 1, vendedora: "ingrid  rojas" }),
    venta({ id: "nadie", monto: 1, vendedora: "Pedro" }),
  ];
  const { porAsesora, sinAsignar } = asignarVentas(ventas, asesoras);
  assert.deepEqual(
    porAsesora.map(({ asesora, ventas: suyas }) => [asesora.userId, suyas.map((v) => v.id)]),
    [["u1", ["tildes"]], ["u2", ["gestion"]], ["u3", ["mayusculas"]]],
  );
  assert.deepEqual(sinAsignar.map((v) => v.id), ["nadie"]);
});

test("sin vendedora sale el aviso y la comisión queda en null, no en 0", () => {
  const panel = calcularPanel(
    metas,
    [venta({ id: "1", monto: 5_000_000 }), venta({ id: "2", monto: 3_000_000, vendedora: null })],
    QUINCE_DE_NOVIEMBRE,
  );
  assert.ok(panel.avisos.includes(AVISO_FALTA_VENDEDORA_O_GANANCIA));
  for (const asesora of panel.asesoras) assert.equal(asesora.comisionEstimada, null);
  assert.equal(panel.equipo.total, 8_000_000);
  assert.deepEqual(panel.sinAsignar.map((v) => v.id), ["2"]);
});

test("sin ganancia sale el aviso y la comisión queda en null, no en 0", () => {
  const panel = calcularPanel(metas, [venta({ monto: 5_000_000, ganancia: null })], QUINCE_DE_NOVIEMBRE);
  assert.ok(panel.avisos.includes(AVISO_FALTA_VENDEDORA_O_GANANCIA));
  assert.equal(fila(panel, "Yair").comisionEstimada, null);
  assert.equal(fila(panel, "Yair").vendido, 5_000_000);
});

test("ventas null: aviso de Gestión y nada inventado", () => {
  const panel = calcularPanel(metas, null, QUINCE_DE_NOVIEMBRE);
  assert.deepEqual(panel.avisos, [AVISO_SIN_GESTION]);
  for (const asesora of panel.asesoras) {
    assert.equal(asesora.vendido, null);
    assert.equal(asesora.comisionEstimada, null);
    assert.equal(asesora.color, null);
  }
  assert.equal(panel.equipo.total, null);
  assert.equal(panel.equipo.bonoGanado, null);
});

test("solo cuentan las ventas pagadas en el mes de hoy (hora de Bogotá)", () => {
  const panel = calcularPanel(
    metas,
    [
      venta({ id: "octubre", monto: 9_000_000, fechaPago: "2026-10-31T20:00:00Z" }),
      // 1 de noviembre a las 02:00 UTC es todavía 31 de octubre en Bogotá.
      venta({ id: "octubre-bogota", monto: 9_000_000, fechaPago: "2026-11-01T02:00:00Z" }),
      venta({ id: "noviembre", monto: 1_000_000 }),
    ],
    QUINCE_DE_NOVIEMBRE,
  );
  assert.equal(panel.equipo.total, 1_000_000);
});
