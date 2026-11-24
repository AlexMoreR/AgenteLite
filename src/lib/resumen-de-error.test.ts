import { test } from "node:test";
import assert from "node:assert/strict";

import { esPasajera, lineaDeEventoDePrisma, resumenDeError } from "./resumen-de-error";
import { procesarPedido } from "./chats/ruta-de-envio";
// El mismo criterio que usa la vigilancia de 30 minutos para decidir si una linea es una falla.
import { esLineaDeErrorReal } from "../../trabajador-tablero/lib/zonas.mjs";

/*
  Los errores de Prisma y de las rutas de envio del chat quedan en UNA linea: la vigilancia de 30
  minutos no cuenta un corte pasajero (base o red) como falla, y un error de verdad sigue contando.
*/

/** Un error como los que lanza Prisma: mensaje de varias lineas y `code` Pxxxx. */
function errorDePrisma(mensaje: string, code: string) {
  return Object.assign(new Error(mensaje), { name: "PrismaClientKnownRequestError", code });
}

const PRISMA_P2002 = errorDePrisma(
  "\nInvalid `prisma.contact.create()` invocation in\n/app/.next/server/chunks/123.js:1:2\n\n  1 import\n\nUnique constraint failed on the fields: (`phone`)",
  "P2002",
);
const PRISMA_P1001 = errorDePrisma(
  "\nInvalid `prisma.message.findMany()` invocation:\n\nCan't reach database server at `db:5432`\n\nPlease make sure your database server is running.",
  "P1001",
);
const EAI_AGAIN = Object.assign(new Error("getaddrinfo EAI_AGAIN evolution"), { code: "EAI_AGAIN" });
// Lo que lanza fetch con AbortSignal.timeout().
const TIEMPO = new DOMException("The operation was aborted due to timeout", "TimeoutError");
const COMUN = new Error("se cayo el gateway");

/** Corre `accion` capturando lo que sale por console.info, console.warn y console.error. */
async function capturarRegistro(accion: () => Promise<unknown> | unknown) {
  const salida = { info: [] as string[], warn: [] as string[], error: [] as string[] };
  const originales = { info: console.info, warn: console.warn, error: console.error };
  console.info = (...args: unknown[]) => void salida.info.push(args.map(String).join(" "));
  console.warn = (...args: unknown[]) => void salida.warn.push(args.map(String).join(" "));
  console.error = (...args: unknown[]) => void salida.error.push(args.map(String).join(" "));
  try {
    await accion();
  } finally {
    Object.assign(console, originales);
  }
  return salida;
}

/** La linea que deja la ruta de envio del chat (registro por defecto, sin alLanzar) cuando la accion lanza `error`. */
async function lineaDeChats(error: unknown) {
  let respuesta: Awaited<ReturnType<typeof procesarPedido>> | null = null;
  const salida = await capturarRegistro(async () => {
    respuesta = await procesarPedido({
      nombre: "enviar-ubicacion",
      sesionValida: true,
      accesoAChats: true,
      leerCuerpo: async () => JSON.stringify({ conversationId: "conv-1" }),
      accion: async () => {
        throw error;
      },
    });
  });
  // La respuesta no cambia (contrato): 500 con lanzo:true.
  assert.deepEqual(respuesta, { status: 500, cuerpo: { error: "No se pudo enviar", lanzo: true } });
  const lineas = [...salida.info, ...salida.warn, ...salida.error];
  assert.equal(lineas.length, 1, `una sola linea: ${JSON.stringify(lineas)}`);
  return { linea: lineas[0], nivel: salida.error.length ? "error" : "info" };
}

/** Comprueba las dos lineas ([prisma] y [chats/...]) de un error: sin saltos y con la regla de la vigilancia. */
async function comprobarLineas(error: unknown, pasajera: boolean) {
  const prisma = lineaDeEventoDePrisma("error", error);
  assert.ok(prisma.linea.startsWith("[prisma] {"), prisma.linea);
  assert.ok(!prisma.linea.includes("\n"), `[prisma] sin saltos de linea: ${JSON.stringify(prisma.linea)}`);
  assert.equal(prisma.nivel, pasajera ? "info" : "error", prisma.linea);
  assert.equal(esLineaDeErrorReal(prisma.linea), !pasajera, `vigilancia [prisma]: ${prisma.linea}`);

  const chats = await lineaDeChats(error);
  assert.ok(chats.linea.startsWith("[chats/enviar-ubicacion] "), chats.linea);
  assert.ok(!chats.linea.includes("\n"), `[chats] sin saltos de linea: ${JSON.stringify(chats.linea)}`);
  assert.equal(chats.nivel, pasajera ? "info" : "error", chats.linea);
  assert.equal(esLineaDeErrorReal(chats.linea), !pasajera, `vigilancia [chats]: ${chats.linea}`);
  return { prisma: prisma.linea, chats: chats.linea };
}

test("error de Prisma de varias lineas (P2002): una linea, con codigo, y no es pasajero", async () => {
  const resumen = resumenDeError(PRISMA_P2002);
  assert.deepEqual(resumen, {
    causa: "base-P2002",
    codigo: "P2002",
    texto: "Invalid `prisma.contact.create()` invocation in",
  });
  assert.equal(esPasajera(PRISMA_P2002), false);
  const { prisma, chats } = await comprobarLineas(PRISMA_P2002, false);
  assert.ok(prisma.includes('"codigo":"P2002"') && prisma.includes('"error":"Invalid'), prisma);
  assert.ok(chats.startsWith("[chats/enviar-ubicacion] el envio lanzo un error {"), chats);
  assert.ok(!chats.includes("error: '"), "ya no sale `error: '\\n' +`");
});

