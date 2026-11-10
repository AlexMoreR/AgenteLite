// Pruebas de las pastillas de la bandeja (Todas, Mias, Sin responder). Correr: npm run test:pastillas-bandeja
import assert from "node:assert/strict";
import { test } from "node:test";

import type { FiltrosDeBandeja } from "../../features/chats/domain/filtros-de-bandeja";
import { alTocarPastilla, filtrosParaContar, pastillaMarcada } from "./pastillas-de-la-bandeja";

const SIN_RESPONDER: FiltrosDeBandeja = { condiciones: [{ campo: "sin_responder", operador: "si" }] };
const DE_UNA_LISTA: FiltrosDeBandeja = {
  condiciones: [
    { campo: "etapa", operador: "es", valores: ["NUEVO"] },
    { campo: "etiquetas", operador: "tiene", valores: ["tag-1"] },
  ],
};
const SIN_NADA: FiltrosDeBandeja = { condiciones: [] };

test("con sin_responder:si puesto, la marcada es Sin responder (nunca Todas ni Mias)", () => {
  assert.equal(pastillaMarcada({ asignada: "all", filtros: SIN_RESPONDER, listaActiva: false }), "sin_responder");
  assert.equal(pastillaMarcada({ asignada: "mine", filtros: SIN_RESPONDER, listaActiva: false }), "sin_responder");
  assert.equal(pastillaMarcada({ asignada: "all", filtros: SIN_RESPONDER, listaActiva: true }), "sin_responder");
  const conOtra: FiltrosDeBandeja = { condiciones: [...DE_UNA_LISTA.condiciones, ...SIN_RESPONDER.condiciones] };
  assert.equal(pastillaMarcada({ asignada: "mine", filtros: conOtra, listaActiva: false }), "sin_responder");
});

test("sin Sin responder, la marcada sale de la asignada; con una lista abierta, ninguna", () => {
  assert.equal(pastillaMarcada({ asignada: "all", filtros: SIN_NADA, listaActiva: false }), "todas");
  assert.equal(pastillaMarcada({ asignada: "mine", filtros: SIN_NADA, listaActiva: false }), "mias");
  assert.equal(pastillaMarcada({ asignada: "unassigned", filtros: SIN_NADA, listaActiva: false }), null);
  assert.equal(pastillaMarcada({ asignada: "all", filtros: DE_UNA_LISTA, listaActiva: true }), null);
  // sin_responder:no no es Sin responder.
  const noEsSinResponder: FiltrosDeBandeja = { condiciones: [{ campo: "sin_responder", operador: "no" }] };
  assert.equal(pastillaMarcada({ asignada: "all", filtros: noEsSinResponder, listaActiva: false }), "todas");
});

test("tocar Todas o Mias quita sin_responder:si", () => {
  const conOtra: FiltrosDeBandeja = { condiciones: [...DE_UNA_LISTA.condiciones, ...SIN_RESPONDER.condiciones] };
  const todas = alTocarPastilla("todas", { asignada: "mine", filtros: conOtra, listaActiva: false, esJefe: true });
  assert.deepEqual(todas, { asignada: "all", filtros: DE_UNA_LISTA });
  const mias = alTocarPastilla("mias", { asignada: "all", filtros: SIN_RESPONDER, listaActiva: false, esJefe: true });
  assert.deepEqual(mias, { asignada: "mine", filtros: SIN_NADA });
  // La asesora en Sin responder vuelve a Mias.
  const asesora = alTocarPastilla("mias", { asignada: "mine", filtros: SIN_RESPONDER, listaActiva: false, esJefe: false });
  assert.deepEqual(asesora, { asignada: "mine", filtros: SIN_NADA });
});

test("tocar Todas o Mias con una lista abierta la cierra", () => {
  const todas = alTocarPastilla("todas", { asignada: "all", filtros: DE_UNA_LISTA, listaActiva: true, esJefe: true });
  assert.deepEqual(todas, { asignada: "all", filtros: SIN_NADA });
});

