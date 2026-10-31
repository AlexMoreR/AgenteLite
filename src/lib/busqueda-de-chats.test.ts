import assert from "node:assert/strict";
import test from "node:test";

import {
  cifrasParaBuscarElTelefono,
  estadoQueAplica,
  hayBusqueda,
  whereDeBusquedaDeChats,
  whereDeBusquedaDeChatsOficiales,
} from "./busqueda-de-chats";

type Condicion = { contact?: { phoneNumber?: { contains: string }; waId?: { contains: string } } };

// Las cadenas que entran a los `contains` sobre el telefono (canal viejo) o el waId (API oficial).
function cadenasDelTelefono(q: string): string[] {
  const where = whereDeBusquedaDeChats(q) as { OR?: Condicion[] };
  return (where.OR ?? []).map((c) => c.contact?.phoneNumber?.contains).filter((v): v is string => Boolean(v));
}
function cadenasDelWaId(q: string): string[] {
  const where = whereDeBusquedaDeChatsOficiales(q) as { OR?: Condicion[] };
  return (where.OR ?? []).map((c) => c.contact?.waId?.contains).filter((v): v is string => Boolean(v));
}

// Lo que haria Postgres con el OR: alguna cadena esta dentro del telefono guardado.
const encuentra = (cadenas: string[], guardado: string) => cadenas.some((cadena) => guardado.includes(cadena));

const escritos = ["3012175617", "573012175617", "+57 301 217 5617", "57 3012175617"];

for (const escrito of escritos) {
  test(`"${escrito}" encuentra el telefono guardado con y sin el 57`, () => {
    for (const cadenas of [cadenasDelTelefono(escrito), cadenasDelWaId(escrito)]) {
      assert.ok(encuentra(cadenas, "573012175617"), `con 57: ${cadenas.join(" | ")}`);
      assert.ok(encuentra(cadenas, "3012175617"), `sin 57: ${cadenas.join(" | ")}`);
      // Y no cualquier numero: uno distinto no sale.
      assert.ok(!encuentra(cadenas, "573009998877"));
    }
  });
}

test("las variantes no repiten lo escrito tal cual", () => {
  assert.deepEqual(cifrasParaBuscarElTelefono("3012175617"), []);
  assert.deepEqual(cifrasParaBuscarElTelefono("573012175617"), ["3012175617"]);
  assert.deepEqual(cifrasParaBuscarElTelefono("+57 301 217 5617"), ["573012175617", "3012175617"]);
});

test("con letras no se arman variantes de telefono", () => {
  assert.deepEqual(cifrasParaBuscarElTelefono("Pedro 573012175617"), []);
  assert.deepEqual(cadenasDelTelefono("Pedro"), ["Pedro"]);
});

test("un numero de 12 cifras que no empieza por 57 no pierde cifras", () => {
  assert.deepEqual(cifrasParaBuscarElTelefono("593012175617"), []);
});

test("sin texto la busqueda no agrega nada", () => {
  assert.deepEqual(whereDeBusquedaDeChats("   "), {});
  assert.deepEqual(whereDeBusquedaDeChatsOficiales(""), {});
});

test("con busqueda el estado que se aplica es 'all'; sin busqueda queda igual", () => {
  assert.equal(hayBusqueda("3012175617"), true);
  assert.equal(hayBusqueda("  "), false);
  assert.equal(hayBusqueda(undefined), false);
  for (const estado of ["open", "resolved", "all"] as const) {
    assert.equal(estadoQueAplica(estado, "3012175617"), "all");
    assert.equal(estadoQueAplica(estado, " Pedro "), "all");
    assert.equal(estadoQueAplica(estado, ""), estado);
    assert.equal(estadoQueAplica(estado, "   "), estado);
    assert.equal(estadoQueAplica(estado, null), estado);
  }
});
