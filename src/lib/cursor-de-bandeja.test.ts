// Recorre en memoria la bandeja por paginas con el cursor, en los dos ordenes, y comprueba que no se
// repite ni falta ningun chat y que el orden es el de `ordenDeBandeja`.
//   npx tsx --test src/lib/cursor-de-bandeja.test.ts
import assert from "node:assert/strict";
import test from "node:test";

import type { OrdenDeBandeja } from "@/features/chats/domain/filtros-de-bandeja";
import {
  ORDEN_DE_BANDEJA,
  cortarPagina,
  leerCursor,
  ordenDeBandeja,
  whereDespuesDelCursor,
  type PosicionEnBandeja,
} from "./cursor-de-bandeja";

type Valor = Date | string | null;
type Fila = PosicionEnBandeja;

function comparar(a: Valor, b: Valor): number {
  const x = a instanceof Date ? a.getTime() : a;
  const y = b instanceof Date ? b.getTime() : b;
  return x! < y! ? -1 : x! > y! ? 1 : 0;
}

function campo(fila: Fila, nombre: string): Valor {
  return (fila as unknown as Record<string, Valor>)[nombre];
}

/** Evalua en memoria el subconjunto de `where` de Prisma que arma `whereDespuesDelCursor`. */
function cumple(fila: Fila, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([clave, condicion]) => {
    if (clave === "OR") return (condicion as Array<Record<string, unknown>>).some((w) => cumple(fila, w));
    if (clave === "AND") return (condicion as Array<Record<string, unknown>>).every((w) => cumple(fila, w));
    const valor = campo(fila, clave);
    if (condicion === null) return valor === null;
    if (condicion instanceof Date || typeof condicion === "string") {
      return valor !== null && comparar(valor, condicion) === 0;
    }
    const op = condicion as { lt?: Valor; gt?: Valor; not?: null };
    // Como en SQL: comparar contra NULL nunca es verdadero.
    if ("not" in op) return valor !== null;
    if (valor === null) return false;
    if ("lt" in op) return comparar(valor, op.lt!) < 0;
    if ("gt" in op) return comparar(valor, op.gt!) > 0;
    throw new Error(`condicion no soportada: ${JSON.stringify(condicion)}`);
  });
}

/** Ordena como Postgres el orderBy que devuelve `ordenDeBandeja`: DESC pone los NULL primero, ASC al final. */
function ordenarComoPostgres(filas: Fila[], orderBy: Array<Record<string, string>>): Fila[] {
  return [...filas].sort((a, b) => {
    for (const paso of orderBy) {
      const [nombre, sentido] = Object.entries(paso)[0];
      const x = campo(a, nombre);
      const y = campo(b, nombre);
      let r: number;
      if (x === null && y === null) r = 0;
      else if (x === null) r = sentido === "desc" ? -1 : 1;
      else if (y === null) r = sentido === "desc" ? 1 : -1;
      else r = sentido === "desc" ? -comparar(x, y) : comparar(x, y);
      if (r !== 0) return r;
    }
    return 0;
  });
}

const hora = (minuto: number) => new Date(Date.UTC(2026, 10, 20, 10, minuto));

function bandejaDePrueba(): Fila[] {
  const filas: Fila[] = [];
  // Sin ultimo mensaje: con updatedAt distintas y dos con la misma.
  filas.push({ id: "n1", lastMessageAt: null, updatedAt: hora(1) });
  filas.push({ id: "n2", lastMessageAt: null, updatedAt: hora(5) });
  filas.push({ id: "n3", lastMessageAt: null, updatedAt: hora(5) });
  filas.push({ id: "n4", lastMessageAt: null, updatedAt: hora(9) });
  // Misma hora de ultimo mensaje y misma updatedAt: solo el id desempata.
  for (const id of ["m1", "m2", "m3", "m4"]) filas.push({ id, lastMessageAt: hora(30), updatedAt: hora(31) });
  // Misma hora de ultimo mensaje y updatedAt distintas.
  filas.push({ id: "u1", lastMessageAt: hora(30), updatedAt: hora(40) });
  filas.push({ id: "u2", lastMessageAt: hora(30), updatedAt: hora(20) });
  // Chats distintos.
  for (let i = 0; i < 9; i += 1) filas.push({ id: `d${i}`, lastMessageAt: hora(50 - i * 4), updatedAt: hora(55) });
  return filas;
}

