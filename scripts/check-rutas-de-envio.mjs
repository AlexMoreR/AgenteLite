// Equivalencia de las rutas fijas de envio del chat con sus Server Actions (src/lib/chats/ruta-de-envio.ts).
// La ruta llama a la MISMA accion: se prueba que le entrega el mismo objeto que le pasaba la pantalla
// y que contesta lo mismo que ella. Las acciones son falsas: no se importa Prisma ni gateways, no hay
// red y no sale ningun mensaje (hay un candado que lo comprueba al final).
// Correr: node scripts/check-rutas-de-envio.mjs
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);
const sourcePath = path.resolve("src/lib/chats/ruta-de-envio.ts");
const transpiled = ts.transpileModule(fs.readFileSync(sourcePath, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: sourcePath,
});
const mod = { exports: {} };
new Function("exports", "require", "module", "__filename", "__dirname", transpiled.outputText)(
  mod.exports,
  require,
  mod,
  sourcePath,
  path.dirname(sourcePath),
);
const { RUTAS_DE_ENVIO, LIMITE_BYTES_DEL_CUERPO, procesarPedido, esRedireccion } = mod.exports;

const congelados = JSON.parse(fs.readFileSync(path.resolve("src/lib/chats/contrato-envios.congelados.json"), "utf8"));
const AVISO_MODO_MONITOREO = fs
  .readFileSync(path.resolve("src/lib/modo-monitoreo.ts"), "utf8")
  .match(/AVISO_MODO_MONITOREO\s*=\s*"([^"]+)"/)?.[1];
assert.ok(AVISO_MODO_MONITOREO, "no encontre AVISO_MODO_MONITOREO en src/lib/modo-monitoreo.ts");

let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

/** Accion falsa: anota lo que recibe y contesta lo que se le diga (o lanza). */
function accionFalsa(contestar = async () => ({ ok: true })) {
  const llamadas = [];
  const accion = async (entrada) => {
    llamadas.push(entrada);
    return contestar(entrada);
  };
  return { accion, llamadas };
}

/** Lo que hara la pantalla en el despliegue ii: el mismo objeto de la Server Action, en JSON. */
function pedir(nombre, entradaDeLaPantalla, accion, extra = {}) {
  const texto = JSON.stringify(entradaDeLaPantalla);
  return procesarPedido({
    nombre,
    sesionValida: true,
    accesoAChats: true,
    largoDeclarado: String(Buffer.byteLength(texto)),
    leerCuerpo: async () => texto,
    accion,
    alLanzar: () => {},
    ...extra,
  });
}

const RUTAS = Object.keys(RUTAS_DE_ENVIO);

await prueba("ida y vuelta: la accion recibe el mismo objeto que le pasaba la pantalla y se contesta lo mismo", async () => {
  for (const [clave, pedido] of Object.entries(congelados.pedidos)) {
    const contesta = { ok: true };
    const { accion, llamadas } = accionFalsa(async () => contesta);
    const respuesta = await pedir(pedido.ruta, pedido.cuerpo, accion);
    assert.equal(llamadas.length, 1, clave);
    assert.deepStrictEqual(llamadas[0], pedido.cuerpo, clave);
    assert.equal(respuesta.status, 200, clave);
    assert.equal(respuesta.cuerpo, contesta, `${clave}: la respuesta no sale tal cual`);
  }
});

