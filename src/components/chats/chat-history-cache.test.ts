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

function chatGuardado(id: string) {
  const guardado = [...almacen.entries()].find(([clave]) => clave.startsWith("aglite:chat-history-cache"));
  if (!guardado) {
    return null;
  }
  const store = JSON.parse(guardado[1]) as { conversations: Record<string, unknown> };
  return store.conversations[id] ?? null;
}

test("e) un chat guardado se lee enseguida, antes del guardado diferido, sin escribir antes de tiempo", async () => {
  saveConversationToCache(copia(1, 20, { id: "chat-2" }));
  // Todavia no se escribio en el navegador...
  assert.equal(chatGuardado("chat-2"), null, "no se escribe antes de tiempo");
  // ...pero ya se puede leer (antes salia vacio al tocarlo).
  const leida = readConversationFromCache("chat-2");
  assert.ok(leida, "el chat recien guardado se lee");
  assert.equal(leida.messages.length, 20);
  assert.equal(leida.messages.at(-1)?.id, mensaje(20).id);
  assert.ok(leida.messages[0]?.createdAt instanceof Date);
  // Tambien con el prefijo de la clave del chat.
  assert.ok(readConversationFromCache("agent:chat-2"));
  // Leer no escribe nada.
  assert.equal(chatGuardado("chat-2"), null);

  await new Promise((listo) => setTimeout(listo, 900));
  assert.ok(chatGuardado("chat-2"), "despues de la espera, si se guarda");
});

test("f) leer lo que espera guardarse no pierde mensajes frente a la copia ya guardada", async () => {
  saveConversationToCache(copia(1, 40, { id: "chat-3" }));
  await new Promise((listo) => setTimeout(listo, 900));
  assert.ok(chatGuardado("chat-3"));

  // Llega una copia nueva con solo los ultimos (como la trae /live): se lee junto con la guardada.
  saveConversationToCache(copia(36, 45, { id: "chat-3" }));
  const leida = readConversationFromCache("chat-3")!;
  assert.equal(leida.messages.length, 45, "del 1 al 45, sin perder los viejos");
  assert.equal(leida.messages[0]?.id, mensaje(1).id);
  assert.equal(leida.messages.at(-1)?.id, mensaje(45).id);
  assert.equal(leida.loadMoreCursor, mensaje(1).id, "el cursor sigue en el mas viejo");

  // Y es lo mismo que queda guardado despues.
  await new Promise((listo) => setTimeout(listo, 900));
  const guardada = readConversationFromCache("chat-3")!;
  assert.deepEqual(
    guardada.messages.map((item) => item.id),
    leida.messages.map((item) => item.id),
  );
});

/*
  La precarga (chat-conversation-warmup) con un pedido falso: cuenta cuantas veces se llama a fetch.
*/
// eslint-disable-next-line @typescript-eslint/no-require-imports
const precarga = require("./chat-conversation-warmup") as typeof import("./chat-conversation-warmup");
const pedidos: string[] = [];
let respuestaFalsa: () => Response = () => new Response("{}", { status: 500 });
(globalThis as unknown as { fetch: typeof fetch }).fetch = (async (url: string | URL) => {
  pedidos.push(String(url));
  return respuestaFalsa();
}) as typeof fetch;

function pedidosDe(chatKey: string) {
  return pedidos.filter((url) => url.includes(`chatKey=${encodeURIComponent(chatKey)}&`)).length;
}

