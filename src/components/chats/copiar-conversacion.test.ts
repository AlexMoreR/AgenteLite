import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  juntarConversacionParaCopiar,
  PAGINA_PARA_COPIAR,
  TOPE_PARA_COPIAR,
  urlDePaginaParaCopiar,
  type MensajeParaCopiar,
} from "./copiar-conversacion";

// Un chat falso de `total` mensajes, del más viejo (m0) al más nuevo. Responde como /live: la página
// más nueva antes del cursor, en orden cronológico.
function chatFalso(total: number) {
  const todos: MensajeParaCopiar[] = Array.from({ length: total }, (_, i) => ({
    id: `m${String(i).padStart(4, "0")}`,
    direction: i % 2 ? "INBOUND" : "OUTBOUND",
    content: `mensaje ${i}`,
    createdAt: new Date(Date.UTC(2026, 10, 1, 0, i)).toISOString(),
  }));
  const pedidos: Array<string | null> = [];
  const pedir = async (antesDe: string | null) => {
    pedidos.push(antesDe);
    const fin = antesDe ? todos.findIndex((m) => m.id === antesDe) : todos.length;
    return { mensajes: todos.slice(Math.max(0, fin - PAGINA_PARA_COPIAR), fin) };
  };
  return { todos, pedidos, pedir };
}

test("un chat de más de 100 mensajes copia los 100 más recientes, en orden y sin repetidos", async () => {
  const { todos, pedidos, pedir } = chatFalso(250);
  const mensajes = await juntarConversacionParaCopiar(pedir);
  assert.ok(mensajes);
  assert.equal(mensajes.length, TOPE_PARA_COPIAR);
  assert.deepEqual(mensajes.map((m) => m.id), todos.slice(-TOPE_PARA_COPIAR).map((m) => m.id));
  // 4 páginas de 30; cada una antes del más viejo de la anterior.
  assert.deepEqual(pedidos, [null, "m0220", "m0190", "m0160"]);
});

test("para cuando una página trae menos de 30", async () => {
  const { todos, pedidos, pedir } = chatFalso(45);
  const mensajes = await juntarConversacionParaCopiar(pedir);
  assert.deepEqual(mensajes?.map((m) => m.id), todos.map((m) => m.id));
  assert.equal(pedidos.length, 2);
});

test("para cuando una página llega vacía (el chat tiene justo 30)", async () => {
  const { pedidos, pedir } = chatFalso(30);
  const mensajes = await juntarConversacionParaCopiar(pedir);
  assert.equal(mensajes?.length, 30);
  assert.equal(pedidos.length, 2);
});

test("repetidos entre páginas se cuentan una vez", async () => {
  const { todos } = chatFalso(60);
  let vuelta = 0;
  const mensajes = await juntarConversacionParaCopiar(async () => {
    vuelta += 1;
    // La segunda página repite 5 de la primera (llegó un mensaje en medio).
    if (vuelta === 1) return { mensajes: todos.slice(30, 60) };
    if (vuelta === 2) return { mensajes: todos.slice(5, 35) };
    return { mensajes: [] };
  });
  assert.deepEqual(mensajes?.map((m) => m.id), todos.slice(5).map((m) => m.id));
});

test("si la primera página falla devuelve null; si falla otra, se queda con lo que tenía", async () => {
  assert.equal(await juntarConversacionParaCopiar(async () => null), null);
  const { todos } = chatFalso(90);
  let vuelta = 0;
  const mensajes = await juntarConversacionParaCopiar(async () => {
    vuelta += 1;
    return vuelta === 1 ? { mensajes: todos.slice(60) } : null;
  });
  assert.equal(mensajes?.length, 30);
});

test("la URL va de a 30, con precarga=1 y el cursor", () => {
  const primera = new URL(urlDePaginaParaCopiar("agent:abc", null), "http://x");
  assert.equal(primera.pathname, "/api/cliente/chats/live");
  assert.equal(primera.searchParams.get("chatKey"), "agent:abc");
  assert.equal(primera.searchParams.get("batchSize"), "30");
  assert.equal(primera.searchParams.get("precarga"), "1");
  assert.equal(primera.searchParams.has("beforeMessageId"), false);
  const otra = new URL(urlDePaginaParaCopiar("agent:abc", "m1"), "http://x");
  assert.equal(otra.searchParams.get("beforeMessageId"), "m1");
});

test("el menú usa las páginas y ya no pide batchSize=200", () => {
  const menu = fs.readFileSync(path.join(__dirname, "menu-del-contacto.tsx"), "utf8");
  assert.ok(!menu.includes("batchSize=200"));
  assert.match(menu, /juntarConversacionParaCopiar\(/);
  assert.match(menu, /urlDePaginaParaCopiar\(chatKey, antesDe\)/);
});

test("bandeja: /counts compartido entre pestañas y precarga de Mías con reloj que se pausa", () => {
  const bandeja = fs.readFileSync(path.join(__dirname, "shared-inbox.tsx"), "utf8");
  // /counts: la URL completa es la clave y el fresco es el intervalo (0 si lo pidió una acción).
  assert.match(bandeja, /const frescoMs = forzarRed \? 0 : CADA_MS;/);
  assert.match(bandeja, /pedirCompartido\(urlDeConteos, frescoMs, \(\) =>\s*leerRespuestaJson\(urlDeConteos\),?\s*\)/);
  assert.match(bandeja, /contarPedidoAutomatico\("conteos", origen\);/);
  assert.match(bandeja, /timeoutId = setTimeout\(fetchCounts, CADA_MS\);/);
  // Mías: el reloj es useCadaTantoVisible y cada pedido se cuenta.
  assert.match(bandeja, /useCadaTantoVisible\(precargarMiasAlTiempo, 4 \* 60_000, \{ activo: precargaDeMiasActiva \}\);/);
  assert.match(bandeja, /contarPedidoAutomatico\("mias", "red"\);/);
  assert.ok(!/setInterval\(\(\) => void precargar\(\)/.test(bandeja), "ya no hay setInterval para Mías");
});
