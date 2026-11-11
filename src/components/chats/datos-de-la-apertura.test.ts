// Pruebas de lo que trae /live al abrir un chat. Correr: npm run test:velocidad-chat
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  empezoLaApertura,
  esperarLaApertura,
  terminoLaApertura,
  tomarFichaDeLaApertura,
  tomarSeguimientosDeLaApertura,
} from "./datos-de-la-apertura";

test("sin apertura en camino no se espera nada", async () => {
  const inicio = Date.now();
  await esperarLaApertura(1000);
  assert.ok(Date.now() - inicio < 50);
});

test("la ficha y el interruptor esperan a /live y lo toman una sola vez", async () => {
  empezoLaApertura();
  const espera = esperarLaApertura(2000).then(() => ({
    ficha: tomarFichaDeLaApertura("contacto-1"),
    seguimientos: tomarSeguimientosDeLaApertura("chat-1"),
  }));
  setTimeout(() => {
    terminoLaApertura({ contactId: "contacto-1", ficha: { name: "Ana" }, conversationId: "chat-1", seguimientosApagados: true });
  }, 20);
  const { ficha, seguimientos } = await espera;
  assert.deepEqual(ficha, { name: "Ana" });
  assert.equal(seguimientos, true);
  assert.equal(tomarFichaDeLaApertura("contacto-1"), null, "una sola vez");
  assert.equal(tomarSeguimientosDeLaApertura("chat-1"), null);
});

test("si /live no los trae (API oficial, error) se pregunta como antes", async () => {
  empezoLaApertura();
  setTimeout(() => terminoLaApertura(undefined), 10);
  await esperarLaApertura(2000);
  assert.equal(tomarFichaDeLaApertura("otro"), null);
  assert.equal(tomarSeguimientosDeLaApertura("otro"), null);
});

test("si /live no contesta, la espera tiene tope", async () => {
  empezoLaApertura();
  const inicio = Date.now();
  await esperarLaApertura(60);
  assert.ok(Date.now() - inicio >= 55);
  terminoLaApertura();
});
