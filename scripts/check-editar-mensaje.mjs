// Pruebas de editar mensajes enviados (src/lib/editar-mensaje.ts y editarMensajeWaha).
// Correr: npm run test:editar-mensaje
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);
function cargar(ruta, requireLocal = require) {
  const sourcePath = path.resolve(ruta);
  const transpiled = ts.transpileModule(fs.readFileSync(sourcePath, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: sourcePath,
  });
  const mod = { exports: {} };
  new Function("exports", "require", "module", "__filename", "__dirname", transpiled.outputText)(
    mod.exports, requireLocal, mod, sourcePath, path.dirname(sourcePath),
  );
  return mod.exports;
}

const { puedeEditarseMensaje, MINUTOS_PARA_EDITAR } = cargar("src/lib/editar-mensaje.ts");

let pruebas = 0;
function prueba(nombre, fn) {
  fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const ahora = new Date("2026-10-27T15:00:00Z");
const haceMin = (m) => new Date(ahora.getTime() - m * 60_000);
const base = {
  direction: "OUTBOUND",
  type: "TEXT",
  externalId: "true_573001112233@c.us_3EB0ABCDEF123456",
  agentId: null,
  deletedAt: null,
  rawPayload: { id: "x" },
  enviadoEn: haceMin(2),
};

prueba("un texto propio de hace 2 minutos se puede editar", () => {
  assert.equal(MINUTOS_PARA_EDITAR, 15);
  assert.equal(puedeEditarseMensaje(base, ahora), true);
});

prueba("a los 16 minutos se rechaza; a los 14 pasa", () => {
  assert.equal(puedeEditarseMensaje({ ...base, enviadoEn: haceMin(16) }, ahora), false);
  assert.equal(puedeEditarseMensaje({ ...base, enviadoEn: haceMin(14) }, ahora), true);
});

prueba("audio, imagen y mensajes entrantes se rechazan", () => {
  assert.equal(puedeEditarseMensaje({ ...base, type: "AUDIO" }, ahora), false);
  assert.equal(puedeEditarseMensaje({ ...base, type: "IMAGE" }, ahora), false);
  assert.equal(puedeEditarseMensaje({ ...base, direction: "INBOUND" }, ahora), false);
});

prueba("los del bot y los automaticos se rechazan", () => {
  assert.equal(puedeEditarseMensaje({ ...base, agentId: "agente1" }, ahora), false);
  for (const source of ["follow", "automation", "automation_reactivation", "agent", "activity", "agente-v3-seguimiento"]) {
    assert.equal(puedeEditarseMensaje({ ...base, rawPayload: { source } }, ahora), false, source);
  }
});

prueba("sin id real de WhatsApp, o eliminado, se rechaza", () => {
  assert.equal(puedeEditarseMensaje({ ...base, externalId: null }, ahora), false);
  assert.equal(puedeEditarseMensaje({ ...base, externalId: "a".repeat(64) }, ahora), false);
  assert.equal(puedeEditarseMensaje({ ...base, deletedAt: haceMin(1) }, ahora), false);
  assert.equal(puedeEditarseMensaje({ ...base, enviadoEn: null }, ahora), false);
});

// La llamada a WAHA: se carga waha.ts con fetch falso y se mira ruta, metodo y cuerpo.
const waha = cargar("src/lib/waha.ts", (id) => {
  if (id.startsWith("@/") || id.startsWith(".")) return new Proxy({}, { get: () => () => undefined });
  return require(id);
});

const llamadas = [];
const fetchOriginal = globalThis.fetch;
let respuesta = { ok: true, status: 200, texto: "" };
globalThis.fetch = async (url, init) => {
  llamadas.push({ url: String(url), init });
  return { ok: respuesta.ok, status: respuesta.status, text: async () => respuesta.texto };
};
const entrada = {
  connection: { baseUrl: "https://waha.test/", apiToken: "t" },
  sesion: "ventas 1",
  chatId: "573001112233@c.us",
  mensajeId: "true_573001112233@c.us_3EB0ABC",
  texto: "Hola, corregido",
};

await waha.editarMensajeWaha(entrada);
prueba("editarMensajeWaha arma ruta PUT y cuerpo con el texto", () => {
  assert.equal(llamadas.length, 1);
  assert.equal(
    llamadas[0].url,
    `https://waha.test/api/ventas%201/chats/573001112233%40c.us/messages/${encodeURIComponent(entrada.mensajeId)}`,
  );
  assert.equal(llamadas[0].init.method, "PUT");
  assert.deepEqual(JSON.parse(llamadas[0].init.body), { text: "Hola, corregido" });
});

respuesta = { ok: false, status: 422, texto: "no soportado" };
let fallo = null;
try { await waha.editarMensajeWaha(entrada); } catch (e) { fallo = e; }
prueba("un error de WAHA no se traga (la accion no guarda nada)", () => {
  assert.ok(fallo, "debia lanzar el error");
});
globalThis.fetch = fetchOriginal;

// La accion del servidor solo escribe en la base DESPUES de que editEvolutionMessage no falle.
const accion = fs.readFileSync("src/app/actions/chats-actions.ts", "utf8");
prueba("la accion edita en WhatsApp antes de guardar en la base", () => {
  const cuerpo = accion.slice(accion.indexOf("export async function editChatMessageAction"));
  const iEdita = cuerpo.indexOf("await editEvolutionMessage(");
  const iCatch = cuerpo.indexOf("catch", iEdita);
  const iGuarda = cuerpo.indexOf("prisma.message.update");
  const iRetorno = cuerpo.indexOf("return { ok: false", iCatch);
  assert.ok(iEdita > 0 && iEdita < iCatch && iCatch < iRetorno && iRetorno < iGuarda);
  assert.ok(cuerpo.includes("estaEnModoMonitoreo"));
});

// El eco del webhook: con el mismo texto no escribe nada.
const webhook = fs.readFileSync("src/app/api/webhooks/waha/route.ts", "utf8");
prueba("el eco del webhook con el mismo texto no escribe", () => {
  assert.ok(webhook.includes("cambio.texto === mensaje.content"));
});

console.log(`${pruebas} pruebas ok`);
