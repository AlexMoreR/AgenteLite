// Pruebas del candado "No reasignar" (parte 1). Correr: npm run test:no-reasignar
import assert from "node:assert/strict";
import { test } from "node:test";

import { HORAS_DEL_CANDADO, candadoVigente, filtrarSinCandado, whereSinCandadoVigente } from "./candado-no-reasignar";

const ahora = new Date("2026-11-13T15:00:00.000Z");
const haceHoras = (horas: number) => new Date(ahora.getTime() - horas * 3_600_000);

test("el candado dura 24 horas", () => {
  assert.equal(HORAS_DEL_CANDADO, 24);
});

test("sin candado da apagado", () => {
  assert.equal(candadoVigente({ noReasignarAt: null, crmStage: "NUEVO" }, ahora), false);
  assert.equal(candadoVigente({ noReasignarAt: undefined }, ahora), false);
});

test("prendido hace 1 h da prendido (Date o texto ISO)", () => {
  assert.equal(candadoVigente({ noReasignarAt: haceHoras(1), crmStage: "CALIFICADO" }, ahora), true);
  assert.equal(candadoVigente({ noReasignarAt: haceHoras(1).toISOString(), crmStage: null }, ahora), true);
});

test("prendido hace 25 h da apagado", () => {
  assert.equal(candadoVigente({ noReasignarAt: haceHoras(25), crmStage: "NUEVO" }, ahora), false);
  assert.equal(candadoVigente({ noReasignarAt: haceHoras(24), crmStage: "NUEVO" }, ahora), false);
});

test("etapa GANADO o PERDIDO da apagado", () => {
  assert.equal(candadoVigente({ noReasignarAt: haceHoras(1), crmStage: "GANADO" }, ahora), false);
  assert.equal(candadoVigente({ noReasignarAt: haceHoras(1), crmStage: "PERDIDO" }, ahora), false);
});

test("una fecha que no se entiende da apagado", () => {
  assert.equal(candadoVigente({ noReasignarAt: "no-es-fecha", crmStage: "NUEVO" }, ahora), false);
});

test("filtrarSinCandado: el vigente queda fuera y el vencido queda dentro", () => {
  const chats = [
    { id: "vigente", noReasignarAt: haceHoras(1), crmStage: "NUEVO" },
    { id: "vencido", noReasignarAt: haceHoras(25), crmStage: "NUEVO" },
    { id: "sin", noReasignarAt: null, crmStage: "NUEVO" },
    { id: "ganado", noReasignarAt: haceHoras(1), crmStage: "GANADO" },
  ];
  assert.deepEqual(
    filtrarSinCandado(chats, ahora).map((chat) => chat.id),
    ["vencido", "sin", "ganado"],
  );
});

test("whereSinCandadoVigente: las tres ramas del OR", () => {
  assert.deepEqual(whereSinCandadoVigente(ahora), {
    OR: [
      { noReasignarAt: null },
      { noReasignarAt: { lt: haceHoras(24) } },
      { contact: { crmStage: { in: ["GANADO", "PERDIDO"] } } },
    ],
  });
});
