// Pruebas de la pantalla Equipo > Asignación (T-772, parte 3). Correr: npm run test:asignacion-pantalla
import assert from "node:assert/strict";
import { test } from "node:test";

import { asesorasDelReparto, pausadosNuevos, validarInterruptores } from "@/lib/asignacion-pantalla";

const activos = new Set(["ana", "bea", "caro", "dani"]);

test("los interruptores: los cuatro, true o false; si falta uno, error y no se guarda", () => {
  assert.deepEqual(
    validarInterruptores({ agentePide: false, clientaPreguntaPlataOEntrega: true, asesoraEscribe: false, comoAntes: true }),
    { ok: true, config: { agentePide: false, clientaPreguntaPlataOEntrega: true, asesoraEscribe: false, comoAntes: true } },
  );
  assert.ok("error" in validarInterruptores({ agentePide: true, clientaPreguntaPlataOEntrega: true, asesoraEscribe: true }));
  assert.ok("error" in validarInterruptores({ agentePide: "true", clientaPreguntaPlataOEntrega: true, asesoraEscribe: true, comoAntes: false }));
  assert.ok("error" in validarInterruptores(null));
  assert.ok("error" in validarInterruptores([]));
});

test("las asesoras de la línea: colaboradoras activas, sin las que solo monitorean", () => {
  const metadata = { collaboratorIds: ["ana", "bea", "caro", "vieja"], monitorIds: ["caro"] };
  assert.deepEqual(asesorasDelReparto(metadata, activos), ["ana", "bea"]);
  assert.deepEqual(asesorasDelReparto({}, activos), []);
  assert.deepEqual(asesorasDelReparto(null, activos), []);
});

test("sacar del reparto pausa sin sacarla de la línea; volver a ponerla la despausa", () => {
  const metadata = { collaboratorIds: ["ana", "bea"], pausedAssignmentIds: [] };
  assert.deepEqual(pausadosNuevos(metadata, activos, ["bea"]), ["bea"]);
  assert.deepEqual(pausadosNuevos({ ...metadata, pausedAssignmentIds: ["bea"] }, activos, []), []);
});

test("sin cambios no hay que escribir", () => {
  const metadata = { collaboratorIds: ["ana", "bea"], pausedAssignmentIds: ["bea"] };
  assert.equal(pausadosNuevos(metadata, activos, ["bea"]), null);
});

test("las monitoras y las inactivas quedan como estaban, y los ids ajenos se ignoran", () => {
  const metadata = {
    collaboratorIds: ["ana", "caro", "vieja"],
    monitorIds: ["caro"],
    pausedAssignmentIds: ["caro", "vieja"],
  };
  // La pantalla no muestra a caro (monitora) ni a vieja (inactiva): aunque no vengan en "fuera", siguen en pausa.
  assert.deepEqual(pausadosNuevos(metadata, activos, ["ana", "intrusa", 42]), ["ana", "caro", "vieja"]);
  assert.equal(pausadosNuevos(metadata, activos, ["intrusa"]), null);
});

test("una línea sin colaboradoras (abierta a todo el equipo) no se toca", () => {
  assert.equal(pausadosNuevos({ collaboratorIds: [] }, activos, ["ana"]), null);
  assert.equal(pausadosNuevos(null, activos, ["ana"]), null);
});
