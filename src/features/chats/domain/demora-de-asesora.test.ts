// Pruebas de la demora de la asesora (partes 1 y 2). Correr: npm run test:demora-asesora
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CONFIG_DEMORA_POR_DEFECTO,
  ORIGEN_REASIGNACION_POR_DEMORA,
  accionAlReasignar,
  elegirAsesoraActiva,
  textoDeReasignacion,
  decidirDemora,
  dentroDeLaFranja,
  inicioDeLaFranjaDeHoy,
  inicioDelReloj,
  leerConfigDemoraDeTexto,
} from "./demora-de-asesora";

const prendida = leerConfigDemoraDeTexto(JSON.stringify({ activo: true }));
/** Una hora de Bogotá (UTC-5) del 8-nov-2026, en ms. */
const bogota = (hora: string) => Date.parse(`2026-11-08T${hora}-05:00`);

// Mediodía: el cliente escribió a las 12:00, la regla se prendió a las 9:00, sin nota de asignación.
function decidir(ahora: string, extra: Partial<Parameters<typeof decidirDemora>[0]> = {}) {
  return decidirDemora({
    config: prendida,
    desde: bogota("12:00:00"),
    ultimaAsignacion: null,
    arranque: bogota("09:00:00"),
    ahora: new Date(bogota(ahora)),
    ...extra,
  });
}

test("a las 4:59 no avisa", () => {
  assert.deepEqual(decidir("12:04:59"), { tipo: "nada" });
});

test("a las 5:00 avisa", () => {
  assert.deepEqual(decidir("12:05:00"), { tipo: "avisar", inicio: bogota("12:00:00") });
});

test("a las 10:00 reasigna", () => {
  assert.deepEqual(decidir("12:10:00"), { tipo: "reasignar", inicio: bogota("12:00:00") });
  assert.equal(decidir("12:09:59").tipo, "avisar");
});

test("config rota o sin fila = apagado", () => {
  assert.equal(leerConfigDemoraDeTexto("{no es json").activo, false);
  assert.equal(leerConfigDemoraDeTexto(null).activo, false);
  assert.equal(leerConfigDemoraDeTexto("[]").activo, false);
  assert.deepEqual(leerConfigDemoraDeTexto(undefined), CONFIG_DEMORA_POR_DEFECTO);
  const apagada = leerConfigDemoraDeTexto("{roto");
  assert.deepEqual(decidir("13:00:00", { config: apagada }), { tipo: "nada" });
});

test("la config trae 5, 10 y 10 por defecto y respeta los valores válidos", () => {
  assert.deepEqual(prendida, { activo: true, minutosAviso: 5, minutosReasignar: 10, minutosActiva: 10 });
  const propia = leerConfigDemoraDeTexto(JSON.stringify({ activo: "true", minutosAviso: 3, minutosReasignar: 1, minutosActiva: -2 }));
  assert.deepEqual(propia, { activo: true, minutosAviso: 3, minutosReasignar: 3, minutosActiva: 10 });
});

test("el reloj cuenta desde la última asignación a esa asesora", () => {
  const ultimaAsignacion = bogota("12:03:00");
  assert.equal(decidir("12:07:59", { ultimaAsignacion }).tipo, "nada");
  assert.deepEqual(decidir("12:08:00", { ultimaAsignacion }), { tipo: "avisar", inicio: ultimaAsignacion });
});

test("una espera de antes de prender la regla no avisa", () => {
  assert.equal(decidir("13:00:00", { arranque: bogota("12:30:00") }).tipo, "nada");
});

test("fuera de la franja (antes de 7:00 o desde las 23:00) no hace nada", () => {
  assert.equal(dentroDeLaFranja(new Date(bogota("06:59:00"))), false);
  assert.equal(dentroDeLaFranja(new Date(bogota("07:00:00"))), true);
  assert.equal(dentroDeLaFranja(new Date(bogota("22:59:00"))), true);
  assert.equal(dentroDeLaFranja(new Date(bogota("23:00:00"))), false);
  const deNoche = { desde: bogota("01:00:00"), arranque: bogota("00:00:00") };
  assert.equal(decidir("06:30:00", deNoche).tipo, "nada");
  assert.equal(decidir("23:30:00", { desde: bogota("22:00:00") }).tipo, "nada");
});

test("en la mañana el reloj arranca de nuevo a las 7:00", () => {
  assert.equal(inicioDeLaFranjaDeHoy(new Date(bogota("15:42:31"))), bogota("07:00:00"));
  const deNoche = { desde: bogota("01:00:00"), arranque: bogota("00:00:00") };
  assert.equal(decidir("07:04:59", deNoche).tipo, "nada");
  assert.deepEqual(decidir("07:05:00", deNoche), { tipo: "avisar", inicio: bogota("07:00:00") });
});

