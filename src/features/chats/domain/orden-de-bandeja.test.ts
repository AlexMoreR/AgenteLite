// El orden de la bandeja ("recientes" / "antiguos"): como viaja en la direccion y como ordena la lista.
//   npx tsx --test src/features/chats/domain/orden-de-bandeja.test.ts
import assert from "node:assert/strict";
import test from "node:test";

import { dedupeAndSortConversationListRows, sortConversationListRows } from "@/lib/chat-conversation-list";
import { hayFiltrosPuestos, leerFiltrosDeBandeja, paramsDeFiltros } from "./filtros-de-bandeja";

const leerDe = (texto: string) => {
  const params = new URLSearchParams(texto);
  return (clave: string) => params.get(clave);
};

test("orden=antiguos se lee de la direccion", () => {
  assert.deepEqual(leerFiltrosDeBandeja(leerDe("orden=antiguos")), { condiciones: [], orden: "antiguos" });
  assert.equal(leerFiltrosDeBandeja(leerDe("orden=antiguos&grupo=equipo")).orden, "antiguos");
});

test("sin orden, o con otro valor, queda como hoy (sin el campo)", () => {
  assert.deepEqual(leerFiltrosDeBandeja(leerDe("")), { condiciones: [] });
  assert.deepEqual(leerFiltrosDeBandeja(leerDe("orden=recientes")), { condiciones: [] });
  assert.deepEqual(leerFiltrosDeBandeja(leerDe("orden=cualquiera")), { condiciones: [] });
  assert.deepEqual(leerFiltrosDeBandeja(leerDe("grupo=equipo")), { condiciones: [], grupo: "equipo" });
});

test("paramsDeFiltros escribe orden=antiguos solo con antiguos", () => {
  assert.deepEqual(paramsDeFiltros({ condiciones: [], orden: "antiguos" }), [["orden", "antiguos"]]);
  assert.deepEqual(paramsDeFiltros({ condiciones: [], orden: "recientes" }), []);
  assert.deepEqual(paramsDeFiltros({ condiciones: [] }), []);
  // Ida y vuelta.
  const pares = paramsDeFiltros(leerFiltrosDeBandeja(leerDe("grupo=equipo&orden=antiguos")));
  assert.deepEqual(pares, [["grupo", "equipo"], ["orden", "antiguos"]]);
});

test("el orden no es un filtro: hayFiltrosPuestos no lo cuenta", () => {
  assert.equal(hayFiltrosPuestos({ condiciones: [], orden: "antiguos" }), false);
  assert.equal(hayFiltrosPuestos(leerFiltrosDeBandeja(leerDe("orden=antiguos"))), false);
});

const fila = (id: string, minuto: number | null) => ({
  source: "agent" as const,
  conversationId: id,
  lastMessageAt: minuto === null ? null : new Date(Date.UTC(2026, 10, 20, 10, minuto)),
});

test("sortConversationListRows: sin orden y recientes, el mas nuevo primero", () => {
  const filas = [fila("b", 20), fila("a", 10), fila("c", 30)];
  assert.deepEqual(sortConversationListRows(filas).map((f) => f.conversationId), ["c", "b", "a"]);
  assert.deepEqual(sortConversationListRows(filas, "recientes").map((f) => f.conversationId), ["c", "b", "a"]);
});

test("sortConversationListRows: antiguos, el mas viejo primero", () => {
  const filas = [fila("b", 20), fila("a", 10), fila("c", 30)];
  assert.deepEqual(sortConversationListRows(filas, "antiguos").map((f) => f.conversationId), ["a", "b", "c"]);
  // No cambia la lista que recibe.
  assert.deepEqual(filas.map((f) => f.conversationId), ["b", "a", "c"]);
});

test("dedupeAndSortConversationListRows pasa el orden", () => {
  const filas = [fila("b", 20), fila("a", 10), fila("c", 30)];
  assert.deepEqual(dedupeAndSortConversationListRows(filas).map((f) => f.conversationId), ["c", "b", "a"]);
  assert.deepEqual(dedupeAndSortConversationListRows(filas, "antiguos").map((f) => f.conversationId), ["a", "b", "c"]);
});
