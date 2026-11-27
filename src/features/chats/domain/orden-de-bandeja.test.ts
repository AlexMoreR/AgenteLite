// El orden de la bandeja ("recientes" / "antiguos"): como viaja en la direccion y como ordena la lista.
//   npx tsx --test src/features/chats/domain/orden-de-bandeja.test.ts
import assert from "node:assert/strict";
import test from "node:test";

import {
  sortConversationItems,
  updateConversationItemInSortedList,
} from "@/components/chats/chat-inbox-conversation-utils";
import type { SharedInboxConversationItem } from "@/components/chats/chat-inbox-types";
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

// Parte 3: la pantalla. Con antiguos la bandeja prende `ordenDelServidor` (la misma de "Esperando").
const chat = (id: string, minuto: number, extra: Partial<SharedInboxConversationItem> = {}) =>
  ({
    id: `agent:${id}`,
    source: "agent",
    label: id,
    secondaryLabel: "",
    href: "",
    lastMessage: null,
    lastMessageAt: new Date(Date.UTC(2026, 10, 20, 10, minuto)),
    ...extra,
  }) as SharedInboxConversationItem;

test("con ordenDelServidor y antiguos, un mensaje nuevo no mueve el chat", () => {
  // La lista como la manda el servidor con orden=antiguos: el mas viejo primero.
  const lista = [chat("a", 10), chat("b", 20), chat("c", 30)];
  assert.deepEqual(sortConversationItems(lista, { ordenDelServidor: true }).map((i) => i.id), ["agent:a", "agent:b", "agent:c"]);

  // Entra un mensaje en "a" (el mas viejo): queda primero, con el mensaje nuevo.
  const aConMensaje = chat("a", 45, { lastMessage: "hola" });
  const tras = updateConversationItemInSortedList(lista, "a", aConMensaje, { ordenDelServidor: true });
  assert.deepEqual(tras.map((i) => i.id), ["agent:a", "agent:b", "agent:c"]);
  assert.equal(tras[0]?.lastMessage, "hola");

  // Un chat que no esta cargado no entra solo: lo trae el scroll o el refresco.
  const nuevo = chat("z", 50);
  assert.deepEqual(
    updateConversationItemInSortedList(lista, "z", nuevo, { ordenDelServidor: true }).map((i) => i.id),
    ["agent:a", "agent:b", "agent:c"],
  );

  // Sin la bandera (la lista de siempre) el chat con mensaje nuevo sube arriba, como hoy.
  const recientes = [chat("c", 30), chat("b", 20), chat("a", 10)];
  assert.deepEqual(
    updateConversationItemInSortedList(recientes, "a", aConMensaje).map((i) => i.id),
    ["agent:a", "agent:c", "agent:b"],
  );
});
