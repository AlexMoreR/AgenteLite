import assert from "node:assert/strict";

import {
  cifrasDeLaBusqueda,
  estadoParaLaBusqueda,
  numerosDeLaBusqueda,
  whereDeBusquedaDeChats,
  whereDeBusquedaDeChatsOficiales,
} from "../src/lib/busqueda-de-chats";

// Las condiciones del OR, sin los tipos de Prisma: aqui solo importa su forma.
type Condicion = {
  contact?: Record<string, { contains?: unknown } | undefined>;
  messages?: { some: { content: { contains: string }; createdAt: { gte: Date } } };
};

function condicionesDe(where: object): Condicion[] {
  return ((where as { OR?: Condicion[] }).OR ?? []) as Condicion[];
}

// Imita el `contains` de Postgres (ILIKE '%algo%') sobre el campo del telefono del contacto:
// `phoneNumber` en el canal viejo y `waId` en la API oficial. Con cifras, mayusculas da igual.
function encuentraElTelefono(where: object, campo: "phoneNumber" | "waId", guardado: string): boolean {
  return condicionesDe(where).some((c) => {
    const buscado = c.contact?.[campo]?.contains;
    return typeof buscado === "string" && guardado.toLowerCase().includes(buscado.toLowerCase());
  });
}

// Lo que se busca en el telefono (lo escrito tal cual y sus variantes).
function buscadosEnElTelefono(where: object, campo: "phoneNumber" | "waId"): string[] {
  return condicionesDe(where)
    .map((c) => c.contact?.[campo]?.contains)
    .filter((v): v is string => typeof v === "string");
}

const tieneMensajes = (where: object) => condicionesDe(where).some((c) => "messages" in c);

const casos: Array<[string, () => void]> = [];
const caso = (nombre: string, prueba: () => void) => casos.push([nombre, prueba]);

// 1. Un numero escrito de cualquier forma encuentra el telefono guardado con o sin el 57.
const escritos = ["3012175617", "573012175617", "+57 301 217 5617", "57 3012175617"];
const guardados = ["573012175617", "3012175617"];
for (const escrito of escritos) {
  for (const guardado of guardados) {
    caso(`"${escrito}" encuentra el telefono guardado "${guardado}" (canal viejo)`, () => {
      assert.ok(encuentraElTelefono(whereDeBusquedaDeChats(escrito), "phoneNumber", guardado));
    });
    caso(`"${escrito}" encuentra el waId guardado "${guardado}" (API oficial)`, () => {
      assert.ok(encuentraElTelefono(whereDeBusquedaDeChatsOficiales(escrito), "waId", guardado));
    });
  }
}

// 2. Variantes del numero y busqueda en mensajes.
caso("un numero de 12 cifras que no es de Colombia no se busca sin prefijo", () => {
  assert.deepEqual(numerosDeLaBusqueda("523012175617"), []);
  const buscados = buscadosEnElTelefono(whereDeBusquedaDeChats("523012175617"), "phoneNumber");
  assert.ok(!buscados.includes("3012175617"), `salio ${JSON.stringify(buscados)}`);
  assert.ok(!encuentraElTelefono(whereDeBusquedaDeChats("523012175617"), "phoneNumber", "3012175617"));
});
caso("con separadores, un numero que no es de Colombia solo se busca con sus cifras", () => {
  assert.deepEqual(numerosDeLaBusqueda("+52 301 217 5617"), ["523012175617"]);
});
caso("un celular de Colombia con el 57 se busca tambien sin el 57", () => {
  assert.deepEqual(numerosDeLaBusqueda("573012175617"), ["3012175617"]);
  assert.deepEqual(numerosDeLaBusqueda("+57 301 217 5617"), ["573012175617", "3012175617"]);
});
caso('"Pedro 2024" no genera variantes numericas', () => {
  assert.equal(cifrasDeLaBusqueda("Pedro 2024"), null);
  assert.deepEqual(numerosDeLaBusqueda("Pedro 2024"), []);
  assert.deepEqual(buscadosEnElTelefono(whereDeBusquedaDeChats("Pedro 2024"), "phoneNumber"), ["Pedro 2024"]);
  assert.deepEqual(buscadosEnElTelefono(whereDeBusquedaDeChatsOficiales("Pedro 2024"), "waId"), ["Pedro 2024"]);
});
caso("cifrasDeLaBusqueda quita los separadores y no repite lo escrito sin ellos", () => {
  assert.equal(cifrasDeLaBusqueda("300 123-4567"), "3001234567");
  assert.equal(cifrasDeLaBusqueda("3001234567"), null);
  assert.equal(cifrasDeLaBusqueda("1 2"), null);
});
caso("con menos de 4 letras no se busca en los mensajes", () => {
  assert.ok(!tieneMensajes(whereDeBusquedaDeChats("abc")));
  assert.ok(!tieneMensajes(whereDeBusquedaDeChatsOficiales("abc")));
  assert.ok(!tieneMensajes(whereDeBusquedaDeChats("  abc  ")), "los espacios no cuentan como letras");
});
caso("con 4 letras o mas si se busca en los mensajes, de los ultimos 90 dias", () => {
  const ahora = new Date("2026-10-22T12:00:00Z");
  for (const where of [whereDeBusquedaDeChats("abcd", ahora), whereDeBusquedaDeChatsOficiales("abcd", ahora)]) {
    const mensajes = condicionesDe(where).find((c) => "messages" in c)?.messages;
    assert.ok(mensajes, "falta la condicion de mensajes");
    assert.equal(mensajes.some.content.contains, "abcd");
    assert.equal(mensajes.some.createdAt.gte.toISOString(), "2026-07-24T12:00:00.000Z");
  }
});

// 3. Con algo escrito, el estado no filtra.
caso("estadoParaLaBusqueda", () => {
  assert.equal(estadoParaLaBusqueda("open", "3012175617"), "all");
  assert.equal(estadoParaLaBusqueda("resolved", "x"), "all");
  assert.equal(estadoParaLaBusqueda("open", ""), "open");
  assert.equal(estadoParaLaBusqueda("resolved", "   "), "resolved");
  assert.equal(estadoParaLaBusqueda("all", ""), "all");
});

// 4. Sin texto, la busqueda no agrega nada.
caso("sin texto o con solo espacios no se agrega nada", () => {
  assert.deepEqual(whereDeBusquedaDeChats(""), {});
  assert.deepEqual(whereDeBusquedaDeChats("   "), {});
  assert.deepEqual(whereDeBusquedaDeChatsOficiales(""), {});
  assert.deepEqual(whereDeBusquedaDeChatsOficiales("   "), {});
});

let ok = 0;
for (const [nombre, prueba] of casos) {
  try {
    prueba();
  } catch (error) {
    console.error(`FALLA: ${nombre}`);
    throw error;
  }
  ok++;
}
console.log(`${ok} pruebas del buscador de chats: OK`);
