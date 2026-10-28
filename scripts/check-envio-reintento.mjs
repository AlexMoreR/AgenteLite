// Pruebas de src/lib/chat-envio-reintento.ts (envio de texto de Chats: reintento sin duplicar).
// Correr: npm run test:envio-reintento
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);
const sourcePath = path.resolve("src/lib/chat-envio-reintento.ts");
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
const {
  ESPERAS_DE_REINTENTO_MS,
  clasificarFalloDeEnvio,
  enviarConReintento,
  enviarTextoPorRuta,
  guardarFallidos,
  idDeEnvioValido,
  leerFallidosGuardados,
  nuevoIdDeEnvio,
  soltarCandadoDeEnvio,
  tomarCandadoDeEnvio,
  vaciarFallosSinServidor,
  registrarFalloSinServidor,
} = mod.exports;

let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const esperasVistas = [];
const esperar = async (ms) => {
  esperasVistas.push(ms);
};

function formulario(extra = {}) {
  const datos = new FormData();
  datos.set("source", "agent");
  datos.set("conversationId", "conv1");
  datos.set("message", "Hola");
  for (const [k, v] of Object.entries(extra)) datos.set(k, v);
  return datos;
}

/** Servidor falso: "WhatsApp" recibe cada numero unico UNA sola vez, igual que la ruta real. */
function servidorFalso(comportamiento) {
  const estado = { llamadas: [], whatsapp: [] };
  const fetchFn = async (entrada, init) => {
    const datos = init.body;
    const id = datos.get("clientMessageId");
    estado.llamadas.push({ entrada, id, intento: datos.get("intento") });
    const accion = comportamiento(estado.llamadas.length, estado);
    if (accion === "red") throw new TypeError("Failed to fetch");
    if (accion === "abortar") throw Object.assign(new Error("aborted"), { name: "TimeoutError" });
    if (accion === "502") return new Response("<html>Bad Gateway</html>", { status: 502 });
    if (accion === "rechazo") {
      return Response.json({ ok: false, error: "No se pudo enviar el mensaje: connection closed" });
    }
    if (accion === "timeout-gateway") {
      return Response.json({ ok: false, error: "WhatsApp no respondio a tiempo (25s). Volve a intentar en un minuto." });
    }
    // ok: ya enviado si el numero ya estaba
    if (estado.whatsapp.includes(id)) return Response.json({ ok: true, yaEnviado: true, suppressOptimistic: true });
    estado.whatsapp.push(id);
    return Response.json({ ok: true });
  };
  return { estado, fetchFn };
}

await prueba("clasifica: version vieja y sin red se reintentan", () => {
  assert.deepEqual(clasificarFalloDeEnvio({ error: 'Error: Failed to find Server Action "abc"' }), { motivo: "version_vieja", reintentable: true });
  assert.deepEqual(clasificarFalloDeEnvio({ sinRed: true }), { motivo: "sin_red", reintentable: true });
  assert.equal(clasificarFalloDeEnvio({ status: 502 }).reintentable, true);
  assert.equal(clasificarFalloDeEnvio({ status: 404 }).motivo, "version_vieja");
});

await prueba("clasifica: conexion cerrada y rechazo del gateway se reintentan", () => {
  assert.deepEqual(clasificarFalloDeEnvio({ error: "No se pudo enviar el mensaje: connection closed" }), { motivo: "conexion_cerrada", reintentable: true });
  assert.deepEqual(clasificarFalloDeEnvio({ error: "No se pudo enviar el mensaje: numero invalido" }), { motivo: "gateway_rechazo", reintentable: true });
});

await prueba("clasifica: tiempo agotado y errores de validacion NO se reintentan", () => {
  assert.deepEqual(clasificarFalloDeEnvio({ error: "WhatsApp no respondio a tiempo (25s)." }), { motivo: "timeout_gateway", reintentable: false });
  assert.equal(clasificarFalloDeEnvio({ error: "La API oficial no respondio a tiempo (timeout)." }).reintentable, false);
  assert.equal(clasificarFalloDeEnvio({ status: 504 }).reintentable, false);
  assert.equal(clasificarFalloDeEnvio({ status: 401 }).motivo, "sesion");
  assert.equal(clasificarFalloDeEnvio({ error: "No se pudo enviar el mensaje" }).reintentable, false);
  assert.equal(clasificarFalloDeEnvio({ error: "El chat abierto no coincide" }).reintentable, false);
  assert.equal(clasificarFalloDeEnvio({ error: "No autorizado" }).reintentable, false);
});

