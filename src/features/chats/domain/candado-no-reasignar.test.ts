// Pruebas del candado "No reasignar" (parte 1). Correr: npm run test:no-reasignar
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  HORAS_DEL_CANDADO,
  candadoVigente,
  decidirCambioDelCandado,
  filtrarSinCandado,
  whereSinCandadoVigente,
} from "./candado-no-reasignar";

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

// Parte 2: quién puede prender o apagar el candado.
const decidir = (prender: boolean, userId: string, assignedToUserId: string | null, isManager: boolean) =>
  decidirCambioDelCandado({ prender, userId, assignedToUserId, isManager });

test("prender: solo la asesora asignada", () => {
  assert.equal(decidir(true, "maria", "maria", false), "candado_prendido");
  assert.equal(decidir(true, "maria", "maria", true), "candado_prendido");
  // Otra asesora, o un jefe que no es la asignada, no lo prenden.
  assert.equal(decidir(true, "genesis", "maria", false), null);
  assert.equal(decidir(true, "jefa", "maria", true), null);
});

test("prender: un chat sin asesora no se puede", () => {
  assert.equal(decidir(true, "maria", null, false), null);
  assert.equal(decidir(true, "jefa", null, true), null);
});

test("apagar: la asignada lo apaga, un jefe lo quita, otra asesora no", () => {
  assert.equal(decidir(false, "maria", "maria", false), "candado_apagado");
  assert.equal(decidir(false, "maria", "maria", true), "candado_apagado");
  assert.equal(decidir(false, "jefa", "maria", true), "candado_quitado");
  assert.equal(decidir(false, "jefa", null, true), "candado_quitado");
  assert.equal(decidir(false, "genesis", "maria", false), null);
  assert.equal(decidir(false, "genesis", null, false), null);
});
