import assert from "node:assert/strict";
import test from "node:test";

import { METAS_POR_DEFECTO_NOV_2026 } from "./calculo";
import {
  claveDeMetas,
  cruzarConMiembros,
  esMesValido,
  leerMetasDeTexto,
  leerMonto,
  leerPorcentaje,
  mesActualBogota,
  mesAnterior,
  mesEnPalabras,
  metasDesdeFormulario,
  validarMetas,
} from "./metas-guardadas";

test("la clave de la fila es metas-ventas:<negocio>:<AAAA-MM>", () => {
  assert.equal(claveDeMetas("ws_1", "2026-11"), "metas-ventas:ws_1:2026-11");
});

test("el mes actual se toma en hora de Bogotá", () => {
  // 1 de diciembre a las 02:00 UTC todavía es 30 de noviembre en Bogotá.
  assert.equal(mesActualBogota(new Date("2026-12-01T02:00:00Z")), "2026-11");
  assert.equal(mesActualBogota(new Date("2026-12-01T06:00:00Z")), "2026-12");
});

test("mes anterior, cambio de año y mes en palabras", () => {
  assert.equal(mesAnterior("2026-11"), "2026-10");
  assert.equal(mesAnterior("2027-01"), "2026-12");
  assert.equal(mesEnPalabras("2026-11"), "noviembre 2026");
  assert.ok(esMesValido("2026-11"));
  assert.ok(!esMesValido("2026-13"));
  assert.ok(!esMesValido("2026-1"));
  assert.ok(!esMesValido("../x"));
});

test("las metas por defecto pasan la validación y vuelven iguales del JSON", () => {
  const leidas = leerMetasDeTexto(JSON.stringify(METAS_POR_DEFECTO_NOV_2026));
  assert.ok(leidas);
  assert.equal(leidas.asesoras.length, 3);
  assert.equal(leidas.metaEquipo, 55_000_000);
  assert.equal(leidas.porcentajeSobreMeta, 0.2);
});

test("un JSON dañado o con datos fuera de rango se lee como null", () => {
  assert.equal(leerMetasDeTexto("no es json"), null);
  assert.equal(leerMetasDeTexto(null), null);
  assert.equal(validarMetas({ ...METAS_POR_DEFECTO_NOV_2026, porcentajeHastaMeta: 10 }), null);
  assert.equal(validarMetas({ ...METAS_POR_DEFECTO_NOV_2026, bono: -1 }), null);
  assert.equal(
    validarMetas({ ...METAS_POR_DEFECTO_NOV_2026, asesoras: [{ userId: null, nombre: " ", meta: 1, reto: 1 }] }),
    null,
  );
});

test("los nombres por defecto se cruzan con los miembros del negocio", () => {
  const cruzadas = cruzarConMiembros(METAS_POR_DEFECTO_NOV_2026, [
    { userId: "u-yair", nombre: "Yair Gómez" },
    { userId: "u-ingrid", nombre: "ingrid" },
    { userId: "u-maria", nombre: "Maria Camila Pérez" },
    { userId: "u-alex", nombre: "Alexander" },
  ]);
  assert.deepEqual(
    cruzadas.asesoras.map((asesora) => asesora.userId),
    ["u-yair", "u-ingrid", "u-maria"],
  );
});

test("si un nombre coincide con dos miembros no se adivina", () => {
  const cruzadas = cruzarConMiembros(METAS_POR_DEFECTO_NOV_2026, [
    { userId: "u-1", nombre: "Yair Gómez" },
    { userId: "u-2", nombre: "Yair Ruiz" },
  ]);
  assert.equal(cruzadas.asesoras[0].userId, null);
});

test("montos y porcentajes escritos por el dueño", () => {
  assert.equal(leerMonto("25.000.000"), 25_000_000);
  assert.equal(leerMonto("$ 300.000"), 300_000);
  assert.equal(leerMonto("0"), 0);
  assert.equal(leerMonto("-5"), null);
  assert.equal(leerMonto("diez"), null);
  assert.equal(leerMonto(""), null);
  assert.equal(leerPorcentaje("10"), 0.1);
  assert.equal(leerPorcentaje("12,5"), 0.125);
  assert.equal(leerPorcentaje("100"), 1);
  assert.equal(leerPorcentaje("101"), null);
  assert.equal(leerPorcentaje("-1"), null);
});

const formulario = (campos: Record<string, string>) => (nombre: string) => campos[nombre] ?? null;
const camposBuenos = {
  mes: "2026-11",
  cantidadDeAsesoras: "2",
  "asesora.0.userId": "u-yair",
  "asesora.0.nombre": "Yair",
  "asesora.0.nombreEnGestion": "",
  "asesora.0.meta": "25.000.000",
  "asesora.0.reto": "32.500.000",
  "asesora.1.userId": "",
  "asesora.1.nombre": "Ingrid",
  "asesora.1.nombreEnGestion": "Ingrid V.",
  "asesora.1.meta": "20000000",
  "asesora.1.reto": "26000000",
  metaEquipo: "55.000.000",
  minimoEquipo: "30.000.000",
  bono: "300.000",
  porcentajeHastaMeta: "10",
  porcentajeSobreMeta: "20",
};

test("el formulario completo arma las metas con porcentajes entre 0 y 1", () => {
  const resultado = metasDesdeFormulario(formulario(camposBuenos));
  assert.ok(resultado.ok);
  assert.equal(resultado.mes, "2026-11");
  assert.deepEqual(resultado.metas.asesoras[0], {
    userId: "u-yair",
    nombre: "Yair",
    nombreEnGestion: null,
    meta: 25_000_000,
    reto: 32_500_000,
  });
  assert.equal(resultado.metas.asesoras[1].userId, null);
  assert.equal(resultado.metas.asesoras[1].nombreEnGestion, "Ingrid V.");
  assert.equal(resultado.metas.porcentajeHastaMeta, 0.1);
  assert.equal(resultado.metas.porcentajeSobreMeta, 0.2);
  assert.ok(validarMetas(resultado.metas));
});

test("el formulario rechaza números negativos, porcentajes fuera de rango, mes malo y asesoras repetidas", () => {
  const con = (cambios: Record<string, string>) => metasDesdeFormulario(formulario({ ...camposBuenos, ...cambios }));
  assert.equal(con({ "asesora.0.meta": "-1" }).ok, false);
  assert.equal(con({ bono: "-300" }).ok, false);
  assert.equal(con({ porcentajeSobreMeta: "150" }).ok, false);
  assert.equal(con({ mes: "2026-13" }).ok, false);
  assert.equal(con({ "asesora.1.nombre": "" }).ok, false);
  assert.equal(con({ "asesora.1.userId": "u-yair" }).ok, false);
  assert.equal(con({ cantidadDeAsesoras: "99" }).ok, false);
});
