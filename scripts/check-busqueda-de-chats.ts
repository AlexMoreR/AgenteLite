import assert from "node:assert/strict";

import {
  estadoAlBuscar,
  whereDeBusquedaDeChats,
  whereDeBusquedaDeChatsOficiales,
} from "../src/lib/busqueda-de-chats";

/*
  El buscador de la bandeja con el caso real del 22-10-2026: el chat de 573012175617 (cerrado,
  Descartado) no salia buscando su numero. Se prueba lo que arma la consulta, sin base: cada
  `contains` del telefono se evalua contra el numero guardado como lo haria Postgres.
*/

type Condicion = { contact?: { phoneNumber?: { contains: string }; waId?: { contains: string } } };

function encuentraElTelefono(q: string, guardado: string, oficial = false): boolean {
  const where = oficial ? whereDeBusquedaDeChatsOficiales(q) : whereDeBusquedaDeChats(q);
  const condiciones = (where.OR ?? []) as Condicion[];
  return condiciones.some((condicion) => {
    const campo = oficial ? condicion.contact?.waId : condicion.contact?.phoneNumber;
    return campo ? guardado.toLowerCase().includes(campo.contains.toLowerCase()) : false;
  });
}

const busquedas = ["3012175617", "573012175617", "+57 301 217 5617", "57 3012175617", "301 217 5617"];
const guardados = ["573012175617", "3012175617"];

let ok = 0;
for (const q of busquedas) {
  for (const guardado of guardados) {
    assert.ok(encuentraElTelefono(q, guardado), `"${q}" no encuentra el telefono guardado como ${guardado}`);
    assert.ok(encuentraElTelefono(q, guardado, true), `"${q}" no encuentra el waId guardado como ${guardado}`);
    ok += 2;
  }
}

// Lo que no es el numero no aparece.
assert.equal(encuentraElTelefono("573012175618", "3012175617"), false, "otro numero no debe coincidir");
assert.equal(encuentraElTelefono("583012175617", "3012175617"), false, "sin 57 delante no se recorta");
ok += 2;

// Con busqueda el estado no filtra; sin busqueda queda el de siempre.
assert.equal(estadoAlBuscar("open", "3012175617"), "all");
assert.equal(estadoAlBuscar("resolved", "Pedro"), "all");
assert.equal(estadoAlBuscar("open", ""), "open");
assert.equal(estadoAlBuscar("open", "   "), "open");
assert.equal(estadoAlBuscar("resolved", ""), "resolved");
ok += 5;

console.log(`${ok} pruebas del buscador de chats: OK`);
