// Pruebas de la demora de la asesora (partes 1 y 2). Correr: npm run test:demora-asesora
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CONFIG_DEMORA_POR_DEFECTO,
  decidirDemora,
  dentroDeLaFranja,
  elegirAsesoraActiva,
  inicioDeLaFranjaDeHoy,
  inicioDelReloj,
  leerConfigDemoraDeTexto,
  topeDeReasignacionAlcanzado,
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

// --- Parte 2: a quién se le pasa el chat ---

function elegir(extra: Partial<Parameters<typeof elegirAsesoraActiva>[0]> = {}) {
  return elegirAsesoraActiva({
    candidatas: ["ana", "bea", "caro", "dani"],
    ultimoMensajePorAsesora: new Map([
      ["ana", bogota("12:01:00")],
      ["bea", bogota("12:02:00")],
      ["caro", bogota("12:03:00")],
      ["dani", bogota("12:04:00")],
    ]),
    esperandoPorAsesora: new Map(),
    original: "ana",
    segunda: null,
    ...extra,
  });
}

test("nunca elige a la original ni a la segunda", () => {
  // Dani es la más reciente, pero es la original; Caro, la segunda.
  assert.equal(elegir({ original: "dani", segunda: "caro" }), "bea");
  assert.equal(elegir({ candidatas: ["ana", "bea"], original: "ana", segunda: "bea" }), null);
});

test("elige a la de menos chats esperando; si empatan, la que escribió más reciente; después, la rueda", () => {
  const esperandoPorAsesora = new Map([
    ["bea", 1],
    ["caro", 3],
    ["dani", 2],
  ]);
  assert.equal(elegir({ esperandoPorAsesora }), "bea");
  // Empatan en carga: gana la del mensaje más reciente (Dani).
  assert.equal(elegir({ esperandoPorAsesora: new Map([["bea", 1], ["caro", 1], ["dani", 1]]) }), "dani");
  // Empatan en carga y en hora: el orden de la rueda.
  const misma = bogota("12:05:00");
  assert.equal(
    elegir({
      candidatas: ["ana", "caro", "bea"],
      ultimoMensajePorAsesora: new Map([["bea", misma], ["caro", misma]]),
    }),
    "caro",
  );
});

test("sin activa = null (candidata sin mensaje reciente no cuenta)", () => {
  assert.equal(elegir({ ultimoMensajePorAsesora: new Map([["ana", bogota("12:01:00")]]) }), null);
  assert.equal(elegir({ candidatas: [] }), null);
  // Activa pero sin reparto en la línea: tampoco.
  assert.equal(elegir({ candidatas: ["ana"], ultimoMensajePorAsesora: new Map([["zoe", bogota("12:01:00")]]) }), null);
});

test("tope de una reasignación por espera", () => {
  const desde = bogota("12:00:00");
  assert.equal(topeDeReasignacionAlcanzado([], desde), false);
  assert.equal(topeDeReasignacionAlcanzado([bogota("12:10:00")], desde), true);
  // Una reasignación de una espera anterior no cuenta para esta.
  assert.equal(topeDeReasignacionAlcanzado([bogota("11:30:00")], desde), false);
});

test("tras reasignar, el reloj de la nueva arranca en cero", () => {
  // Se reasignó a las 12:10: para la nueva la nota cuenta como su última asignación.
  const ultimaAsignacion = bogota("12:10:00");
  assert.deepEqual(decidir("12:10:00", { ultimaAsignacion }), { tipo: "nada" });
  assert.equal(decidir("12:14:59", { ultimaAsignacion }).tipo, "nada");
  assert.deepEqual(decidir("12:15:00", { ultimaAsignacion }), { tipo: "avisar", inicio: ultimaAsignacion });
  // A los 10 de ella la regla vuelve a decir "reasignar", pero el tope ya se usó: va al dueño.
  assert.equal(decidir("12:20:00", { ultimaAsignacion }).tipo, "reasignar");
  assert.equal(topeDeReasignacionAlcanzado([ultimaAsignacion], bogota("12:00:00")), true);
});