await prueba("caida del gateway: reintenta 2 veces (esperas 1,5 s y 4 s) y sale", async () => {
  esperasVistas.length = 0;
  let n = 0;
  const salida = await enviarConReintento({
    enviarUnaVez: async () => (++n < 3 ? { ok: false, reintentable: true } : { ok: true }),
    esperar,
  });
  assert.equal(salida.intentos, 3);
  assert.equal(salida.resultado.ok, true);
  assert.deepEqual(esperasVistas, [1500, 4000]);
  assert.deepEqual([...ESPERAS_DE_REINTENTO_MS], [1500, 4000]);
});

await prueba("nunca mas de 2 reintentos: a la tercera falla queda como fallido", async () => {
  let n = 0;
  const salida = await enviarConReintento({
    enviarUnaVez: async () => (n++, { ok: false, reintentable: true }),
    esperar,
  });
  assert.equal(n, 3);
  assert.equal(salida.resultado.ok, false);
});

await prueba("tiempo agotado: NO se reintenta solo (no se sabe si salio)", async () => {
  const { estado, fetchFn } = servidorFalso(() => "timeout-gateway");
  const salida = await enviarTextoPorRuta({ formData: formulario(), fetchFn, esperar });
  assert.equal(estado.llamadas.length, 1);
  assert.equal(salida.ok, false);
  assert.equal(salida.reintentable, false);
  assert.equal(salida.motivo, "timeout_gateway");
});

await prueba("caida del gateway: mismo numero unico en cada reintento y sale UNA sola vez", async () => {
  const { estado, fetchFn } = servidorFalso((n) => (n < 3 ? "rechazo" : "ok"));
  const salida = await enviarTextoPorRuta({ formData: formulario(), fetchFn, esperar });
  assert.equal(salida.ok, true);
  assert.equal(salida.intentos, 3);
  assert.equal(estado.llamadas.length, 3);
  const ids = new Set(estado.llamadas.map((l) => l.id));
  assert.equal(ids.size, 1);
  assert.ok(idDeEnvioValido([...ids][0]));
  assert.deepEqual(estado.llamadas.map((l) => l.intento), ["1", "2", "3"]);
  assert.equal(estado.whatsapp.length, 1);
});

await prueba("caida de la conexion del navegador: reintenta, anota el fallo y sale una vez", async () => {
  const vistos = [];
  const { estado, fetchFn } = servidorFalso((n) => (n < 3 ? "red" : "ok"));
  const salida = await enviarTextoPorRuta({
    formData: formulario(),
    fetchFn,
    esperar,
    alFallarSinServidor: (info) => vistos.push(info),
  });
  assert.equal(salida.ok, true);
  assert.equal(estado.whatsapp.length, 1);
  assert.equal(vistos.length, 2);
  assert.equal(vistos[0].motivo, "sin_red");
  assert.equal(vistos[0].conversationId, "conv1");
  assert.equal(vistos[0].clientMessageId, vistos[1].clientMessageId);
});

await prueba("502 del proxy (subida de version) se reintenta; si sigue, queda reintentable para el boton", async () => {
  const { estado, fetchFn } = servidorFalso(() => "502");
  const salida = await enviarTextoPorRuta({ formData: formulario(), fetchFn, esperar });
  assert.equal(estado.llamadas.length, 3);
  assert.equal(salida.ok, false);
  assert.equal(salida.reintentable, true);
});

await prueba("el navegador no espera mas de la cuenta: tiempo agotado local no se reintenta", async () => {
  const { estado, fetchFn } = servidorFalso(() => "abortar");
  const salida = await enviarTextoPorRuta({ formData: formulario(), fetchFn, esperar });
  assert.equal(estado.llamadas.length, 1);
  assert.equal(salida.motivo, "timeout_gateway");
  assert.equal(salida.reintentable, false);
});

await prueba("Reintentar con el mismo numero no duplica: el servidor contesta ya enviado", async () => {
  const { estado, fetchFn } = servidorFalso(() => "ok");
  const datos = formulario({ clientMessageId: "abc12345-0000" });
  const primera = await enviarTextoPorRuta({ formData: datos, fetchFn, esperar });
  const segunda = await enviarTextoPorRuta({ formData: datos, fetchFn, esperar });
  assert.equal(primera.ok, true);
  assert.equal(segunda.yaEnviado, true);
  assert.equal(estado.whatsapp.length, 1);
});

