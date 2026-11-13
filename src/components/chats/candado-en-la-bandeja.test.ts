import assert from "node:assert/strict";
import test from "node:test";

import {
  areConversationListItemsEqual,
  areSelectedConversationsEqual,
  buildConversationItemFromListSnapshot,
  buildConversationItemFromSnapshot,
  mergeConversationListItem,
} from "./chat-inbox-conversation-utils";
import type {
  LiveConversationListSnapshot,
  LiveConversationSnapshot,
  SharedInboxConversationItem,
  SharedInboxSelectedConversation,
} from "./chat-inbox-types";

// El candado "No reasignar" (parte 3) viaja con la fila y con el chat abierto, y prenderlo o
// apagarlo cambia la fila sin recargar. Una actualizacion que no lo trae (undefined) no lo borra.

const PRENDIDO = "2026-11-13T10:00:00.000Z";

const fila: SharedInboxConversationItem = {
  id: "agent:c1",
  source: "agent",
  label: "Cliente",
  secondaryLabel: "573000000000",
  lastMessage: "hola",
  href: "/cliente/chats?chatKey=agent:c1",
  assignedToUserId: "u1",
  noReasignarAt: PRENDIDO,
  noReasignarPor: "u1",
};

const chatAbierto: SharedInboxSelectedConversation = {
  id: "c1",
  label: "Cliente",
  secondaryLabel: "573000000000",
  messages: [],
};

test("prender o apagar el candado cambia la fila (no es 'la misma fila')", () => {
  assert.equal(areConversationListItemsEqual(fila, { ...fila }), true);
  assert.equal(areConversationListItemsEqual(fila, { ...fila, noReasignarAt: null, noReasignarPor: null }), false);
  assert.equal(areConversationListItemsEqual({ ...fila, noReasignarAt: null }, fila), false);
});

test("el chat abierto cambia al prender o apagar el candado", () => {
  assert.equal(
    areSelectedConversationsEqual(
      { ...chatAbierto, noReasignarAt: PRENDIDO, noReasignarPor: "u1" },
      { ...chatAbierto, noReasignarAt: null, noReasignarPor: null },
    ),
    false,
  );
});

test("el resumen en vivo sin el dato conserva el candado; con null lo apaga", () => {
  const sinDato: LiveConversationListSnapshot = {
    ...fila,
    noReasignarAt: undefined,
    noReasignarPor: undefined,
    lastMessageAt: null,
  };
  assert.equal(buildConversationItemFromListSnapshot(sinDato, fila).noReasignarAt, PRENDIDO);
  assert.equal(buildConversationItemFromListSnapshot(sinDato, fila).noReasignarPor, "u1");

  const apagado = buildConversationItemFromListSnapshot({ ...sinDato, noReasignarAt: null, noReasignarPor: null }, fila);
  assert.equal(apagado.noReasignarAt, null);
  assert.equal(apagado.noReasignarPor, null);
});

test("el chat abierto (/live) lleva el candado a la fila", () => {
  const snapshot: LiveConversationSnapshot = { ...chatAbierto, messages: [] };
  assert.equal(buildConversationItemFromSnapshot(snapshot, fila).noReasignarAt, PRENDIDO);

  const apagado = buildConversationItemFromSnapshot({ ...snapshot, noReasignarAt: null, noReasignarPor: null }, fila);
  assert.equal(apagado.noReasignarAt, null);

  const prendido = buildConversationItemFromSnapshot(
    { ...snapshot, noReasignarAt: PRENDIDO, noReasignarPor: "u1" },
    { ...fila, noReasignarAt: null, noReasignarPor: null },
  );
  assert.equal(prendido.noReasignarAt, PRENDIDO);
  assert.equal(prendido.noReasignarPor, "u1");
});

test("al mezclar filas, la que no trae el candado no lo borra", () => {
  const sinDato: SharedInboxConversationItem = { ...fila, noReasignarAt: undefined, noReasignarPor: undefined };
  assert.equal(mergeConversationListItem(sinDato, fila).noReasignarAt, PRENDIDO);
  assert.equal(mergeConversationListItem({ ...fila, noReasignarAt: null, noReasignarPor: null }, fila).noReasignarAt, null);
});