function recorrer(filas: Fila[], orden: OrdenDeBandeja | undefined, limit: number): Fila[] {
  const ordenadas = ordenarComoPostgres(filas, ordenDeBandeja(orden) as Array<Record<string, string>>);
  const vistas: Fila[] = [];
  let cursor: string | null = null;
  for (let vuelta = 0; vuelta < 100; vuelta += 1) {
    const posicion: PosicionEnBandeja | null = cursor ? leerCursor(cursor) : null;
    const candidatas: Fila[] = posicion
      ? ordenadas.filter((f) => cumple(f, whereDespuesDelCursor(posicion, orden) as Record<string, unknown>))
      : ordenadas;
    const pagina: ReturnType<typeof cortarPagina<Fila>> = cortarPagina(candidatas.slice(0, limit + 1), limit);
    vistas.push(...pagina.consumidas);
    if (!pagina.hayMas) return vistas;
    cursor = pagina.nextCursor;
  }
  throw new Error("el recorrido no termino");
}

test("sin orden y con recientes es el ORDEN_DE_BANDEJA de hoy", () => {
  assert.equal(ordenDeBandeja(), ORDEN_DE_BANDEJA);
  assert.equal(ordenDeBandeja("recientes"), ORDEN_DE_BANDEJA);
});

test("antiguos es el espejo exacto de recientes", () => {
  assert.deepEqual(ordenDeBandeja("antiguos"), [{ lastMessageAt: "asc" }, { updatedAt: "asc" }, { id: "asc" }]);
});

test("sin orden, whereDespuesDelCursor es identico al de recientes", () => {
  const conFecha = { id: "a", lastMessageAt: hora(3), updatedAt: hora(4) };
  const sinFecha = { id: "b", lastMessageAt: null, updatedAt: hora(4) };
  assert.deepEqual(whereDespuesDelCursor(conFecha), whereDespuesDelCursor(conFecha, "recientes"));
  assert.deepEqual(whereDespuesDelCursor(sinFecha), whereDespuesDelCursor(sinFecha, "recientes"));
});

for (const orden of [undefined, "recientes", "antiguos"] as const) {
  for (const limit of [1, 2, 3, 5, 7, 50]) {
    test(`orden ${orden ?? "(sin orden)"}, paginas de ${limit}: ni repetidos ni faltantes, en orden`, () => {
      const filas = bandejaDePrueba();
      const esperado = ordenarComoPostgres(filas, ordenDeBandeja(orden) as Array<Record<string, string>>).map((f) => f.id);
      const vistas = recorrer(filas, orden, limit).map((f) => f.id);
      assert.equal(new Set(vistas).size, vistas.length, "se repitio un chat");
      assert.deepEqual(vistas, esperado);
      assert.equal(vistas.length, filas.length);
    });
  }
}

test("recientes pone los chats sin fecha primero; antiguos, al final", () => {
  const filas = bandejaDePrueba();
  const recientes = recorrer(filas, "recientes", 3).map((f) => f.id);
  const antiguos = recorrer(filas, "antiguos", 3).map((f) => f.id);
  assert.deepEqual(recientes.slice(0, 4), ["n4", "n3", "n2", "n1"]);
  assert.deepEqual(antiguos.slice(-4), ["n1", "n2", "n3", "n4"]);
  assert.deepEqual([...antiguos].reverse(), recientes);
});

test("antiguos: un cursor sin fecha solo deja pasar los NULL de despues", () => {
  const where = whereDespuesDelCursor({ id: "n2", lastMessageAt: null, updatedAt: hora(5) }, "antiguos");
  const ids = bandejaDePrueba()
    .filter((f) => cumple(f, where as Record<string, unknown>))
    .map((f) => f.id)
    .sort();
  assert.deepEqual(ids, ["n3", "n4"]);
});
