import assert from "node:assert/strict";
import { test } from "node:test";

import { crearPedidoCompartido, type ConstructorDeCanal } from "./pedido-compartido-entre-pestanas";

/*
  Un `BroadcastChannel` falso: lo que una "pestaña" publica les llega a las demas con el mismo nombre
  (no a ella misma), un momento despues, como en el navegador.
*/
function crearCanalFalso(): ConstructorDeCanal {
  const abiertos = new Map<string, Set<CanalFalso>>();
  class CanalFalso {
    onmessage: ((evento: { data: unknown }) => void) | null = null;
    constructor(private readonly nombre: string) {
      if (!abiertos.has(nombre)) abiertos.set(nombre, new Set());
      abiertos.get(nombre)!.add(this);
    }
    postMessage(mensaje: unknown) {
      const copia = structuredClone(mensaje);
      for (const otro of abiertos.get(this.nombre) ?? []) {
        if (otro !== this) setTimeout(() => otro.onmessage?.({ data: copia }), 0);
      }
    }
    close() {
      abiertos.get(this.nombre)?.delete(this);
    }
  }
  return CanalFalso;
}

const entregar = () => new Promise((resolver) => setTimeout(resolver, 5));
const dormir = (ms: number) => new Promise((resolver) => setTimeout(resolver, ms));

function contador<T>(valor: T) {
  const pedir = async () => {
    pedir.veces += 1;
    return valor;
  };
  pedir.veces = 0;
  return pedir;
}

test("si no hay dato, pide a la red", async () => {
  const pestana = crearPedidoCompartido({ Canal: crearCanalFalso() });
  const pedir = contador({ n: 1 });
  const resultado = await pestana.pedirCompartido("/list", 60_000, pedir);
  assert.deepEqual(resultado, { dato: { n: 1 }, origen: "red" });
  assert.equal(pedir.veces, 1);
  pestana.cerrar();
});

test("si otra pestaña publicó hace poco, usa ese dato y no pide", async () => {
  const Canal = crearCanalFalso();
  const a = crearPedidoCompartido({ Canal });
  const b = crearPedidoCompartido({ Canal });
  await a.pedirCompartido("/list", 60_000, contador({ n: "de A" }));
  await entregar();

  const pedirB = contador({ n: "de B" });
  const resultado = await b.pedirCompartido("/list", 60_000, pedirB);
  assert.deepEqual(resultado, { dato: { n: "de A" }, origen: "compartido" });
  assert.equal(pedirB.veces, 0);
  a.cerrar();
  b.cerrar();
});

test("si otra pestaña ya está pidiendo, espera su respuesta en vez de pedir otra vez", async () => {
  const Canal = crearCanalFalso();
  const a = crearPedidoCompartido({ Canal });
  const b = crearPedidoCompartido({ Canal });
  const lenta = async () => {
    await dormir(40);
    return "de A";
  };
  const deA = a.pedirCompartido("/list", 3000, lenta);
  await entregar();

  const pedirB = contador("de B");
  const resultado = await b.pedirCompartido("/list", 3000, pedirB);
  assert.deepEqual(resultado, { dato: "de A", origen: "compartido" });
  assert.equal(pedirB.veces, 0);
  assert.equal((await deA).origen, "red");
  a.cerrar();
  b.cerrar();
});

test("si el dato es viejo, pide", async () => {
  const Canal = crearCanalFalso();
  const a = crearPedidoCompartido({ Canal });
  const b = crearPedidoCompartido({ Canal });
  await a.pedirCompartido("/list", 10, contador("de A"));
  await entregar();
  await dormir(30);

  const pedirB = contador("de B");
  const resultado = await b.pedirCompartido("/list", 10, pedirB);
  assert.deepEqual(resultado, { dato: "de B", origen: "red" });
  assert.equal(pedirB.veces, 1);
  a.cerrar();
  b.cerrar();
});

test("sin BroadcastChannel, pide siempre", async () => {
  const pestana = crearPedidoCompartido({ Canal: null });
  const pedir = contador("dato");
  for (let i = 0; i < 3; i += 1) {
    assert.deepEqual(await pestana.pedirCompartido("/list", 60_000, pedir), { dato: "dato", origen: "red" });
  }
  assert.equal(pedir.veces, 3);
});

test("si el canal revienta al crearse, pide como siempre", async () => {
  class CanalRoto {
    constructor() {
      throw new Error("sin canal");
    }
  }
  const pestana = crearPedidoCompartido({ Canal: CanalRoto as unknown as ConstructorDeCanal });
  const pedir = contador("dato");
  assert.deepEqual(await pestana.pedirCompartido("/list", 60_000, pedir), { dato: "dato", origen: "red" });
  assert.equal(pedir.veces, 1);
});

test("las claves distintas no se mezclan", async () => {
  const Canal = crearCanalFalso();
  const a = crearPedidoCompartido({ Canal });
  const b = crearPedidoCompartido({ Canal });
  await a.pedirCompartido("/list?limit=40", 60_000, contador("lista"));
  await entregar();

  const pedirConteos = contador("conteos");
  const resultado = await b.pedirCompartido("/counts", 60_000, pedirConteos);
  assert.deepEqual(resultado, { dato: "conteos", origen: "red" });
  assert.equal(pedirConteos.veces, 1);
  a.cerrar();
  b.cerrar();
});

test("en la misma pestaña, dos pedidos a la vez de la misma clave salen una sola vez", async () => {
  const pestana = crearPedidoCompartido({ Canal: crearCanalFalso() });
  let veces = 0;
  const pedir = async () => {
    veces += 1;
    await dormir(10);
    return veces;
  };
  const [uno, dos] = await Promise.all([
    pestana.pedirCompartido("/list", 0, pedir),
    pestana.pedirCompartido("/list", 0, pedir),
  ]);
  assert.equal(veces, 1);
  assert.deepEqual(uno, dos);
  pestana.cerrar();
});

test("si el pedido falla, el error llega a quien pidió y no se publica nada", async () => {
  const Canal = crearCanalFalso();
  const a = crearPedidoCompartido({ Canal });
  // B ve el aviso "pidiendo" de A: espera un rato corto y, como no llega nada, pide el suyo.
  const b = crearPedidoCompartido({ Canal, esperaMaximaMs: 50 });
  await assert.rejects(
    a.pedirCompartido("/list", 60_000, async () => {
      throw new Error("sin red");
    }),
    /sin red/,
  );
  await entregar();
  const pedirB = contador("de B");
  assert.deepEqual(await b.pedirCompartido("/list", 60_000, pedirB), { dato: "de B", origen: "red" });
  a.cerrar();
  b.cerrar();
});