test("error de Prisma P1001 (no llega a la base): pasajero, informativo y sin el texto", async () => {
  assert.equal(resumenDeError(PRISMA_P1001).codigo, "P1001");
  assert.equal(esPasajera(PRISMA_P1001), true);
  const { prisma, chats } = await comprobarLineas(PRISMA_P1001, true);
  assert.equal(prisma, '[prisma] {"nivel":"corte","causa":"base-P1001","codigo":"P1001"}');
  assert.equal(
    chats,
    '[chats/enviar-ubicacion] el envio no salio (corte pasajero) {"conversationId":"conv-1","causa":"base-P1001","codigo":"P1001"}',
  );
});

test("EAI_AGAIN: causa sin-conexion y es pasajero", async () => {
  assert.deepEqual(resumenDeError(EAI_AGAIN), { causa: "sin-conexion", codigo: null, texto: "getaddrinfo EAI_AGAIN evolution" });
  assert.equal(esPasajera(EAI_AGAIN), true);
  await comprobarLineas(EAI_AGAIN, true);
});

test("'The operation was aborted due to timeout': causa tardo-demasiado y es pasajero", async () => {
  assert.equal(resumenDeError(TIEMPO).causa, "tardo-demasiado");
  assert.equal(esPasajera(TIEMPO), true);
  await comprobarLineas(TIEMPO, true);
});

test("error comun: causa otra, no es pasajero y sigue contando como error", async () => {
  assert.deepEqual(resumenDeError(COMUN), { causa: "otra", codigo: null, texto: "se cayo el gateway" });
  assert.equal(esPasajera(COMUN), false);
  const { chats } = await comprobarLineas(COMUN, false);
  assert.equal(
    chats,
    '[chats/enviar-ubicacion] el envio lanzo un error {"conversationId":"conv-1","causa":"otra","codigo":null,"error":"se cayo el gateway"}',
  );
});

test("texto de 500 letras: queda cortado en 200", () => {
  const largo = new Error("x".repeat(500));
  assert.equal(resumenDeError(largo).texto.length, 200);
  assert.ok(lineaDeEventoDePrisma("error", largo).linea.length < 300);
});

test("evento de Prisma ({message, target}) con P1001 dentro del texto: codigo encontrado y pasajero", async () => {
  const evento = {
    timestamp: new Date(),
    target: "query",
    message: "\nInvalid `prisma.chat.findFirst()` invocation:\n\nError code: P1001\nCan't reach database server at `db:5432`",
  };
  const resumen = resumenDeError(evento);
  assert.equal(resumen.codigo, "P1001");
  assert.equal(resumen.causa, "base-P1001");
  assert.equal(resumen.texto, "Invalid `prisma.chat.findFirst()` invocation:");
  assert.equal(esPasajera(evento), true);
  await comprobarLineas(evento, true);
});

test("codigos de Postgres y textos de conexion caida: pasajeros", () => {
  for (const code of ["57P01", "57P03", "08006"]) {
    assert.equal(esPasajera(Object.assign(new Error("terminating connection"), { code })), true, code);
  }
  assert.equal(esPasajera(new Error("the database system is in recovery mode")), true);
  assert.equal(esPasajera({ message: "Connection terminated unexpectedly" }), true);
  assert.equal(esPasajera({ message: "Timed out fetching a new connection from the connection pool" }), true);
  assert.equal(esPasajera(errorDePrisma("Timed out", "P2024")), true);
});

test("aviso (warn) de Prisma que no es pasajero: console.warn con el texto, y uno pasajero va informativo", () => {
  const aviso = lineaDeEventoDePrisma("warn", { message: "Something to note\nsecond line", target: "x" });
  assert.equal(aviso.nivel, "warn");
  assert.equal(aviso.linea, '[prisma] {"causa":"otra","codigo":null,"aviso":"Something to note"}');
  const pasajero = lineaDeEventoDePrisma("warn", { message: "Connection terminated unexpectedly" });
  assert.equal(pasajero.nivel, "info");
  assert.equal(esLineaDeErrorReal(pasajero.linea), false, pasajero.linea);
});

test("con alLanzar: recibe el mensaje y el detalle de una linea, y la consola queda vacia", async () => {
  const anotado: Array<[string, Record<string, unknown>]> = [];
  const salida = await capturarRegistro(() =>
    procesarPedido({
      nombre: "enviar-archivo",
      sesionValida: true,
      accesoAChats: true,
      leerCuerpo: async () => JSON.stringify({ conversationId: "conv-2" }),
      accion: async () => {
        throw PRISMA_P2002;
      },
      alLanzar: (mensaje, detalle) => anotado.push([mensaje, detalle]),
    }),
  );
  assert.deepEqual([...salida.info, ...salida.warn, ...salida.error], []);
  assert.deepEqual(anotado, [
    [
      "[chats/enviar-archivo] el envio lanzo un error",
      { conversationId: "conv-2", causa: "base-P2002", codigo: "P2002", error: "Invalid `prisma.contact.create()` invocation in" },
    ],
  ]);
});
