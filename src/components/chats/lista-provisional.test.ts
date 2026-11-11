// Pruebas de la lista provisional al cambiar de pastilla. Correr: npm run test:velocidad-chat
import assert from "node:assert/strict";
import { test } from "node:test";

import type { CondicionDeBandeja } from "@/features/chats/domain/filtros-de-bandeja";
import { listaProvisional, type VistaDestino } from "./lista-provisional";

type Fila = { id: string; assignedToUserId?: string | null; incomingCount?: number | null; sinResponderDesde?: string | null };

const TODAS: Fila[] = [
  { id: "a", assignedToUserId: "ingrid", incomingCount: 2, sinResponderDesde: "2026-11-10T10:00:00Z" },
  { id: "b", assignedToUserId: "maria", incomingCount: 0, sinResponderDesde: null },
  { id: "c", assignedToUserId: null, incomingCount: 1, sinResponderDesde: null },
  { id: "d", assignedToUserId: "ingrid", incomingCount: 0, sinResponderDesde: "2026-11-10T09:00:00Z" },
];
const NO_LEIDO: CondicionDeBandeja = { campo: "no_leido", operador: "si" } as CondicionDeBandeja;
const SIN_RESPONDER: CondicionDeBandeja = { campo: "sin_responder", operador: "si" } as CondicionDeBandeja;

const vista = (cambios: Partial<VistaDestino>): VistaDestino => ({
  asignada: "all",
  estado: "open",
  condiciones: [],
  espera: false,
  busqueda: "",
  ...cambios,
});
const ids = (filas: Fila[] | null) => (filas ? filas.map((fila) => fila.id) : null);
const soloTodas = (asignada: "all" | "mine") => (asignada === "all" ? TODAS : undefined);

test("Mías sale de Todas con las de quien mira, en el mismo orden", () => {
  assert.deepEqual(ids(listaProvisional(vista({ asignada: "mine" }), "ingrid", soloTodas)), ["a", "d"]);
});

test("No leído y Sin responder salen de Todas", () => {
  assert.deepEqual(ids(listaProvisional(vista({ condiciones: [NO_LEIDO] }), "ingrid", soloTodas)), ["a", "c"]);
  assert.deepEqual(ids(listaProvisional(vista({ condiciones: [SIN_RESPONDER] }), "ingrid", soloTodas)), ["a", "d"]);
});

test("Mías + No leído prefiere la lista guardada de Mías", () => {
  const mias: Fila[] = [{ id: "x", assignedToUserId: "ingrid", incomingCount: 3 }];
  const leer = (asignada: "all" | "mine") => (asignada === "mine" ? mias : TODAS);
  assert.deepEqual(ids(listaProvisional(vista({ asignada: "mine", condiciones: [NO_LEIDO] }), "ingrid", leer)), ["x"]);
});

test("Sin asignar y una asesora salen de Todas", () => {
  assert.deepEqual(ids(listaProvisional(vista({ asignada: "unassigned" }), "ingrid", soloTodas)), ["c"]);
  assert.deepEqual(ids(listaProvisional(vista({ asignada: "user:maria" }), "ingrid", soloTodas)), ["b"]);
});

test("lo que no se puede saber con la fila espera al servidor", () => {
  const etapa = { campo: "etapa", operador: "es", valores: ["NUEVO"] } as CondicionDeBandeja;
  assert.equal(listaProvisional(vista({ condiciones: [etapa] }), "ingrid", soloTodas), null);
  assert.equal(listaProvisional(vista({ estado: "closed" }), "ingrid", soloTodas), null);
  assert.equal(listaProvisional(vista({ espera: true }), "ingrid", soloTodas), null);
  assert.equal(listaProvisional(vista({ busqueda: "ana" }), "ingrid", soloTodas), null);
  assert.equal(listaProvisional(vista({}), "ingrid", soloTodas), null, "Todas sin condiciones no se deriva");
});

test("sin la lista base, o Mías sin saber quien mira, no hay provisional", () => {
  assert.equal(listaProvisional(vista({ asignada: "mine" }), "ingrid", () => undefined), null);
  assert.equal(listaProvisional(vista({ asignada: "mine" }), null, soloTodas), null);
});

test("vacia tambien vale: dice al instante que no hay", () => {
  const sinNada: Fila[] = [{ id: "z", incomingCount: 0 }];
  assert.deepEqual(ids(listaProvisional(vista({ condiciones: [NO_LEIDO] }), "ingrid", () => sinNada)), []);
});
