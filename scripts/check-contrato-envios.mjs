// Contrato de las rutas fijas de envio del chat (src/lib/chats/ruta-de-envio.ts).
// Si alguien quita o renombra una ruta o un campo, o borra un payload congelado, esto falla.
// Correr: node scripts/check-contrato-envios.mjs
// No manda nada: no importa Prisma ni gateways, solo lee archivos y usa acciones falsas.
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
const { RUTAS_DE_ENVIO, elegirCampos, procesarPedido } = mod.exports;

const congelados = JSON.parse(fs.readFileSync(path.resolve("src/lib/chats/contrato-envios.congelados.json"), "utf8"));

// Escrito aca a proposito (no se lee del JSON ni del codigo): borrar algo de alla no la hace pasar.
const CAMPOS_CONGELADOS = {
  "enviar-archivo": ["source", "conversationId", "agentId", "mediaUrl", "mediaType", "fileName", "mimeType", "caption", "returnTo"],
  "enviar-audio": ["source", "conversationId", "agentId", "audioUrl", "returnTo"],
  "enviar-ubicacion": ["conversationId", "agentId", "returnTo"],
  "enviar-flujo": ["source", "conversationId", "flowId", "agentId"],
  reaccionar: ["messageId", "emoji"],
};
const PEDIDOS_CONGELADOS = [
  "enviar-archivo/un-archivo",
  "enviar-archivo/reintentar-sin-texto-agente-vacio",
  "enviar-archivo/biblioteca",
  "enviar-archivo/carta-de-colores",
  "enviar-archivo/reenviar-foto",
  "enviar-archivo/reenviar-documento",
  "enviar-audio/nota-de-voz",
  "enviar-audio/reenviar",
  "enviar-ubicacion/local",
  "enviar-ubicacion/sin-agente-ni-regreso",
  "enviar-flujo/mandar",
  "enviar-flujo/sin-agente",
  "reaccionar/poner",
  "reaccionar/quitar",
];
const RESPUESTAS_CONGELADAS = [
  "enviar-archivo/ok",
  "enviar-archivo/error",
  "enviar-audio/ok",
  "enviar-audio/error",
  "enviar-ubicacion/ok",
  "enviar-ubicacion/error",
  "enviar-flujo/ok",
  "enviar-flujo/error",
  "reaccionar/ok",
  "reaccionar/error",
];

let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

function pedidoValido(nombre, texto, accion) {
  return procesarPedido({ nombre, sesionValida: true, accesoAChats: true, leerCuerpo: async () => texto, accion });
}

await prueba("el archivo congelado conserva todas sus entradas (solo se agrega)", () => {
  for (const clave of PEDIDOS_CONGELADOS) assert.ok(congelados.pedidos[clave], `falta el pedido congelado ${clave}`);
  for (const clave of RESPUESTAS_CONGELADAS) assert.ok(congelados.respuestas[clave], `falta la respuesta congelada ${clave}`);
});

await prueba("cada ruta congelada existe en RUTAS_DE_ENVIO y tiene su route.ts con POST", () => {
  const rutas = new Set([...Object.keys(CAMPOS_CONGELADOS), ...Object.values(congelados.pedidos).map((p) => p.ruta)]);
  for (const ruta of rutas) {
    assert.ok(Object.prototype.hasOwnProperty.call(RUTAS_DE_ENVIO, ruta), `la ruta ${ruta} ya no esta en RUTAS_DE_ENVIO`);
    const archivo = path.resolve(`src/app/api/cliente/chats/${ruta}/route.ts`);
    assert.ok(fs.existsSync(archivo), `falta ${archivo}`);
    const texto = fs.readFileSync(archivo, "utf8");
    assert.match(texto, /export\s+(async\s+)?function\s+POST\b|export\s+const\s+POST\b/, `${ruta}/route.ts no exporta POST`);
    assert.ok(texto.includes(`"${ruta}"`), `${ruta}/route.ts no atiende con el nombre "${ruta}"`);
  }
});

await prueba("los CAMPOS de hoy contienen todos los congelados (agregar si, quitar o renombrar no)", () => {
  for (const [ruta, campos] of Object.entries(CAMPOS_CONGELADOS)) {
    for (const campo of campos) assert.ok(RUTAS_DE_ENVIO[ruta].includes(campo), `la ruta ${ruta} perdio el campo ${campo}`);
  }
  for (const [clave, pedido] of Object.entries(congelados.pedidos)) {
    for (const campo of Object.keys(pedido.cuerpo)) {
      assert.ok(RUTAS_DE_ENVIO[pedido.ruta].includes(campo), `${clave}: la ruta ${pedido.ruta} no acepta ${campo}`);
    }
  }
});

await prueba("elegirCampos devuelve exactamente cada payload congelado", () => {
  for (const [clave, pedido] of Object.entries(congelados.pedidos)) {
    assert.deepStrictEqual(elegirCampos(pedido.cuerpo, RUTAS_DE_ENVIO[pedido.ruta]), pedido.cuerpo, clave);
  }
});

await prueba("un payload congelado con campos desconocidos se acepta igual (cliente mas nuevo)", async () => {
  for (const [clave, pedido] of Object.entries(congelados.pedidos)) {
    let recibido = null;
    const extra = { ...pedido.cuerpo, chatEsperado: "x", campoDelFuturo: { a: 1 } };
    const respuesta = await pedidoValido(pedido.ruta, JSON.stringify(extra), async (entrada) => {
      recibido = entrada;
      return { ok: true };
    });
    assert.equal(respuesta.status, 200, clave);
    assert.deepStrictEqual(recibido, pedido.cuerpo, clave);
  }
});

await prueba("las respuestas congeladas salen tal cual, aunque traigan campos de mas", async () => {
  for (const [clave, congelada] of Object.entries(congelados.respuestas)) {
    const pedido = Object.values(congelados.pedidos).find((p) => p.ruta === congelada.ruta);
    const texto = JSON.stringify(pedido.cuerpo);
    const tal = await pedidoValido(congelada.ruta, texto, async () => congelada.cuerpo);
    assert.equal(tal.status, 200, clave);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(tal.cuerpo)), congelada.cuerpo, clave);
    const conMas = { ...congelada.cuerpo, campoNuevo: 1 };
    const mas = await pedidoValido(congelada.ruta, texto, async () => conMas);
    assert.deepStrictEqual(mas.cuerpo, conMas, clave);
  }
});

console.log(`\n${pruebas} pruebas ok`);