await prueba("los campos undefined de la pantalla no viajan (la accion los lee igual: ?. y zod optional)", async () => {
  const { accion, llamadas } = accionFalsa();
  await pedir("enviar-archivo", { ...congelados.pedidos["enviar-archivo/un-archivo"].cuerpo, caption: undefined, agentId: undefined }, accion);
  assert.equal(Object.prototype.hasOwnProperty.call(llamadas[0], "caption"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(llamadas[0], "agentId"), false);
});

await prueba("los valores no se convierten: vacios, null y tipos raros llegan igual (valida la accion)", async () => {
  const { accion, llamadas } = accionFalsa();
  const raro = { conversationId: 123, agentId: null, returnTo: "" };
  await pedir("enviar-ubicacion", raro, accion);
  assert.deepStrictEqual(llamadas[0], raro);
});

await prueba("campos desconocidos y __proto__ no llegan a la accion", async () => {
  const { accion, llamadas } = accionFalsa();
  const texto = '{"messageId":"m1","emoji":"👍","__proto__":{"admin":true},"chatEsperado":"c1"}';
  await procesarPedido({ nombre: "reaccionar", sesionValida: true, accesoAChats: true, leerCuerpo: async () => texto, accion });
  assert.deepStrictEqual(llamadas[0], { messageId: "m1", emoji: "👍" });
  assert.equal(llamadas[0].admin, undefined);
});

await prueba("mismos errores: lo que contesta la accion sale con 200 y el mismo texto", async () => {
  const casos = [
    ["enviar-archivo", { error: "Datos invalidos" }],
    ["enviar-audio", { error: AVISO_MODO_MONITOREO }],
    ["enviar-ubicacion", { error: "Primero cargá la ubicación del local" }],
    ["enviar-flujo", { ok: false, error: AVISO_MODO_MONITOREO }],
    ["reaccionar", { ok: false, error: "Mensaje no encontrado" }],
  ];
  for (const [ruta, error] of casos) {
    const { accion } = accionFalsa(async () => error);
    const respuesta = await pedir(ruta, {}, accion);
    assert.equal(respuesta.status, 200, ruta);
    assert.deepStrictEqual(respuesta.cuerpo, error, ruta);
  }
});

await prueba("la accion hace redirect() (NEXT_REDIRECT): 403 No autorizado", async () => {
  for (const ruta of RUTAS) {
    const { accion } = accionFalsa(async () => {
      throw Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/login;307;" });
    });
    const respuesta = await pedir(ruta, {}, accion);
    assert.equal(respuesta.status, 403, ruta);
    assert.deepStrictEqual(respuesta.cuerpo, { error: "No autorizado" }, ruta);
  }
  assert.equal(esRedireccion(null), false);
  assert.equal(esRedireccion(new Error("x")), false);
});

await prueba("la accion lanza otro error: 500 con lanzo:true y queda anotado con el nombre de la ruta", async () => {
  for (const ruta of RUTAS) {
    const anotado = [];
    const { accion } = accionFalsa(async () => {
      throw new Error("se cayo el gateway");
    });
    const respuesta = await pedir(ruta, { conversationId: "conv-1" }, accion, { alLanzar: (m, d) => anotado.push([m, d]) });
    assert.equal(respuesta.status, 500, ruta);
    assert.deepStrictEqual(respuesta.cuerpo, { error: "No se pudo enviar", lanzo: true }, ruta);
    assert.equal(anotado.length, 1, ruta);
    assert.ok(anotado[0][0].startsWith(`[chats/${ruta}]`), ruta);
    assert.equal(anotado[0][1].error, "se cayo el gateway", ruta);
  }
});

await prueba("sin sesion: 401 y ni se lee el cuerpo ni se llama a la accion", async () => {
  const { accion, llamadas } = accionFalsa();
  let leido = false;
  const respuesta = await procesarPedido({
    nombre: "enviar-archivo",
    sesionValida: false,
    accesoAChats: true,
    leerCuerpo: async () => {
      leido = true;
      return "{}";
    },
    accion,
  });
  assert.equal(respuesta.status, 401);
  assert.deepStrictEqual(respuesta.cuerpo, { error: "Tu sesión se cerró. Vuelve a entrar para enviar." });
  assert.equal(leido, false);
  assert.equal(llamadas.length, 0);
});

await prueba("sin el modulo chats: 403 y la accion no se llama", async () => {
  const { accion, llamadas } = accionFalsa();
  const respuesta = await procesarPedido({ nombre: "enviar-audio", sesionValida: true, accesoAChats: false, leerCuerpo: async () => "{}", accion });
  assert.equal(respuesta.status, 403);
  assert.deepStrictEqual(respuesta.cuerpo, { error: "No autorizado" });
  assert.equal(llamadas.length, 0);
});

await prueba("JSON roto, vacio o que no es un objeto: 400 Datos invalidos y la accion no se llama", async () => {
  for (const texto of ["", "{", "null", "[]", '"hola"', "42", "true"]) {
    const { accion, llamadas } = accionFalsa();
    const respuesta = await procesarPedido({ nombre: "enviar-flujo", sesionValida: true, accesoAChats: true, leerCuerpo: async () => texto, accion });
    assert.equal(respuesta.status, 400, JSON.stringify(texto));
    assert.deepStrictEqual(respuesta.cuerpo, { error: "Datos invalidos" });
    assert.equal(llamadas.length, 0);
  }
  const { accion, llamadas } = accionFalsa();
  const fallo = await procesarPedido({
    nombre: "enviar-flujo",
    sesionValida: true,
    accesoAChats: true,
    leerCuerpo: async () => {
      throw new Error("se corto");
    },
    accion,
  });
  assert.equal(fallo.status, 400);
  assert.equal(llamadas.length, 0);
});

await prueba("cuerpo de mas de 32 KB: 413 (por Content-Length y por el largo real) y la accion no se llama", async () => {
  assert.equal(LIMITE_BYTES_DEL_CUERPO, 32 * 1024);
  const { accion, llamadas } = accionFalsa();
  let leido = false;
  const porCabecera = await procesarPedido({
    nombre: "enviar-archivo",
    sesionValida: true,
    accesoAChats: true,
    largoDeclarado: String(LIMITE_BYTES_DEL_CUERPO + 1),
    leerCuerpo: async () => {
      leido = true;
      return "{}";
    },
    accion,
  });
  assert.equal(porCabecera.status, 413);
  assert.deepStrictEqual(porCabecera.cuerpo, { error: "Datos invalidos" });
  assert.equal(leido, false);

  // Sin cabecera (o mintiendo): cuenta bytes, no letras. "ñ" son 2 bytes.
  const grande = JSON.stringify({ caption: "ñ".repeat(LIMITE_BYTES_DEL_CUERPO / 2) });
  const porLargo = await procesarPedido({ nombre: "enviar-archivo", sesionValida: true, accesoAChats: true, largoDeclarado: "10", leerCuerpo: async () => grande, accion });
  assert.equal(porLargo.status, 413);
  assert.equal(llamadas.length, 0);

  const justo = JSON.stringify({ caption: "a".repeat(LIMITE_BYTES_DEL_CUERPO - 14) });
  assert.equal(Buffer.byteLength(justo), LIMITE_BYTES_DEL_CUERPO);
  const alLimite = await procesarPedido({ nombre: "enviar-archivo", sesionValida: true, accesoAChats: true, leerCuerpo: async () => justo, accion });
  assert.equal(alLimite.status, 200);
  assert.equal(llamadas.length, 1);
});

// --- Candados ---

const ACCION_DE_CADA_RUTA = {
  "enviar-archivo": ["sendChatMediaReplyAction", "@/app/actions/agent-actions"],
  "enviar-audio": ["sendChatAudioReplyAction", "@/app/actions/agent-actions"],
  "enviar-ubicacion": ["sendChatLocationReplyAction", "@/app/actions/agent-actions"],
  "enviar-flujo": ["sendFlowToChatAction", "@/app/actions/flow-send-actions"],
  reaccionar: ["reaccionarAlMensajeAction", "@/app/actions/chats-actions"],
  fijar: ["fijarMensajeAction", "@/app/actions/mensaje-fijado-actions"],
};
const PROHIBIDO = /prisma|evolution|waha|official-api|gateway/i;

function importsDe(texto) {
  return [...texto.matchAll(/(?:^|\n)\s*import[\s\S]*?from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)|require\(\s*["']([^"']+)["']\s*\)/g)].map(
    (m) => m[1] ?? m[2] ?? m[3],
  );
}

