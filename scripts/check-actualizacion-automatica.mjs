// Pruebas de src/lib/actualizacion-automatica.ts (la app se actualiza sola, tarjeta maqn9g47).
// Correr: npm run test:actualizacion-automatica
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);

function cargar(relativo) {
  const sourcePath = path.resolve(relativo);
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

const A = cargar("src/lib/actualizacion-automatica.ts");

function almacenFalso() {
  const datos = new Map();
  return {
    getItem: (k) => (datos.has(k) ? datos.get(k) : null),
    setItem: (k, v) => void datos.set(k, String(v)),
    removeItem: (k) => void datos.delete(k),
  };
}

let pruebas = 0;
function prueba(nombre, fn) {
  fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const T0 = 1_000_000_000;

prueba("ocupada: escribio hace menos de 5 segundos", () => {
  A.marcarEscritura(T0);
  assert.equal(A.estaOcupada(T0 + 4_000), true);
  assert.equal(A.estaOcupada(T0 + 5_000), false);
});

prueba("ocupada: envio en camino, grabando o subiendo; quieta cuando se apagan", () => {
  for (const motivo of ["texto", "grabando", "subiendo"]) {
    A.marcarOcupada(motivo, true);
    assert.equal(A.estaOcupada(T0 + 60_000), true, motivo);
    A.marcarOcupada(motivo, false);
    assert.equal(A.estaOcupada(T0 + 60_000), false, motivo);
  }
});

prueba("ocupada: se puede ignorar la ventana de adjuntar al abrirla", () => {
  A.marcarOcupada("adjuntar", true);
  assert.equal(A.estaOcupada(T0 + 60_000), true);
  assert.equal(A.estaOcupada(T0 + 60_000, ["adjuntar"]), false);
  A.marcarOcupada("adjuntar", false);
});

prueba("recarga cuando esta quieta y es la primera vez", () => {
  const r = A.decidirRecarga({ ahora: T0, ocupada: false, recargas: { ultima: 0, intentos: 0 } });
  assert.equal(r, "recargar");
});

prueba("no recarga si esta ocupada", () => {
  const r = A.decidirRecarga({ ahora: T0, ocupada: true, recargas: { ultima: 0, intentos: 0 } });
  assert.equal(r, "esperar");
});

prueba("tope de una recarga por minuto", () => {
  const recargas = { ultima: T0, intentos: 1 };
  assert.equal(A.decidirRecarga({ ahora: T0 + 30_000, ocupada: false, recargas }), "esperar");
  assert.equal(A.decidirRecarga({ ahora: T0 + 60_000, ocupada: false, recargas }), "recargar");
});

prueba("la pastilla aparece despues de 2 intentos", () => {
  const recargas = { ultima: T0, intentos: 2 };
  assert.equal(A.decidirRecarga({ ahora: T0 + 10_000, ocupada: false, recargas }), "pastilla");
  assert.equal(A.decidirRecarga({ ahora: T0 + 999_000, ocupada: true, recargas }), "pastilla");
});

prueba("registrar recargas suma intentos y olvidar los borra", () => {
  const almacen = almacenFalso();
  assert.deepEqual(A.leerRecargas(almacen), { ultima: 0, intentos: 0 });
  A.registrarRecarga(T0, almacen);
  A.registrarRecarga(T0 + 70_000, almacen);
  assert.deepEqual(A.leerRecargas(almacen), { ultima: T0 + 70_000, intentos: 2 });
  A.olvidarRecargas(almacen);
  assert.deepEqual(A.leerRecargas(almacen), { ultima: 0, intentos: 0 });
});

prueba("borrador: se guarda y se lee por chat, y se borra", () => {
  const almacen = almacenFalso();
  A.guardarBorrador("agent:c1", "hola, el precio es", almacen);
  A.guardarBorrador("agent:c2", "otro chat", almacen);
  assert.equal(A.leerBorrador("agent:c1", almacen), "hola, el precio es");
  assert.equal(A.leerBorrador("agent:c2", almacen), "otro chat");
  assert.equal(A.leerBorrador("agent:c3", almacen), "");
  A.borrarBorrador("agent:c1", almacen);
  assert.equal(A.leerBorrador("agent:c1", almacen), "");
  assert.equal(A.leerBorrador("agent:c2", almacen), "otro chat");
});

prueba("borrador: guardar texto vacio lo quita", () => {
  const almacen = almacenFalso();
  A.guardarBorrador("agent:c1", "algo", almacen);
  A.guardarBorrador("agent:c1", "   ", almacen);
  assert.equal(A.leerBorrador("agent:c1", almacen), "");
});

prueba("borrador: sin almacenamiento no revienta", () => {
  assert.equal(A.leerBorrador("agent:c1", null), "");
  A.guardarBorrador("agent:c1", "x", null);
  const roto = {
    getItem: () => { throw new Error("bloqueado"); },
    setItem: () => { throw new Error("bloqueado"); },
    removeItem: () => { throw new Error("bloqueado"); },
  };
  assert.equal(A.leerBorrador("agent:c1", roto), "");
  A.guardarBorrador("agent:c1", "x", roto);
  assert.equal(A.tomarEnvioPendiente(roto), null);
});

const pendiente = {
  chatKey: "agent:c1",
  conversationId: "c1",
  campos: [["message", "hola"], ["conversationId", "c1"]],
  texto: "hola",
  contenido: "*Asesora:* hola",
  creadoEn: T0,
};

prueba("pendiente: se toma una sola vez (la marca se borra al leerlo)", () => {
  const almacen = almacenFalso();
  A.guardarEnvioPendiente(pendiente, almacen);
  assert.deepEqual(A.tomarEnvioPendiente(almacen), pendiente);
  assert.equal(A.tomarEnvioPendiente(almacen), null);
});

prueba("pendiente: dato roto se descarta", () => {
  const almacen = almacenFalso();
  almacen.setItem("aizen:envio-pendiente", "{no es json");
  assert.equal(A.tomarEnvioPendiente(almacen), null);
  almacen.setItem("aizen:envio-pendiente", JSON.stringify({ chatKey: "x" }));
  assert.equal(A.tomarEnvioPendiente(almacen), null);
  assert.equal(almacen.getItem("aizen:envio-pendiente"), null);
});

prueba("pendiente: se reenvia si es del chat abierto, reciente y no esta guardado", () => {
  assert.equal(A.puedeReenviarPendiente({ pendiente, chatAbiertoId: "c1", ahora: T0 + 20_000, yaGuardado: false }), true);
});

prueba("pendiente: no se reenvia si ya esta guardado en el chat", () => {
  assert.equal(A.puedeReenviarPendiente({ pendiente, chatAbiertoId: "c1", ahora: T0 + 20_000, yaGuardado: true }), false);
});

prueba("pendiente: no se reenvia con mas de 2 minutos", () => {
  assert.equal(A.puedeReenviarPendiente({ pendiente, chatAbiertoId: "c1", ahora: T0 + 120_001, yaGuardado: false }), false);
  assert.equal(A.puedeReenviarPendiente({ pendiente, chatAbiertoId: "c1", ahora: T0 + 120_000, yaGuardado: false }), true);
});

prueba("pendiente: no se reenvia a otro chat ni con hora en el futuro ni vacio", () => {
  assert.equal(A.puedeReenviarPendiente({ pendiente, chatAbiertoId: "c2", ahora: T0 + 1_000, yaGuardado: false }), false);
  assert.equal(A.puedeReenviarPendiente({ pendiente, chatAbiertoId: "c1", ahora: T0 - 5_000, yaGuardado: false }), false);
  assert.equal(A.puedeReenviarPendiente({ pendiente: { ...pendiente, texto: "  " }, chatAbiertoId: "c1", ahora: T0 + 1_000, yaGuardado: false }), false);
});


// ---- Revision de version antes de enviar y envio salvo version vieja ----

async function pruebaAsync(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const sinGuardar = () => {};

await pruebaAsync("antes de enviar: usa la revision de hace menos de 15 s sin preguntar", async () => {
  let preguntas = 0;
  const vieja = await A.hayVersionNuevaAntesDeEnviar({
    ahora: T0 + 10_000,
    ultima: { vieja: true, en: T0 },
    consultar: async () => { preguntas += 1; return false; },
    guardar: sinGuardar,
  });
  assert.equal(vieja, true);
  assert.equal(preguntas, 0);
});

await pruebaAsync("antes de enviar: con revision vieja pregunta y guarda el resultado", async () => {
  let guardada = null;
  const vieja = await A.hayVersionNuevaAntesDeEnviar({
    ahora: T0 + 15_000,
    ultima: { vieja: false, en: T0 },
    consultar: async () => true,
    guardar: (r) => { guardada = r; },
  });
  assert.equal(vieja, true);
  assert.deepEqual(guardada, { vieja: true, en: T0 + 15_000 });
});

await pruebaAsync("antes de enviar: si /api/version falla o tarda mas de 1,5 s, responde false", async () => {
  const falla = await A.hayVersionNuevaAntesDeEnviar({
    ahora: T0, ultima: null, consultar: async () => { throw new Error("sin red"); }, guardar: sinGuardar,
  });
  assert.equal(falla, false);
  const inicio = Date.now();
  const tarda = await A.hayVersionNuevaAntesDeEnviar({
    ahora: T0, ultima: null, consultar: () => new Promise(() => {}), guardar: sinGuardar,
  });
  assert.equal(tarda, false);
  assert.ok(Date.now() - inicio < 3_000);
});

await pruebaAsync("con version nueva: guarda el pendiente y NO envia", async () => {
  let enviados = 0;
  let pendientes = 0;
  const r = await A.enviarSalvoVersionVieja({
    hayVersionNueva: async () => true,
    enviar: async () => { enviados += 1; return { ok: true }; },
    dejarPendiente: () => { pendientes += 1; },
  });
  assert.equal(r.enviado, false);
  assert.equal(enviados, 0);
  assert.equal(pendientes, 1);
});

await pruebaAsync("con la misma version: envia y no deja pendiente", async () => {
  let pendientes = 0;
  const r = await A.enviarSalvoVersionVieja({
    hayVersionNueva: async () => false,
    enviar: async () => ({ ok: true }),
    dejarPendiente: () => { pendientes += 1; },
  });
  assert.deepEqual(r, { enviado: true, resultado: { ok: true } });
  assert.equal(pendientes, 0);
});

await pruebaAsync("si /api/version no contesta, envia normal", async () => {
  let enviados = 0;
  const r = await A.enviarSalvoVersionVieja({
    hayVersionNueva: () => A.hayVersionNuevaAntesDeEnviar({
      ahora: T0, ultima: null, consultar: async () => { throw new Error("caido"); }, guardar: sinGuardar,
    }),
    enviar: async () => { enviados += 1; return "ok"; },
    dejarPendiente: () => { throw new Error("no debia dejar pendiente"); },
  });
  assert.equal(r.enviado, true);
  assert.equal(enviados, 1);
});

prueba("el pendiente se usa una sola vez aunque se pida dos veces", () => {
  const almacen = almacenFalso();
  A.guardarEnvioPendiente(pendiente, almacen);
  assert.ok(A.tomarEnvioPendiente(almacen));
  assert.equal(A.tomarEnvioPendiente(almacen), null);
});

// ---- Lineas [nota-de-voz]: las que salieron bien no cuentan como falla para la vigilancia ----
// Misma regla que trabajador-tablero/lib/zonas.mjs: una linea es "falla" si trae la palabra error.
const cuentaComoFalla = (linea) => /error/i.test(linea);

prueba("[nota-de-voz] subida ok no trae la palabra error; una con error si", () => {
  const rutaSrc = fs.readFileSync("src/app/api/cliente/chats/upload-audio/route.ts", "utf8");
  const accionSrc = fs.readFileSync("src/app/actions/agent-actions.ts", "utf8");
  // La clave error solo se agrega cuando hubo falla (nunca "error": null en una linea buena).
  assert.match(rutaSrc, /\.\.\.\(respuesta\.ok \? \{\} : \{ error \}\)/);
  assert.match(accionSrc, /\.\.\.\(error === null \? \{\} : \{ error \}\)/);
  const buena = JSON.stringify({ paso: "subida", resultado: "ok", status: 200, bytes: 10, mime: "audio/webm", ms: 5, userId: "u", ...({}) });
  const mala = JSON.stringify({ paso: "subida", resultado: "error", status: 400, error: "Audio vacio" });
  assert.equal(cuentaComoFalla(buena), false);
  assert.equal(cuentaComoFalla(mala), true);
});

console.log(`\n${pruebas} pruebas OK`);
