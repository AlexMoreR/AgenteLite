// Pruebas del chat abierto que no cumple el filtro. Correr: npm run test:pastillas-coinciden
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  debeMarcarseFueraDeLaVista,
  dentroDeLaVista,
  filasVisibles,
} from "./chat-abierto-fuera-de-la-vista";
import type { SharedInboxConversationItem } from "@/components/chats/chat-inbox-types";
import {
  areConversationListItemsEqual,
  mergeConversationListItem,
  updateConversationItemInSortedList,
} from "@/components/chats/chat-inbox-conversation-utils";
import { filaParaGuardar } from "@/components/chats/guardado-local/reglas";

type Fila = { id: string; fueraDeLaVista?: boolean };

test("el chat abierto que no cumple el filtro queda marcado y no sale en filasVisibles", () => {
  const marcado = debeMarcarseFueraDeLaVista({ vinoEnLaTanda: false, cumpleElFiltro: false });
  assert.equal(marcado, true);

  const filas: Fila[] = [
    { id: "agent:573196892277", fueraDeLaVista: marcado },
    { id: "agent:a", fueraDeLaVista: false },
    { id: "agent:b" },
  ];
  assert.deepEqual(
    filasVisibles(filas).map((fila) => fila.id),
    ["agent:a", "agent:b"],
  );
});

test("si cumple el filtro sale, aunque no haya venido en la tanda (el chat viejo de Mi dia sigue primero)", () => {
  const marcado = debeMarcarseFueraDeLaVista({ vinoEnLaTanda: false, cumpleElFiltro: true });
  assert.equal(marcado, false);

  const filas: Fila[] = [
    { id: "agent:viejo", fueraDeLaVista: marcado },
    { id: "agent:a", fueraDeLaVista: false },
  ];
  assert.deepEqual(
    filasVisibles(filas).map((fila) => fila.id),
    ["agent:viejo", "agent:a"],
  );
});

test("si vino en la tanda nunca se marca", () => {
  assert.equal(debeMarcarseFueraDeLaVista({ vinoEnLaTanda: true, cumpleElFiltro: false }), false);
  assert.equal(debeMarcarseFueraDeLaVista({ vinoEnLaTanda: true, cumpleElFiltro: true }), false);
});

test("una fila que llega de /list borra la marca", () => {
  const antes: Fila = { id: "agent:x", fueraDeLaVista: true };
  assert.deepEqual(filasVisibles([antes]), []);

  const deList = dentroDeLaVista<Fila>({ id: "agent:x" });
  assert.equal(deList.fueraDeLaVista, false);
  // Al pisar la fila vieja con la de /list, la marca se va.
  const pisada = { ...antes, ...deList };
  assert.deepEqual(filasVisibles([pisada]).map((fila) => fila.id), ["agent:x"]);
});

/*
  Parte 3: la bandeja. Meter la fila faltante en tiempo real la deja marcada; una fila de /list la
  limpia; y un aviso en tiempo real de una fila que ya estaba no le quita ni le pone la marca.
*/

function filaDeLaBandeja(id: string, minuto: number, extra: Partial<SharedInboxConversationItem> = {}): SharedInboxConversationItem {
  return {
    id,
    source: "agent",
    label: id,
    secondaryLabel: "",
    lastMessage: "hola",
    lastMessageAt: new Date(Date.UTC(2026, 10, 13, 10, minuto)),
    href: `/cliente/chats?chatKey=${id}`,
    ...extra,
  } as SharedInboxConversationItem;
}

test("meter la fila faltante en tiempo real la deja marcada; una fila de /list la limpia", () => {
  const lista = [filaDeLaBandeja("agent:a", 5)];
  const abierto = filaDeLaBandeja("agent:abierto", 9);

  // Tiempo real del chat abierto: no estaba, entra escondido.
  const conAbierto = updateConversationItemInSortedList(lista, abierto.id, abierto, { fueraDeLaVistaSiFalta: true });
  assert.equal(conAbierto.length, 2);
  assert.equal(conAbierto.find((fila) => fila.id === abierto.id)?.fueraDeLaVista, true);
  assert.deepEqual(filasVisibles(conAbierto).map((fila) => fila.id), ["agent:a"]);

  // Otro mensaje en ese chat (sin marca explicita): sigue escondido.
  const otroMensaje = filaDeLaBandeja("agent:abierto", 12, { lastMessage: "otro" });
  const trasOtro = updateConversationItemInSortedList(conAbierto, abierto.id, otroMensaje, { fueraDeLaVistaSiFalta: true });
  assert.equal(trasOtro.find((fila) => fila.id === abierto.id)?.fueraDeLaVista, true);
  assert.deepEqual(filasVisibles(trasOtro).map((fila) => fila.id), ["agent:a"]);

  // Mezcla del aviso de la lista con la fila que ya estaba: conserva la marca.
  const mezclada = mergeConversationListItem(otroMensaje, trasOtro.find((fila) => fila.id === abierto.id));
  assert.equal(mezclada.fueraDeLaVista, true);

  // /list la trae (ahora si cumple el filtro): llega con false explicito y aparece.
  const deList = dentroDeLaVista(filaDeLaBandeja("agent:abierto", 12, { lastMessage: "otro" }));
  const trasList = updateConversationItemInSortedList(trasOtro, abierto.id, deList);
  assert.deepEqual(filasVisibles(trasList).map((fila) => fila.id), ["agent:abierto", "agent:a"]);
});

test("sin la opcion, la fila faltante entra normal (como antes)", () => {
  const lista = [filaDeLaBandeja("agent:a", 5)];
  const nueva = filaDeLaBandeja("agent:b", 9);
  const tras = updateConversationItemInSortedList(lista, nueva.id, nueva);
  assert.deepEqual(filasVisibles(tras).map((fila) => fila.id), ["agent:b", "agent:a"]);
});

test("quitar la marca cambia la fila (no se considera la misma)", () => {
  const marcada = filaDeLaBandeja("agent:x", 1, { fueraDeLaVista: true });
  assert.equal(areConversationListItemsEqual(marcada, dentroDeLaVista(marcada)), false);
  assert.equal(areConversationListItemsEqual(dentroDeLaVista(marcada), filaDeLaBandeja("agent:x", 1)), true);
});

test("la lista guardada en el celular guarda la marca solo si es true", () => {
  assert.equal(filaParaGuardar(filaDeLaBandeja("agent:x", 1, { fueraDeLaVista: true }))?.fueraDeLaVista, true);
  assert.equal("fueraDeLaVista" in (filaParaGuardar(filaDeLaBandeja("agent:x", 1, { fueraDeLaVista: false })) ?? {}), false);
});
