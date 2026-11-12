// Pruebas del chat abierto que no cumple el filtro. Correr: npm run test:pastillas-coinciden
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  debeMarcarseFueraDeLaVista,
  dentroDeLaVista,
  filasVisibles,
} from "./chat-abierto-fuera-de-la-vista";
import {
  mergeConversationListItem,
  updateConversationItemInSortedList,
} from "../../../components/chats/chat-inbox-conversation-utils";

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

// Parte 3: los caminos de la bandeja (tiempo real, /list, mezcla) con la marca.
test("meter la fila faltante en tiempo real la deja marcada; una fila de /list la limpia", () => {
  type Item = Parameters<typeof updateConversationItemInSortedList>[2];
  const fila = (id: string, at: number, extra: Partial<Item> = {}): Item =>
    ({
      id,
      source: "agent",
      label: id,
      secondaryLabel: "",
      lastMessage: "hola",
      lastMessageAt: new Date(at),
      href: "",
      ...extra,
    }) as Item;

  // La lista "Maria" vacia: el aviso del chat abierto (de otra asesora) lo mete escondido.
  const conAviso = updateConversationItemInSortedList([], "agent:abierto", fila("agent:abierto", 2), {
    fueraDeLaVistaSiFalta: true,
  });
  assert.equal(conAviso.length, 1, "la fila queda: el panel la necesita");
  assert.deepEqual(filasVisibles(conAviso), [], "pero la lista sale vacia");

  // Un mensaje nuevo en ese chat (sin marca en el aviso) no lo vuelve a sacar como fila.
  const otroAviso = updateConversationItemInSortedList(conAviso, "agent:abierto", fila("agent:abierto", 3), {
    fueraDeLaVistaSiFalta: true,
  });
  assert.equal(otroAviso[0]?.fueraDeLaVista, true);
  assert.deepEqual(filasVisibles(otroAviso), []);

  // Mezclar con un aviso sin marca la conserva.
  assert.equal(mergeConversationListItem(fila("agent:abierto", 4), otroAviso[0]).fueraDeLaVista, true);

  // Una fila que ya estaba visible no se esconde por el aviso.
  const visible = updateConversationItemInSortedList(
    [fila("agent:a", 1, { fueraDeLaVista: false })],
    "agent:a",
    fila("agent:a", 5),
    { fueraDeLaVistaSiFalta: true },
  );
  assert.deepEqual(filasVisibles(visible).map((item) => item.id), ["agent:a"]);

  // Si el chat entra al filtro, /list lo trae con false explicito y aparece normal.
  const deList = updateConversationItemInSortedList(otroAviso, "agent:abierto", dentroDeLaVista(fila("agent:abierto", 3)));
  assert.deepEqual(filasVisibles(deList).map((item) => item.id), ["agent:abierto"]);
  assert.equal(mergeConversationListItem(dentroDeLaVista(fila("agent:abierto", 3)), otroAviso[0]).fueraDeLaVista, false);

  // Sin la opcion (los caminos de /list) la fila faltante entra visible, como siempre.
  const sinOpcion = updateConversationItemInSortedList([], "agent:b", fila("agent:b", 1));
  assert.deepEqual(filasVisibles(sinOpcion).map((item) => item.id), ["agent:b"]);
});