await prueba("numeros unicos distintos por mensaje y forma valida", () => {
  const a = nuevoIdDeEnvio();
  const b = nuevoIdDeEnvio();
  assert.notEqual(a, b);
  assert.ok(idDeEnvioValido(a));
  assert.equal(idDeEnvioValido("x"), null);
  assert.equal(idDeEnvioValido("con espacios y ' comillas"), null);
  assert.equal(idDeEnvioValido(null), null);
});

await prueba("candado: el mismo envio no corre dos veces a la vez", () => {
  assert.equal(tomarCandadoDeEnvio("u1:m1", 1000), true);
  assert.equal(tomarCandadoDeEnvio("u1:m1", 1001), false);
  assert.equal(tomarCandadoDeEnvio("u1:m2", 1001), true);
  soltarCandadoDeEnvio("u1:m1");
  assert.equal(tomarCandadoDeEnvio("u1:m1", 1002), true);
  // Un candado olvidado se vence solo.
  assert.equal(tomarCandadoDeEnvio("u1:m1", 1002 + 91_000), true);
});

function almacenFalso() {
  const datos = new Map();
  return {
    getItem: (k) => datos.get(k) ?? null,
    setItem: (k, v) => void datos.set(k, v),
    removeItem: (k) => void datos.delete(k),
  };
}
const fallido = (id, extra = {}) => ({
  id,
  conversationId: "conv1",
  chatKey: "agent:conv1",
  campos: [["message", "Hola"], ["clientMessageId", "abc12345-0000"]],
  texto: "Hola",
  contenido: "Hola",
  creadoEn: Date.now(),
  error: "No se pudo enviar el mensaje",
  ...extra,
});

await prueba("el mensaje fallido se guarda y se lee del navegador sin perder el texto ni el numero", () => {
  const almacen = almacenFalso();
  guardarFallidos(almacen, [fallido("a"), fallido("b", { texto: "Segundo", contenido: "Segundo" })]);
  const leidos = leerFallidosGuardados(almacen);
  assert.equal(leidos.length, 2);
  assert.equal(leidos[0].texto, "Hola");
  assert.deepEqual(leidos[0].campos[1], ["clientMessageId", "abc12345-0000"]);
  guardarFallidos(almacen, []);
  assert.deepEqual(leerFallidosGuardados(almacen), []);
});

await prueba("fallidos: vencidos, rotos y sin almacenamiento no rompen nada", () => {
  const almacen = almacenFalso();
  guardarFallidos(almacen, [fallido("viejo", { creadoEn: Date.now() - 8 * 24 * 3600 * 1000 }), fallido("nuevo")]);
  assert.deepEqual(leerFallidosGuardados(almacen).map((f) => f.id), ["nuevo"]);
  almacen.setItem("agentelite:chat-envios-fallidos:v1", "{no es json");
  assert.deepEqual(leerFallidosGuardados(almacen), []);
  almacen.setItem("agentelite:chat-envios-fallidos:v1", JSON.stringify([{ id: 1 }, null, "x"]));
  assert.deepEqual(leerFallidosGuardados(almacen), []);
  assert.deepEqual(leerFallidosGuardados(null), []);
  const roto = { getItem: () => { throw new Error("bloqueado"); }, setItem: () => { throw new Error("lleno"); }, removeItem: () => { throw new Error("x"); } };
  assert.deepEqual(leerFallidosGuardados(roto), []);
  guardarFallidos(roto, [fallido("a")]);
  guardarFallidos(null, [fallido("a")]);
});

await prueba("los fallos que el servidor no vio se anotan al volver la conexion", async () => {
  const entregados = [];
  let hayRed = false;
  const fetchFn = async (entrada, init) => {
    if (!hayRed) throw new TypeError("offline");
    entregados.push(JSON.parse(init.body));
    return Response.json({ ok: true });
  };
  registrarFalloSinServidor({ motivo: "sin_red", detalle: "x", intento: 1, conversationId: "c", source: "agent", clientMessageId: null }, fetchFn);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(entregados.length, 0);
  hayRed = true;
  await vaciarFallosSinServidor(fetchFn);
  assert.equal(entregados.length, 1);
  assert.equal(entregados[0].motivo, "sin_red");
  await vaciarFallosSinServidor(fetchFn);
  assert.equal(entregados.length, 1);
});

console.log(`\n${pruebas} pruebas OK`);
