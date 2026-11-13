import assert from "node:assert/strict";
import test from "node:test";

import {
  areConversationListItemsEqual,
  areSelectedConversationsEqual,
  buildConversationItemFromListSnapshot,
  buildConversationItemFromSnapshot,
} from "./chat-inbox-conversation-utils";
import type {
  LiveConversationListSnapshot,
  LiveConversationSnapshot,
  SharedInboxConversationItem,
  SharedInboxSelectedConversation,
} from "./chat-inbox-types";

// Parte 3 del candado "No reasignar": el dato viaja con la fila y con el chat abierto, y al
// prenderlo o apagarlo la fila cambia sin recargar. Un aviso en vivo que no lo trae no lo borra.

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

test("la fila conserva el candado si el resumen en vivo no lo trae", () => {
  const snapshot: LiveConversationListSnapshot = {
    ...fila,
    noReasignarAt: undefined,
    noReasignarPor: undefined,
    lastMessageAt: null,
  };
  const resultado = buildConversationItemFromListSnapshot(snapshot, fila);
  assert.equal(resultado.noReasignarAt, PRENDIDO);
  assert.equal(resultado.noReasignarPor, "u1");
});

test("apagar el candado (null) llega a la fila por la lista y por el chat abierto", () => {
  const porLista = buildConversationItemFromListSnapshot(
    { ...fila, noReasignarAt: null, noReasignarPor: null, lastMessageAt: null },
    fila,
  );
  assert.equal(porLista.noReasignarAt, null);
  assert.equal(porLista.noReasignarPor, null);

  const sinDato: LiveConversationSnapshot = { ...chatAbierto, messages: [] };
  const conservado = buildConversationItemFromSnapshot(sinDato, fila);
  assert.equal(conservado.noReasignarAt, PRENDIDO);

  const apagado = buildConversationItemFromSnapshot({ ...sinDato, noReasignarAt: null, noReasignarPor: null }, fila);
  assert.equal(apagado.noReasignarAt, null);
  assert.equal(apagado.noReasignarPor, null);
});

test("prender el candado llega a una fila que no lo tenia", () => {
  const sinCandado: SharedInboxConversationItem = { ...fila, noReasignarAt: null, noReasignarPor: null };
  const resultado = buildConversationItemFromSnapshot(
    { ...chatAbierto, noReasignarAt: PRENDIDO, noReasignarPor: "u1" },
    sinCandado,
  );
  assert.equal(resultado.noReasignarAt, PRENDIDO);
  assert.equal(resultado.noReasignarPor, "u1");
});

test("prender o apagar el candado cuenta como cambio de la fila y del chat abierto", () => {
  assert.equal(areConversationListItemsEqual(fila, { ...fila, noReasignarAt: null, noReasignarPor: null }), false);
  assert.equal(areConversationListItemsEqual(fila, { ...fila }), true);
  assert.equal(
    areSelectedConversationsEqual(
      { ...chatAbierto, noReasignarAt: PRENDIDO, noReasignarPor: "u1" },
      { ...chatAbierto, noReasignarAt: null, noReasignarPor: null },
    ),
    false,
  );
  assert.equal(areSelectedConversationsEqual({ ...chatAbierto }, { ...chatAbierto }), true);
});