await prueba("candado de no duplicar: cada route.ts llama a SU accion y no importa Prisma ni gateways", () => {
  assert.deepStrictEqual(Object.keys(ACCION_DE_CADA_RUTA).sort(), [...RUTAS].sort());
  for (const [ruta, [accion, modulo]] of Object.entries(ACCION_DE_CADA_RUTA)) {
    const texto = fs.readFileSync(path.resolve(`src/app/api/cliente/chats/${ruta}/route.ts`), "utf8");
    assert.match(texto, new RegExp(`import\\s*\\{\\s*${accion}\\s*\\}\\s*from\\s*"${modulo}"`), `${ruta} no importa ${accion} de ${modulo}`);
    assert.match(texto, new RegExp(`atenderRutaDeEnvio\\(request,\\s*"${ruta}",\\s*${accion}\\)`), `${ruta} no pasa ${accion} tal cual`);
    for (const importado of importsDe(texto)) {
      assert.doesNotMatch(importado, PROHIBIDO, `${ruta}/route.ts importa ${importado}`);
    }
  }
  for (const archivo of ["src/lib/chats/ruta-de-envio.ts", "src/lib/chats/atender-ruta-de-envio.ts"]) {
    for (const importado of importsDe(fs.readFileSync(path.resolve(archivo), "utf8"))) {
      assert.doesNotMatch(importado, PROHIBIDO, `${archivo} importa ${importado}`);
      assert.doesNotMatch(importado, /@\/app\/actions/, `${archivo} no deberia importar acciones`);
    }
  }
});

await prueba("que no se manda nada: las pruebas no importan Prisma, gateways ni acciones de verdad", () => {
  for (const archivo of ["scripts/check-rutas-de-envio.mjs", "scripts/check-contrato-envios.mjs"]) {
    for (const importado of importsDe(fs.readFileSync(path.resolve(archivo), "utf8"))) {
      assert.doesNotMatch(importado, PROHIBIDO, `${archivo} importa ${importado}`);
      assert.doesNotMatch(importado, /^@\/|actions/, `${archivo} importa ${importado}`);
    }
  }
});

console.log(`\n${pruebas} pruebas ok`);
