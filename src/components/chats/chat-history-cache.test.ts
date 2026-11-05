import { test } from "node:test";
import assert from "node:assert/strict";

import type { SharedInboxMessageItem, SharedInboxSelectedConversation } from "./chat-inbox-types";

/*
  Un navegador de mentira: localStorage en memoria. Va ANTES de importar el modulo, que mira
  `window` para saber si puede guardar.
*/
const almacen = new Map<string, string>();
const ventanaFalsa = {
  localStorage: {
    getItem: (clave: string) => almacen.get(clave) ?? null,
    setItem: (clave: string, valor: string) => void almacen.set(clave, valor),
    removeItem: (clave: string) => void almacen.delete(clave),
  },
  addEventListener: () => {},
  setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms) as unknown as number,
  clearTimeout: (id: number) => clearTimeout(id),
};
(globalThis as unknown as { window: typeof ventanaFalsa }).window = ventanaFalsa;

// eslint-disable-next-line @typescript-eslint/no-require-imports
const cache = require("./chat-history-cache") as typeof import("./chat-history-cache");
const { MAX_MENSAJES_POR_CHAT, mergeConversationSnapshots, readConversationFromCache, saveConversationToCache } = cache;

const INICIO = Date.UTC(2026, 10, 5, 9, 0, 0);

function mensaje(numero: number): SharedInboxMessageItem {
  return {
    id: `m${String(numero).padStart(4, "0")}`,
    content: `mensaje ${numero}`,
    direction: numero % 2 ? "INBOUND" : "OUTBOUND",
    createdAt: new Date(INICIO + numero * 60_000),
    authorType: numero % 2 ? "contact" : "user",
    outboundStatusLabel: null,
    type: "TEXT",
    mediaUrl: null,
    rawPayload: null,
  } as SharedInboxMessageItem;
}

/** Los mensajes `desde`..`hasta` (incluidos), con el cursor en el mas viejo, como los arma el servidor. */
function copia(desde: number, hasta: number, extra: Partial<SharedInboxSelectedConversation> = {}) {
  const messages = [];
  for (let numero = desde; numero <= hasta; numero += 1) {
    messages.push(mensaje(numero));
  }
  return {
    id: "chat-1",
    label: "Cliente",
    secondaryLabel: "573000000000",
    automationPaused: false,
    loadMoreHref: null,
    loadMoreCursor: messages[0]?.id ?? null,
    hasMoreMessages: desde > 1,
    messages,
    ...extra,
  } as SharedInboxSelectedConversation;
}

test("a) llega un mensaje nuevo: el cursor sigue en el mensaje mas viejo ya cargado", () => {
  // La asesora subio y ya tiene cargados del 101 al 300 (el cursor apunta al 101).
  const cargada = copia(101, 300);
  // Llega un mensaje: /live trae los 10 mas nuevos (291..301) con su propio cursor (el 291).
  const nueva = copia(292, 301);
  assert.equal(nueva.loadMoreCursor, mensaje(292).id);

  const junta = mergeConversationSnapshots(cargada, nueva)!;
  assert.equal(junta.loadMoreCursor, mensaje(101).id, "el cursor no puede volver al 292");
  assert.equal(junta.hasMoreMessages, true);
  assert.equal(junta.messages.length, 201, "del 101 al 301, sin repetir");
  assert.equal(new Set(junta.messages.map((item) => item.id)).size, junta.messages.length);
  assert.equal(junta.messages.at(-1)?.id, mensaje(301).id);
});

test("b) al cargar la pagina de mas viejos, el cursor baja a esa pagina", () => {
  const cargada = copia(101, 300);
  const masViejos = copia(71, 100);
  const junta = mergeConversationSnapshots(cargada, masViejos)!;
  assert.equal(junta.loadMoreCursor, mensaje(71).id);
  assert.equal(junta.messages.length, 230);
});

test("c) si entre las dos copias hay un hueco, manda el cursor de la nueva (para traer los del medio)", () => {
  // Una copia de hace dias (1..50) y los ultimos de hoy (200..230): faltan del 51 al 199.
  const vieja = copia(1, 50);
  const deHoy = copia(200, 230);
  const junta = mergeConversationSnapshots(vieja, deHoy)!;
  assert.equal(junta.loadMoreCursor, mensaje(200).id);
  assert.equal(junta.hasMoreMessages, true);
});

test("d) la copia guardada en el navegador tiene como mucho 50 mensajes por chat", async () => {
  assert.equal(MAX_MENSAJES_POR_CHAT, 50);
  saveConversationToCache(copia(1, 300));
  // El guardado espera un rato (y en el navegador, a que este desocupado).
  await new Promise((listo) => setTimeout(listo, 900));

  const guardado = [...almacen.entries()].find(([clave]) => clave.startsWith("aglite:chat-history-cache"));
  assert.ok(guardado, "se guardo la copia");
  const store = JSON.parse(guardado[1]) as { conversations: Record<string, { messages: { id: string }[] }> };
  for (const chat of Object.values(store.conversations)) {
    assert.ok(chat.messages.length <= MAX_MENSAJES_POR_CHAT, `guardo ${chat.messages.length}`);
  }

  // Al leerla, son los 50 mas nuevos y el cursor apunta al mas viejo que quedo (el 251).
  const leida = readConversationFromCache("chat-1", { ignoreFreshness: true })!;
  assert.equal(leida.messages.length, MAX_MENSAJES_POR_CHAT);
  assert.equal(leida.messages[0]?.id, mensaje(251).id);
  assert.equal(leida.messages.at(-1)?.id, mensaje(300).id);
  assert.equal(leida.loadMoreCursor, mensaje(251).id);
  assert.equal(leida.hasMoreMessages, true);

  // Guardar otra vez con mas mensajes no la hace crecer.
  saveConversationToCache(copia(1, 320));
  await new Promise((listo) => setTimeout(listo, 900));
  const otraVez = readConversationFromCache("chat-1", { ignoreFreshness: true })!;
  assert.equal(otraVez.messages.length, MAX_MENSAJES_POR_CHAT);
  assert.equal(otraVez.messages.at(-1)?.id, mensaje(320).id);
  assert.equal(otraVez.loadMoreCursor, mensaje(271).id);
});