test("g) precarga: dos intentos seguidos hacen un solo pedido y el chat queda listo para leer", async () => {
  respuestaFalsa = () =>
    new Response(JSON.stringify({ ok: true, conversation: { ...copia(1, 10, { id: "agent:chat-4" }) } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  await Promise.all([precarga.warmConversationCache("agent:chat-4"), precarga.warmConversationCache("agent:chat-4")]);
  assert.equal(pedidosDe("agent:chat-4"), 1);
  assert.ok(pedidos[0]?.includes("precarga=1"), "es la precarga, que no marca leidos");
  // Recien precargado (todavia sin escribir en el navegador) ya se lee: al tocarlo no sale vacio.
  assert.equal(readConversationFromCache("agent:chat-4")?.messages.length, 10);
  await precarga.warmConversationCache("agent:chat-4");
  assert.equal(pedidosDe("agent:chat-4"), 1);
});

test("h) precarga: un pedido fallido no se repite en 30 minutos; pasados, si", async () => {
  respuestaFalsa = () => new Response("{}", { status: 500 });
  await precarga.warmConversationCache("agent:chat-5");
  await precarga.warmConversationCache("agent:chat-5");
  assert.equal(pedidosDe("agent:chat-5"), 1, "el mismo chat no se pide dos veces");

  const ahora = Date.now;
  try {
    Date.now = () => ahora() + precarga.ESPERA_PARA_VOLVER_A_PEDIR_MS - 60_000;
    await precarga.warmConversationCache("agent:chat-5");
    assert.equal(pedidosDe("agent:chat-5"), 1, "a los 29 minutos todavia no");
    Date.now = () => ahora() + precarga.ESPERA_PARA_VOLVER_A_PEDIR_MS + 1000;
    await precarga.warmConversationCache("agent:chat-5");
    assert.equal(pedidosDe("agent:chat-5"), 2, "pasados 30 minutos se puede volver a pedir");
  } finally {
    Date.now = ahora;
  }
});

test("i) precarga: un chat oficial no hace ningun pedido", async () => {
  respuestaFalsa = () => new Response("{}", { status: 200 });
  await precarga.warmConversationCache("official:chat-6");
  await precarga.warmConversationCache("official:chat-6");
  assert.equal(pedidosDe("official:chat-6"), 0);
});

test("j) precarga en camino: se ve mientras viene y deja de verse al terminar, sin pedir nada extra", async () => {
  let soltar: (() => void) | null = null;
  respuestaFalsa = () =>
    new Response(JSON.stringify({ ok: true, conversation: { ...copia(1, 10, { id: "agent:chat-7" }) } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  // El pedido queda colgado hasta soltarlo, como una precarga que todavia viene en camino.
  const fetchDeVerdad = globalThis.fetch;
  (globalThis as unknown as { fetch: typeof fetch }).fetch = (async (url: string | URL) => {
    pedidos.push(String(url));
    await new Promise<void>((listo) => {
      soltar = listo;
    });
    return respuestaFalsa();
  }) as typeof fetch;
  try {
    assert.equal(precarga.precargaEnCamino("agent:chat-7"), null, "antes de pedirla no hay nada en camino");
    const pedida = precarga.warmConversationCache("agent:chat-7");
    const enCamino = precarga.precargaEnCamino("agent:chat-7");
    assert.ok(enCamino, "mientras viene, se ve");
    assert.equal(enCamino, pedida, "es la misma promesa de la precarga");
    assert.equal(precarga.precargaEnCamino(" agent:chat-7 "), enCamino, "tambien con espacios en la clave");
    assert.equal(readConversationFromCache("agent:chat-7"), null, "todavia no hay copia");

    await new Promise((listo) => setTimeout(listo, 0));
    soltar!();
    await enCamino;
    assert.equal(precarga.precargaEnCamino("agent:chat-7"), null, "al terminar ya no esta en camino");
    assert.equal(readConversationFromCache("agent:chat-7")?.messages.length, 10, "y la copia ya se lee");
    assert.equal(pedidosDe("agent:chat-7"), 1, "mirar no hace ningun pedido");
  } finally {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchDeVerdad;
  }
});

/*
  La copia guardada (hasta 50) con el /live de apertura (los ultimos 10), por el mismo camino que la
  bandeja: copiaComoBase decide la base y mergeConversationSnapshotIfChanged (que usa
  mergeConversationSnapshots) junta.
*/
function abrirConLive(guardada: SharedInboxSelectedConversation, live: SharedInboxSelectedConversation, paginaAnterior = false) {
  return cache.mergeConversationSnapshots(cache.copiaComoBase(guardada, live, { paginaAnterior }), live)!;
}

test("k) copia de 50 + /live de 10 que se tocan: quedan todos los mensajes y el cursor en el mas viejo de la copia", () => {
  const guardada = cache.recortarParaGuardar(copia(1, 300)); // 251..300, cursor en el 251
  assert.equal(guardada.messages.length, MAX_MENSAJES_POR_CHAT);
  // /live: los ultimos 10, con dos nuevos que la copia no tenia (293..302).
  const live = copia(293, 302);
  assert.equal(cache.copiasSeTocan(guardada, live), true);

  const junta = abrirConLive(guardada, live);
  assert.equal(junta.messages.length, 52, "del 251 al 302: no se pierde ninguno de la copia");
  assert.equal(junta.messages[0]?.id, mensaje(251).id);
  assert.equal(junta.messages.at(-1)?.id, mensaje(302).id);
  assert.equal(new Set(junta.messages.map((item) => item.id)).size, junta.messages.length, "sin repetidos");
  assert.equal(junta.loadMoreCursor, mensaje(251).id, "el cursor sigue en el mas viejo de la copia");
  assert.equal(junta.hasMoreMessages, true);
});

test("l) copia y /live con hueco entre las dos: se usa solo el /live y su cursor", () => {
  const guardada = cache.recortarParaGuardar(copia(1, 100)); // 51..100
  const live = copia(291, 300); // faltan del 101 al 290
  assert.equal(cache.copiasSeTocan(guardada, live), false);
  assert.equal(cache.copiaComoBase(guardada, live), null);

  const junta = abrirConLive(guardada, live);
  assert.deepEqual(
    junta.messages.map((item) => item.id),
    live.messages.map((item) => item.id),
    "nada de la copia: tendria mensajes faltantes en el medio",
  );
  assert.equal(junta.loadMoreCursor, mensaje(291).id, "cursor del /live, para traer los del medio");
  assert.equal(junta.hasMoreMessages, true);
});

test("m) pedir mensajes anteriores antes del /live: la pagina se pone debajo de la copia, sin borrarla", () => {
  const guardada = cache.recortarParaGuardar(copia(1, 300)); // 251..300
  // La pagina de antes del cursor (221..250) no comparte mensajes con la copia, pero empalma.
  const pagina = copia(221, 250);
  assert.equal(cache.copiasSeTocan(guardada, pagina), false);
  const junta = abrirConLive(guardada, pagina, true);
  assert.equal(junta.messages.length, 80, "del 221 al 300");
  assert.equal(junta.loadMoreCursor, mensaje(221).id, "el cursor baja a la pagina nueva");
});

test("n) una copia sin mensajes del servidor no sirve de base", () => {
  const live = copia(1, 10);
  assert.equal(cache.copiaComoBase(null, live), null);
  const soloOptimista = copia(1, 0, {
    messages: [{ ...mensaje(11), id: "optimistic:1" }],
  } as Partial<SharedInboxSelectedConversation>);
  assert.equal(cache.copiasSeTocan(soloOptimista, live), false);
});