test("inicioDelReloj toma el mayor de los cuatro", () => {
  const ahora = new Date(bogota("18:00:00"));
  const base = { desde: bogota("10:00:00"), ultimaAsignacion: null, arranque: bogota("08:00:00"), ahora };
  assert.equal(inicioDelReloj(base), bogota("10:00:00"));
  assert.equal(inicioDelReloj({ ...base, ultimaAsignacion: bogota("11:00:00") }), bogota("11:00:00"));
  assert.equal(inicioDelReloj({ ...base, arranque: bogota("12:00:00") }), bogota("12:00:00"));
  assert.equal(inicioDelReloj({ ...base, desde: bogota("05:00:00"), arranque: bogota("04:00:00") }), bogota("07:00:00"));
});

// --- Parte 2: la reasignación ---

const activas = (pares: Record<string, string>) =>
  new Map(Object.entries(pares).map(([id, hora]) => [id, bogota(hora)]));
const esperando = (pares: Record<string, number>) => new Map(Object.entries(pares));

const base = {
  candidatas: ["ana", "bea", "caro", "dani"],
  ultimoMensajePorAsesora: activas({ ana: "12:01:00", bea: "12:02:00", caro: "12:03:00", dani: "12:04:00" }),
  esperandoPorAsesora: esperando({}),
  original: "ana",
  segunda: "bea",
};

test("nunca elige a la original ni a la segunda", () => {
  // La original y la segunda son las de menos espera, y aun así no salen.
  const elegida = elegirAsesoraActiva({
    ...base,
    esperandoPorAsesora: esperando({ ana: 0, bea: 0, caro: 5, dani: 5 }),
  });
  assert.equal(elegida, "dani");
  assert.equal(elegirAsesoraActiva({ ...base, candidatas: ["ana", "bea"] }), null);
});

test("gana la de menos chats esperando; si empatan, la del mensaje más reciente; luego la rueda", () => {
  assert.equal(elegirAsesoraActiva({ ...base, esperandoPorAsesora: esperando({ caro: 1, dani: 3 }) }), "caro");
  // Empate en espera: la que escribió más reciente (dani a las 12:04).
  assert.equal(elegirAsesoraActiva({ ...base, esperandoPorAsesora: esperando({ caro: 2, dani: 2 }) }), "dani");
  // Empate total: la primera de la rueda.
  const iguales = activas({ caro: "12:03:00", dani: "12:03:00" });
  assert.equal(elegirAsesoraActiva({ ...base, ultimoMensajePorAsesora: iguales }), "caro");
  assert.equal(
    elegirAsesoraActiva({ ...base, candidatas: ["ana", "dani", "caro"], ultimoMensajePorAsesora: iguales }),
    "dani",
  );
});

test("solo cuentan las activas; sin ninguna, null", () => {
  // caro es candidata pero no escribió en los últimos minutos.
  assert.equal(elegirAsesoraActiva({ ...base, ultimoMensajePorAsesora: activas({ ana: "12:00:00", dani: "11:59:00" }) }), "dani");
  assert.equal(elegirAsesoraActiva({ ...base, ultimoMensajePorAsesora: activas({ ana: "12:00:00" }) }), null);
  assert.equal(elegirAsesoraActiva({ ...base, candidatas: [] }), null);
  assert.deepEqual(accionAlReasignar({ ...base, candidatas: [], reasignacionesEnEstaEspera: 0 }), {
    tipo: "avisar-jefes",
    motivo: "sin-activa",
  });
});

test("tope de una reasignación por espera: a la segunda se avisa y no se mueve", () => {
  assert.deepEqual(accionAlReasignar({ ...base, reasignacionesEnEstaEspera: 0 }), { tipo: "reasignar", a: "dani" });
  assert.deepEqual(accionAlReasignar({ ...base, reasignacionesEnEstaEspera: 1 }), { tipo: "avisar-jefes", motivo: "tope" });
  assert.deepEqual(accionAlReasignar({ ...base, reasignacionesEnEstaEspera: 2 }), { tipo: "avisar-jefes", motivo: "tope" });
});

test("tras reasignar, el reloj de la nueva arranca en cero", () => {
  // Reasignado a las 12:10 (la nota es la última asignación a la nueva).
  const ultimaAsignacion = bogota("12:10:00");
  assert.equal(decidir("12:10:00", { ultimaAsignacion }).tipo, "nada");
  assert.equal(decidir("12:14:59", { ultimaAsignacion }).tipo, "nada");
  assert.deepEqual(decidir("12:15:00", { ultimaAsignacion }), { tipo: "avisar", inicio: ultimaAsignacion });
  assert.deepEqual(decidir("12:20:00", { ultimaAsignacion }), { tipo: "reasignar", inicio: ultimaAsignacion });
});

test("la nota de la reasignación", () => {
  assert.equal(ORIGEN_REASIGNACION_POR_DEMORA, "reasignacion-por-demora");
  assert.equal(textoDeReasignacion("Ana", "Dani", 10), "Reasignado de Ana a Dani por no responder en 10 min");
});
