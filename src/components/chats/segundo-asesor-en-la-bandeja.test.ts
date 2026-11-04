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

// El segundo asesor viaja con el chat y una actualizacion en vivo que no lo trae no lo borra.

const fila: SharedInboxConversationItem = {
  id: "agent:c1",
  source: "agent",
  label: "Cliente",
  secondaryLabel: "573000000000",
  lastMessage: "hola",
  href: "/cliente/chats?chatKey=agent:c1",
  assignedToUserId: "u1",
  segundoAsesorId: "u2",
  segundoAsesorNombre: "Maria",
};

const chatAbierto: SharedInboxSelectedConversation = {
  id: "c1",
  label: "Cliente",
  secondaryLabel: "573000000000",
  messages: [],
};

test("la fila conserva el segundo asesor si el resumen en vivo no lo trae", () => {
  const snapshot: LiveConversationListSnapshot = { ...fila, segundoAsesorId: undefined, segundoAsesorNombre: undefined, lastMessageAt: null };
  const resultado = buildConversationItemFromListSnapshot(snapshot, fila);
  assert.equal(resultado.segundoAsesorId, "u2");
  assert.equal(resultado.segundoAsesorNombre, "Maria");
});

test("la fila toma el segundo asesor nuevo, o lo quita, cuando el resumen si lo trae", () => {
  const cambiado = buildConversationItemFromListSnapshot(
    { ...fila, segundoAsesorId: "u3", segundoAsesorNombre: "Ana", lastMessageAt: null },
    fila,
  );
  assert.equal(cambiado.segundoAsesorId, "u3");
  assert.equal(cambiado.segundoAsesorNombre, "Ana");

  const quitado = buildConversationItemFromListSnapshot(
    { ...fila, segundoAsesorId: null, segundoAsesorNombre: null, lastMessageAt: null },
    fila,
  );
  assert.equal(quitado.segundoAsesorId, null);
  assert.equal(quitado.segundoAsesorNombre, null);
});

test("el chat abierto actualiza la fila con su segundo asesor, o conserva el de antes", () => {
  const sinDato: LiveConversationSnapshot = { ...chatAbierto, messages: [] };
  const conservado = buildConversationItemFromSnapshot(sinDato, fila);
  assert.equal(conservado.segundoAsesorId, "u2");
  assert.equal(conservado.segundoAsesorNombre, "Maria");

  const quitado = buildConversationItemFromSnapshot({ ...sinDato, segundoAsesorId: null, segundoAsesorNombre: null }, fila);
  assert.equal(quitado.segundoAsesorId, null);
  assert.equal(quitado.segundoAsesorNombre, null);
});

test("un cambio de segundo asesor cuenta como cambio de la fila y del chat abierto", () => {
  assert.equal(areConversationListItemsEqual(fila, { ...fila, segundoAsesorId: null, segundoAsesorNombre: null }), false);
  assert.equal(areConversationListItemsEqual(fila, { ...fila }), true);
  assert.equal(
    areSelectedConversationsEqual(
      { ...chatAbierto, segundoAsesorId: "u2", segundoAsesorNombre: "Maria" },
      { ...chatAbierto, segundoAsesorId: null, segundoAsesorNombre: null },
    ),
    false,
  );
});
