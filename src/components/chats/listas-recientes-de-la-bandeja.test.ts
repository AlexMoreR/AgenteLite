// Pruebas de la memoria de listas de la bandeja. Correr: npx tsx --test src/components/chats/listas-recientes-de-la-bandeja.test.ts
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import {
  LISTA_FRESCA_MS,
  LISTA_VIGENTE_MS,
  cuantasListasRecientes,
  envejecerListasRecientes,
  guardarListaReciente,
  leerListaReciente,
  olvidarListasRecientes,
  type ListaGuardada,
} from "./listas-recientes-de-la-bandeja";

const lista = (at: number, items: string[] = ["a"]): ListaGuardada<string> => ({
  items,
  hasMore: false,
  offset: items.length,
  cursor: null,
  at,
});

beforeEach(() => olvidarListasRecientes());

test("lo guardado se lee igual", () => {
  guardarListaReciente("todas", lista(1_000, ["c1", "c2"]));
  assert.deepEqual(leerListaReciente<string>("todas")?.items, ["c1", "c2"]);
  assert.equal(leerListaReciente("mias"), undefined);
});

test("se guarda hasta 5 y se va la mas vieja", () => {
  for (const clave of ["a", "b", "c", "d", "e", "f"]) guardarListaReciente(clave, lista(1));
  assert.equal(cuantasListasRecientes(), 5);
  assert.equal(leerListaReciente("a"), undefined);
  assert.ok(leerListaReciente("f"));
  // Volver a guardar una la pone al final: la siguiente en irse es "c".
  guardarListaReciente("b", lista(2));
  guardarListaReciente("g", lista(3));
  assert.ok(leerListaReciente("b"));
  assert.equal(leerListaReciente("c"), undefined);
});

test("envejecer no borra: la deja vieja (se muestra y se vuelve a pedir)", () => {
  const ahora = 10_000_000;
  guardarListaReciente("todas", lista(ahora - 1_000));
  guardarListaReciente("mias", lista(ahora - 2 * 60_000));
  envejecerListasRecientes(ahora);

  assert.equal(cuantasListasRecientes(), 2);
  const todas = leerListaReciente<string>("todas");
  assert.ok(todas);
  const edad = ahora - todas.at;
  assert.ok(edad >= LISTA_FRESCA_MS, "ya no es fresca: se vuelve a pedir");
  assert.ok(edad < LISTA_VIGENTE_MS, "sigue vigente: se muestra");
  assert.deepEqual(todas.items, ["a"]);
  // La que ya era vieja queda con su hora (no se rejuvenece).
  assert.equal(leerListaReciente<string>("mias")?.at, ahora - 2 * 60_000);
});

test("envejecer no cambia el orden del tope de 5", () => {
  const ahora = 10_000_000;
  for (const clave of ["a", "b", "c", "d", "e"]) guardarListaReciente(clave, lista(ahora));
  envejecerListasRecientes(ahora);
  guardarListaReciente("f", lista(ahora));
  assert.equal(leerListaReciente("a"), undefined, "se va la primera guardada, igual que antes");
  assert.ok(leerListaReciente("b"));
});

test("envejecer no toca el objeto que guardo quien llama", () => {
  const ahora = 10_000_000;
  const original = lista(ahora);
  guardarListaReciente("todas", original);
  envejecerListasRecientes(ahora);
  assert.equal(original.at, ahora);
});

test("olvidar las borra todas", () => {
  guardarListaReciente("todas", lista(1));
  guardarListaReciente("mias", lista(1));
  olvidarListasRecientes();
  assert.equal(cuantasListasRecientes(), 0);
  assert.equal(leerListaReciente("todas"), undefined);
});

test("la vigencia es de 5 minutos y la frescura de 30 s", () => {
  assert.equal(LISTA_VIGENTE_MS, 5 * 60_000);
  assert.equal(LISTA_FRESCA_MS, 30_000);
});
