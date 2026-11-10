// Pruebas de las pastillas de la bandeja (Todas, Mias, No leido). Correr: npm run test:pastillas-bandeja
import assert from "node:assert/strict";
import { test } from "node:test";

import type { FiltrosDeBandeja } from "../../features/chats/domain/filtros-de-bandeja";
import { alTocarPastilla, filtrosParaContar, pastillaMarcada } from "./pastillas-de-la-bandeja";

const NO_LEIDO: FiltrosDeBandeja = { condiciones: [{ campo: "sin_responder", operador: "si" }] };
const DE_UNA_LISTA: FiltrosDeBandeja = {
  condiciones: [
    { campo: "etapa", operador: "es", valores: ["NUEVO"] },
    { campo: "etiquetas", operador: "tiene", valores: ["tag-1"] },
  ],
};
const SIN_NADA: FiltrosDeBandeja = { condiciones: [] };

test("con sin_responder:si puesto, la marcada es No leido (nunca Todas ni Mias)", () => {
  assert.equal(pastillaMarcada({ asignada: "all", filtros: NO_LEIDO, listaActiva: false }), "no_leido");
  assert.equal(pastillaMarcada({ asignada: "mine", filtros: NO_LEIDO, listaActiva: false }), "no_leido");
  assert.equal(pastillaMarcada({ asignada: "all", filtros: NO_LEIDO, listaActiva: true }), "no_leido");
  const conOtra: FiltrosDeBandeja = { condiciones: [...DE_UNA_LISTA.condiciones, ...NO_LEIDO.condiciones] };
  assert.equal(pastillaMarcada({ asignada: "mine", filtros: conOtra, listaActiva: false }), "no_leido");
});

test("sin No leido, la marcada sale de la asignada; con una lista abierta, ninguna", () => {
  assert.equal(pastillaMarcada({ asignada: "all", filtros: SIN_NADA, listaActiva: false }), "todas");
  assert.equal(pastillaMarcada({ asignada: "mine", filtros: SIN_NADA, listaActiva: false }), "mias");
  assert.equal(pastillaMarcada({ asignada: "unassigned", filtros: SIN_NADA, listaActiva: false }), null);
  assert.equal(pastillaMarcada({ asignada: "all", filtros: DE_UNA_LISTA, listaActiva: true }), null);
  // sin_responder:no no es No leido.
  const noEsNoLeido: FiltrosDeBandeja = { condiciones: [{ campo: "sin_responder", operador: "no" }] };
  assert.equal(pastillaMarcada({ asignada: "all", filtros: noEsNoLeido, listaActiva: false }), "todas");
});

test("tocar Todas o Mias quita sin_responder:si", () => {
  const conOtra: FiltrosDeBandeja = { condiciones: [...DE_UNA_LISTA.condiciones, ...NO_LEIDO.condiciones] };
  const todas = alTocarPastilla("todas", { asignada: "mine", filtros: conOtra, listaActiva: false, esJefe: true });
  assert.deepEqual(todas, { asignada: "all", filtros: DE_UNA_LISTA });
  const mias = alTocarPastilla("mias", { asignada: "all", filtros: NO_LEIDO, listaActiva: false, esJefe: true });
  assert.deepEqual(mias, { asignada: "mine", filtros: SIN_NADA });
  // La asesora en No leido vuelve a Mias.
  const asesora = alTocarPastilla("mias", { asignada: "mine", filtros: NO_LEIDO, listaActiva: false, esJefe: false });
  assert.deepEqual(asesora, { asignada: "mine", filtros: SIN_NADA });
});

test("tocar Todas o Mias con una lista abierta la cierra", () => {
  const todas = alTocarPastilla("todas", { asignada: "all", filtros: DE_UNA_LISTA, listaActiva: true, esJefe: true });
  assert.deepEqual(todas, { asignada: "all", filtros: SIN_NADA });
});

test("tocar No leido con una lista abierta deja solo sin_responder:si", () => {
  const jefe = alTocarPastilla("no_leido", { asignada: "unassigned", filtros: DE_UNA_LISTA, listaActiva: true, esJefe: true });
  assert.deepEqual(jefe, { asignada: "all", filtros: NO_LEIDO });
  const asesora = alTocarPastilla("no_leido", { asignada: "mine", filtros: DE_UNA_LISTA, listaActiva: true, esJefe: false });
  assert.deepEqual(asesora, { asignada: "mine", filtros: NO_LEIDO });
  // Una sin_responder:no se reemplaza (las dos juntas no darian nada).
  const conNo: FiltrosDeBandeja = { condiciones: [{ campo: "sin_responder", operador: "no" }] };
  const desdeNo = alTocarPastilla("no_leido", { asignada: "mine", filtros: conNo, listaActiva: false, esJefe: true });
  assert.deepEqual(desdeNo, { asignada: "all", filtros: NO_LEIDO });
});

test("tocar la ya marcada devuelve el mismo estado: nunca quedan todas sin marcar", () => {
  const casos = [
    { pastilla: "todas", estado: { asignada: "all", filtros: SIN_NADA, listaActiva: false, esJefe: true } },
    { pastilla: "mias", estado: { asignada: "mine", filtros: SIN_NADA, listaActiva: false, esJefe: false } },
    { pastilla: "no_leido", estado: { asignada: "all", filtros: NO_LEIDO, listaActiva: false, esJefe: true } },
    { pastilla: "no_leido", estado: { asignada: "mine", filtros: NO_LEIDO, listaActiva: false, esJefe: false } },
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
    { asignada: "mine", filtros: NO_LEIDO, listaActiva: false, esJefe: true },
    { asignada: "unassigned", filtros: DE_UNA_LISTA, listaActiva: true, esJefe: true },
  ] as const;
  for (const estado of estados) {
    for (const pastilla of ["todas", "mias", "no_leido"] as const) {
      const nuevo = alTocarPastilla(pastilla, estado);
      const listaSigue = estado.listaActiva && nuevo.filtros === estado.filtros;
      assert.equal(pastillaMarcada({ ...nuevo, listaActiva: listaSigue }), pastilla);
    }
  }
});

test("filtrosParaContar quita sin_responder:si y conserva el resto", () => {
  const conTodo: FiltrosDeBandeja = {
    condiciones: [DE_UNA_LISTA.condiciones[0], ...NO_LEIDO.condiciones, DE_UNA_LISTA.condiciones[1]],
  };
  assert.deepEqual(filtrosParaContar(conTodo), DE_UNA_LISTA);
  assert.deepEqual(filtrosParaContar(NO_LEIDO), SIN_NADA);
  assert.deepEqual(filtrosParaContar(DE_UNA_LISTA), DE_UNA_LISTA);
  const conNo: FiltrosDeBandeja = { condiciones: [{ campo: "sin_responder", operador: "no" }] };
  assert.deepEqual(filtrosParaContar(conNo), conNo);
  // No cambia el objeto que recibe.
  assert.equal(conTodo.condiciones.length, 3);
});
