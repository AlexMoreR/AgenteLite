import { test } from "node:test";
import assert from "node:assert/strict";

import { aplicarEstados } from "./aplicar-estados";

const saliente = (id: string, estado: string | null, rawPayload: unknown = null) => ({
  id,
  direction: "OUTBOUND",
  outboundStatusLabel: estado,
  rawPayload,
  content: `texto ${id}`,
});

test("a) cambia el chulo del mensaje que avanzo y deja los demas iguales", () => {
  const mensajes = [saliente("m1", "READ"), saliente("m2", "SENT")];
  const resultado = aplicarEstados(mensajes, [
    { id: "m1", estado: "READ", reproducidoAt: null },
    { id: "m2", estado: "DELIVERED", reproducidoAt: null },
  ]);
  assert.notEqual(resultado, mensajes);
  assert.equal(resultado[0], mensajes[0]);
  assert.equal(resultado[1].outboundStatusLabel, "DELIVERED");
  assert.equal(resultado[1].content, "texto m2");
});

test("b) sin cambios devuelve la misma lista (no se vuelve a dibujar)", () => {
  const mensajes = [saliente("m1", "READ")];
  assert.equal(aplicarEstados(mensajes, [{ id: "m1", estado: "READ", reproducidoAt: null }]), mensajes);
  assert.equal(aplicarEstados(mensajes, []), mensajes);
  assert.equal(aplicarEstados(mensajes, [{ id: "otro", estado: "READ", reproducidoAt: null }]), mensajes);
});

test("c) los entrantes no se tocan aunque el id coincida", () => {
  const mensajes = [{ id: "m1", direction: "INBOUND", outboundStatusLabel: null, rawPayload: null }];
  assert.equal(aplicarEstados(mensajes, [{ id: "m1", estado: "READ", reproducidoAt: null }]), mensajes);
});

test("d) el audio escuchado se marca en el rawPayload sin perder lo que tenia", () => {
  const mensajes = [saliente("a1", "READ", { duracion: 7 })];
  const resultado = aplicarEstados(mensajes, [{ id: "a1", estado: "READ", reproducidoAt: "2026-11-19T20:00:00Z" }]);
  assert.deepEqual(resultado[0].rawPayload, { duracion: 7, reproducidoAt: "2026-11-19T20:00:00Z" });
  // Ya marcado: no cambia otra vez.
  assert.equal(aplicarEstados(resultado, [{ id: "a1", estado: "READ", reproducidoAt: "2026-11-19T20:00:00Z" }]), resultado);
});

test("e) un rawPayload que no es objeto se reemplaza por uno con la marca", () => {
  const mensajes = [saliente("a1", "READ", "texto crudo")];
  const resultado = aplicarEstados(mensajes, [{ id: "a1", estado: "READ", reproducidoAt: "x" }]);
  assert.deepEqual(resultado[0].rawPayload, { reproducidoAt: "x" });
});
