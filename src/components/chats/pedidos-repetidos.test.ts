// Correr: npm run test:pedidos-repetidos
import { test } from "node:test";
import assert from "node:assert/strict";

import { VENTANA_MS, fetchCompartido, olvidarPedidosEnCamino } from "./pedido-compartido";
import { senalDeLaFranja } from "./senal-de-la-franja";

// ── La franja del flujo: un solo pedido por envío ───────────────────────────────────────────────

test("la franja no cambia con la burbuja provisional; cambia una vez cuando llega el mensaje real", () => {
  const antes = [{ id: "m1" }, { id: "m2" }];
  const conProvisional = [...antes, { id: "optimistic:agent:x:1732000000000" }];
  const conReal = [...antes, { id: "m3" }];
  assert.equal(senalDeLaFranja(antes), "m2");
  assert.equal(senalDeLaFranja(conProvisional), "m2");
  assert.equal(senalDeLaFranja(conReal), "m3");
});

test("la franja ignora tambien las fotos en camino, y sin mensajes del servidor da 0", () => {
  assert.equal(senalDeLaFranja([]), 0);
  assert.equal(senalDeLaFranja([{ id: "optimistic:1" }]), 0);
  assert.equal(senalDeLaFranja([{ id: "m1" }, { id: "optimistic:2" }, { id: "optimistic:3" }]), "m1");
});

// ── La fila del chat: un mismo /summary no sale dos veces a la vez ─────────────────────────────

function servidorDePrueba() {
  const pedidos: string[] = [];
  const pendientes: Array<(r: Response) => void> = [];
  const pedir = ((url: string) => {
    pedidos.push(url);
    return new Promise<Response>((resolver) => pendientes.push(resolver));
  }) as unknown as typeof fetch;
  const responder = (cuerpo: unknown) => {
    for (const resolver of pendientes.splice(0)) resolver(new Response(JSON.stringify(cuerpo)));
  };
  return { pedidos, pedir, responder };
}

test("dos pedidos iguales casi juntos salen una sola vez y los dos leen la respuesta", async () => {
  olvidarPedidosEnCamino();
  const { pedidos, pedir, responder } = servidorDePrueba();
  let reloj = 1000;
  const ahora = () => reloj;
  const a = fetchCompartido("/api/cliente/chats/summary?chatKey=agent%3Ax", undefined, ahora, pedir);
  reloj += 40;
  const b = fetchCompartido("/api/cliente/chats/summary?chatKey=agent%3Ax", undefined, ahora, pedir);
  responder({ ok: true, fila: 1 });
  const [ra, rb] = await Promise.all([a, b]);
  assert.equal(pedidos.length, 1);
  assert.deepEqual(await ra.json(), { ok: true, fila: 1 });
  assert.deepEqual(await rb.json(), { ok: true, fila: 1 });
});

test("pasada la ventana sale un pedido nuevo, aunque el anterior siga en camino", async () => {
  olvidarPedidosEnCamino();
  const { pedidos, pedir, responder } = servidorDePrueba();
  let reloj = 1000;
  const ahora = () => reloj;
  const a = fetchCompartido("/api/cliente/chats/summary?chatKey=agent%3Ax", undefined, ahora, pedir);
  reloj += VENTANA_MS;
  const b = fetchCompartido("/api/cliente/chats/summary?chatKey=agent%3Ax", undefined, ahora, pedir);
  assert.equal(pedidos.length, 2);
  responder({ ok: true });
  await Promise.all([a, b]);
});

test("chats distintos no se juntan, y despues de responder el siguiente sale de nuevo", async () => {
  olvidarPedidosEnCamino();
  const { pedidos, pedir, responder } = servidorDePrueba();
  const reloj = 1000;
  const ahora = () => reloj;
  const a = fetchCompartido("/api/cliente/chats/summary?chatKey=agent%3Ax", undefined, ahora, pedir);
  const b = fetchCompartido("/api/cliente/chats/summary?chatKey=agent%3Ay", undefined, ahora, pedir);
  assert.equal(pedidos.length, 2);
  responder({ ok: true });
  await Promise.all([a, b]);
  const c = fetchCompartido("/api/cliente/chats/summary?chatKey=agent%3Ax", undefined, ahora, pedir);
  assert.equal(pedidos.length, 3);
  responder({ ok: true });
  await c;
});

test("si el pedido falla, los dos se enteran y el siguiente vuelve a intentar", async () => {
  olvidarPedidosEnCamino();
  let veces = 0;
  const pedir = (() => {
    veces += 1;
    return Promise.reject(new TypeError("sin red"));
  }) as unknown as typeof fetch;
  const ahora = () => 1000;
  const a = fetchCompartido("/x", undefined, ahora, pedir);
  const b = fetchCompartido("/x", undefined, ahora, pedir);
  await assert.rejects(a);
  await assert.rejects(b);
  assert.equal(veces, 1);
  await assert.rejects(fetchCompartido("/x", undefined, ahora, pedir));
  assert.equal(veces, 2);
});
