// Pruebas de la memoria corta de los filtros de la bandeja. Correr: npx tsx --test src/features/chats/domain/memoria-corta.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { leerConMemoria, type GuardadoEnMemoria } from "./memoria-corta";

test("dos pedidos a la vez hacen UNA sola lectura", async () => {
  const mapa = new Map<string, GuardadoEnMemoria<string[]>>();
  let lecturas = 0;
  let soltar: (ids: string[]) => void = () => {};
  const leer = () => {
    lecturas += 1;
    return new Promise<string[]>((resolve) => {
      soltar = resolve;
    });
  };

  const a = leerConMemoria(mapa, "k", 20_000, leer);
  const b = leerConMemoria(mapa, "k", 20_000, leer);
  soltar(["c1", "c2"]);

  assert.deepEqual(await a, ["c1", "c2"]);
  assert.deepEqual(await b, ["c1", "c2"]);
  assert.equal(lecturas, 1);
});

test("claves distintas leen cada una", async () => {
  const mapa = new Map<string, GuardadoEnMemoria<number>>();
  let lecturas = 0;
  const leer = async () => ++lecturas;
  await Promise.all([leerConMemoria(mapa, "a", 1000, leer), leerConMemoria(mapa, "b", 1000, leer)]);
  assert.equal(lecturas, 2);
});

test("si la lectura falla no queda guardada y la siguiente vuelve a leer", async () => {
  const mapa = new Map<string, GuardadoEnMemoria<string[]>>();
  let lecturas = 0;
  const leer = async () => {
    lecturas += 1;
    if (lecturas === 1) throw new Error("la base no responde");
    return ["c1"];
  };

  await assert.rejects(leerConMemoria(mapa, "k", 20_000, leer), /la base no responde/);
  assert.equal(mapa.has("k"), false);
  assert.deepEqual(await leerConMemoria(mapa, "k", 20_000, leer), ["c1"]);
  assert.equal(lecturas, 2);
});

test("dentro de la vida no vuelve a leer; al vencer, si", async () => {
  const mapa = new Map<string, GuardadoEnMemoria<number>>();
  let reloj = 1_000;
  const ahora = () => reloj;
  let lecturas = 0;
  const leer = async () => ++lecturas;

  assert.equal(await leerConMemoria(mapa, "k", 20_000, leer, ahora), 1);
  reloj += 19_999;
  assert.equal(await leerConMemoria(mapa, "k", 20_000, leer, ahora), 1);
  reloj += 2;
  assert.equal(await leerConMemoria(mapa, "k", 20_000, leer, ahora), 2);
  assert.equal(lecturas, 2);
});

test("la vida empieza a contar cuando llega la respuesta", async () => {
  const mapa = new Map<string, GuardadoEnMemoria<number>>();
  let reloj = 0;
  const ahora = () => reloj;
  let lecturas = 0;
  let soltar: (n: number) => void = () => {};
  const lenta = () => {
    lecturas += 1;
    return new Promise<number>((resolve) => {
      soltar = resolve;
    });
  };

  const primera = leerConMemoria(mapa, "k", 20_000, lenta, ahora);
  reloj = 15_000;
  soltar(7);
  assert.equal(await primera, 7);
  // 10 s despues de la respuesta (25 s despues del pedido) sigue vigente.
  reloj = 25_000;
  assert.equal(await leerConMemoria(mapa, "k", 20_000, lenta, ahora), 7);
  assert.equal(lecturas, 1);
});
