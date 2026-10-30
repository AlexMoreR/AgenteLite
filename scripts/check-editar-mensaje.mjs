// Pruebas de editar mensajes ya enviados (src/lib/editar-mensaje.ts y editarMensajeWaha).
// Correr: npm run test:editar-mensaje
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);

function cargar(ruta) {
  const sourcePath = path.resolve(ruta);
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
  return mod.exports;
}

const { puedeEditarseMensaje } = cargar("src/lib/editar-mensaje.ts");
const { editarMensajeWaha } = cargar("src/lib/waha.ts");

let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const ahora = new Date("2026-10-30T15:00:00Z");
const haceMin = (m) => new Date(ahora.getTime() - m * 60_000);
const base = {
  direction: "OUTBOUND",
  type: "TEXT",
  externalId: "true_573001112233@c.us_3EB0ABCDEF123456",
  createdAt: haceMin(2),
  rawPayload: { source: "manual", enviadoPorUserId: "user_1" },
};

await prueba("un texto de la asesora de hace 2 minutos se puede editar", () => {
  assert.equal(puedeEditarseMensaje(base, ahora), true);
});
await prueba("uno de 16 minutos se rechaza", () => {
  assert.equal(puedeEditarseMensaje({ ...base, createdAt: haceMin(16) }, ahora), false);
  assert.equal(puedeEditarseMensaje({ ...base, createdAt: haceMin(15) }, ahora), false);
  assert.equal(puedeEditarseMensaje({ ...base, createdAt: haceMin(14) }, ahora), true);
});
await prueba("audio y otros tipos se rechazan", () => {
  for (const type of ["AUDIO", "IMAGE", "DOCUMENT", "LOCATION"]) {
    assert.equal(puedeEditarseMensaje({ ...base, type }, ahora), false);
  }
});
await prueba("los del bot, reactivaciones y reglas automaticas se rechazan", () => {
  assert.equal(puedeEditarseMensaje({ ...base, rawPayload: { source: "agent" } }, ahora), false);
  assert.equal(puedeEditarseMensaje({ ...base, rawPayload: { source: "automation_reactivation" } }, ahora), false);
  assert.equal(puedeEditarseMensaje({ ...base, rawPayload: { source: "manual" } }, ahora), false);
  assert.equal(puedeEditarseMensaje({ ...base, rawPayload: null }, ahora), false);
});
await prueba("entrantes, eliminados y sin id real se rechazan", () => {
  assert.equal(puedeEditarseMensaje({ ...base, direction: "INBOUND" }, ahora), false);
  assert.equal(puedeEditarseMensaje({ ...base, deletedAt: haceMin(1) }, ahora), false);
  assert.equal(puedeEditarseMensaje({ ...base, externalId: "a".repeat(64) }, ahora), false);
  assert.equal(puedeEditarseMensaje({ ...base, externalId: null }, ahora), false);
});

await prueba("la llamada a WAHA arma bien la ruta y el cuerpo", async () => {
  const llamadas = [];
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    llamadas.push({ url, init });
    return new Response("", { status: 200 });
  };
  try {
    await editarMensajeWaha({
      connection: { baseUrl: "https://waha.test/", apiToken: "clave" },
      sesion: "ventas1",
      chatId: "573001112233@c.us",
      mensajeId: "true_573001112233@c.us_3EB0ABCDEF123456",
      texto: "Hola corregido",
    });
  } finally {
    globalThis.fetch = fetchOriginal;
  }
  assert.equal(llamadas.length, 1);
  assert.equal(
    llamadas[0].url,
    "https://waha.test/api/ventas1/chats/573001112233%40c.us/messages/true_573001112233%40c.us_3EB0ABCDEF123456",
  );
  assert.equal(llamadas[0].init.method, "PUT");
  assert.deepEqual(JSON.parse(llamadas[0].init.body), { text: "Hola corregido" });
});

await prueba("un error de WAHA se propaga (la accion no guarda nada)", async () => {
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = async () => new Response("no soportado", { status: 501 });
  try {
    await assert.rejects(
      editarMensajeWaha({
        connection: { baseUrl: "https://waha.test", apiToken: "clave" },
        sesion: "ventas1",
        chatId: "573001112233@c.us",
        mensajeId: "true_x_ABCDEFGH",
        texto: "x",
      }),
    );
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});

await prueba("la accion guarda solo despues de que WAHA confirma, y el eco del webhook no escribe", () => {
  const accion = fs.readFileSync("src/app/actions/chats-actions.ts", "utf8");
  const cuerpo = accion.slice(accion.indexOf("export async function editChatMessageAction"));
  assert.ok(cuerpo.indexOf("await editEvolutionMessage(") < cuerpo.indexOf("prisma.message.update("));
  assert.ok(cuerpo.indexOf("estaEnModoMonitoreo") < cuerpo.indexOf("await editEvolutionMessage("));
  const webhook = fs.readFileSync("src/app/api/webhooks/waha/route.ts", "utf8");
  assert.ok(webhook.includes("cambio.texto === mensaje.content"));
});

console.log(`\n${pruebas} pruebas ok`);
