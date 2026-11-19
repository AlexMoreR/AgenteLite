import assert from "node:assert/strict";
import test from "node:test";

import { claveDeContadores } from "./cache-de-contadores";

const base = { workspaceId: "ws1", userId: "u1" };

test("el orden de los parametros no cambia la clave", () => {
  assert.equal(
    claveDeContadores({ ...base, busqueda: "?status=open&connection=channel:a&q=hola" }),
    claveDeContadores({ ...base, busqueda: "?q=hola&connection=channel:a&status=open" }),
  );
});

test("otra persona, otro negocio o cualquier filtro distinto da otra clave", () => {
  const referencia = claveDeContadores({ ...base, busqueda: "?status=open&assigned=mine" });
  assert.notEqual(referencia, claveDeContadores({ ...base, userId: "u2", busqueda: "?status=open&assigned=mine" }));
  assert.notEqual(referencia, claveDeContadores({ ...base, workspaceId: "ws2", busqueda: "?status=open&assigned=mine" }));
  assert.notEqual(referencia, claveDeContadores({ ...base, busqueda: "?status=open&assigned=all" }));
  assert.notEqual(referencia, claveDeContadores({ ...base, busqueda: "?status=resolved&assigned=mine" }));
  assert.notEqual(referencia, claveDeContadores({ ...base, busqueda: "?status=open&assigned=mine&q=x" }));
});

test("parametros repetidos conservan sus valores", () => {
  assert.notEqual(claveDeContadores({ ...base, busqueda: "?a=1&a=2" }), claveDeContadores({ ...base, busqueda: "?a=1" }));
});

test("la memoria comparte la carga, y un cambio de permisos la vacia", async () => {
  const { cacheDeContadores } = await import("./cache-de-contadores");
  const { invalidarTrasEscritura } = await import("./cache-de-permisos");
  cacheDeContadores.vaciar();
  let cargas = 0;
  const cargar = async () => ({ n: ++cargas });
  const [a, b] = await Promise.all([cacheDeContadores.obtener("k", cargar), cacheDeContadores.obtener("k", cargar)]);
  assert.deepEqual(a, b);
  await cacheDeContadores.obtener("k", cargar);
  assert.equal(cargas, 1);
  invalidarTrasEscritura("WorkspaceMember", "update");
  await cacheDeContadores.obtener("k", cargar);
  assert.equal(cargas, 2);
});