test("tocar Sin responder con una lista abierta deja solo sin_responder:si", () => {
  const jefe = alTocarPastilla("sin_responder", { asignada: "unassigned", filtros: DE_UNA_LISTA, listaActiva: true, esJefe: true });
  assert.deepEqual(jefe, { asignada: "all", filtros: SIN_RESPONDER });
  const asesora = alTocarPastilla("sin_responder", { asignada: "mine", filtros: DE_UNA_LISTA, listaActiva: true, esJefe: false });
  assert.deepEqual(asesora, { asignada: "mine", filtros: SIN_RESPONDER });
  // Una sin_responder:no se reemplaza (las dos juntas no darian nada).
  const conNo: FiltrosDeBandeja = { condiciones: [{ campo: "sin_responder", operador: "no" }] };
  const desdeNo = alTocarPastilla("sin_responder", { asignada: "mine", filtros: conNo, listaActiva: false, esJefe: true });
  assert.deepEqual(desdeNo, { asignada: "all", filtros: SIN_RESPONDER });
});

test("tocar la ya marcada devuelve el mismo estado: nunca quedan todas sin marcar", () => {
  const casos = [
    { pastilla: "todas", estado: { asignada: "all", filtros: SIN_NADA, listaActiva: false, esJefe: true } },
    { pastilla: "mias", estado: { asignada: "mine", filtros: SIN_NADA, listaActiva: false, esJefe: false } },
    { pastilla: "sin_responder", estado: { asignada: "all", filtros: SIN_RESPONDER, listaActiva: false, esJefe: true } },
    { pastilla: "sin_responder", estado: { asignada: "mine", filtros: SIN_RESPONDER, listaActiva: false, esJefe: false } },
  ] as const;
  for (const { pastilla, estado } of casos) {
    const nuevo = alTocarPastilla(pastilla, estado);
    assert.deepEqual(nuevo, { asignada: estado.asignada, filtros: estado.filtros });
    assert.equal(pastillaMarcada({ ...nuevo, listaActiva: estado.listaActiva }), pastilla);
  }
});

test("despues de tocar cualquier pastilla queda marcada esa", () => {
  const estados = [
    { asignada: "all", filtros: SIN_NADA, listaActiva: false, esJefe: true },
    { asignada: "mine", filtros: SIN_RESPONDER, listaActiva: false, esJefe: true },
    { asignada: "unassigned", filtros: DE_UNA_LISTA, listaActiva: true, esJefe: true },
  ] as const;
  for (const estado of estados) {
    for (const pastilla of ["todas", "mias", "sin_responder"] as const) {
      const nuevo = alTocarPastilla(pastilla, estado);
      const listaSigue = estado.listaActiva && nuevo.filtros === estado.filtros;
      assert.equal(pastillaMarcada({ ...nuevo, listaActiva: listaSigue }), pastilla);
    }
  }
});

test("filtrosParaContar quita sin_responder:si y conserva el resto", () => {
  const conTodo: FiltrosDeBandeja = {
    condiciones: [DE_UNA_LISTA.condiciones[0], ...SIN_RESPONDER.condiciones, DE_UNA_LISTA.condiciones[1]],
  };
  assert.deepEqual(filtrosParaContar(conTodo), DE_UNA_LISTA);
  assert.deepEqual(filtrosParaContar(SIN_RESPONDER), SIN_NADA);
  assert.deepEqual(filtrosParaContar(DE_UNA_LISTA), DE_UNA_LISTA);
  const conNo: FiltrosDeBandeja = { condiciones: [{ campo: "sin_responder", operador: "no" }] };
  assert.deepEqual(filtrosParaContar(conNo), conNo);
  // No cambia el objeto que recibe.
  assert.equal(conTodo.condiciones.length, 3);
});

test("filtrosParaContar quita tambien no_leido:si (No leido tiene su propio numero)", () => {
  const conLasDos: FiltrosDeBandeja = {
    condiciones: [{ campo: "no_leido", operador: "si" }, ...SIN_RESPONDER.condiciones, DE_UNA_LISTA.condiciones[0]],
  };
  assert.deepEqual(filtrosParaContar(conLasDos), { condiciones: [DE_UNA_LISTA.condiciones[0]] });
  // No leido no es Sin responder: no marca esa pastilla.
  assert.equal(
    pastillaMarcada({ asignada: "all", filtros: { condiciones: [{ campo: "no_leido", operador: "si" }] }, listaActiva: false }),
    "todas",
  );
});
