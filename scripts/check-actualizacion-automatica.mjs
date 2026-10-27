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
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const T0 = 1_000_000_000;

await prueba("ocupada: escribio hace menos de 5 segundos", () => {
  A.marcarEscritura(T0);
  assert.equal(A.estaOcupada(T0 + 4_000), true);
  assert.equal(A.estaOcupada(T0 + 5_000), false);
});

await prueba("ocupada: envio en camino, grabando o subiendo; quieta cuando se apagan", () => {
  for (const motivo of ["texto", "grabando", "subiendo"]) {
    A.marcarOcupada(motivo, true);
    assert.equal(A.estaOcupada(T0 + 60_000), true, motivo);
    A.marcarOcupada(motivo, false);
    assert.equal(A.estaOcupada(T0 + 60_000), false, motivo);
  }
});

await prueba("ocupada: se puede ignorar la ventana de adjuntar al abrirla", () => {
  A.marcarOcupada("adjuntar", true);
  assert.equal(A.estaOcupada(T0 + 60_000), true);
  assert.equal(A.estaOcupada(T0 + 60_000, ["adjuntar"]), false);
  A.marcarOcupada("adjuntar", false);
});

await prueba("recarga cuando esta quieta y es la primera vez", () => {
  const r = A.decidirRecarga({ ahora: T0, ocupada: false, recargas: { ultima: 0, intentos: 0 } });
  assert.equal(r, "recargar");
});

await prueba("no recarga si esta ocupada", () => {
  const r = A.decidirRecarga({ ahora: T0, ocupada: true, recargas: { ultima: 0, intentos: 0 } });
  assert.equal(r, "esperar");
});

await prueba("tope de una recarga por minuto", () => {
  const recargas = { ultima: T0, intentos: 1 };
  assert.equal(A.decidirRecarga({ ahora: T0 + 30_000, ocupada: false, recargas }), "esperar");
  assert.equal(A.decidirRecarga({ ahora: T0 + 60_000, ocupada: false, recargas }), "recargar");
});

await prueba("la pastilla aparece despues de 2 intentos", () => {
  const recargas = { ultima: T0, intentos: 2 };
  assert.equal(A.decidirRecarga({ ahora: T0 + 10_000, ocupada: false, recargas }), "pastilla");
  assert.equal(A.decidirRecarga({ ahora: T0 + 999_000, ocupada: true, recargas }), "pastilla");
});

await prueba("registrar recargas suma intentos y olvidar los borra", () => {
  const almacen = almacenFalso();
  assert.deepEqual(A.leerRecargas(almacen), { ultima: 0, intentos: 0 });
  A.registrarRecarga(T0, almacen);
  A.registrarRecarga(T0 + 70_000, almacen);
  assert.deepEqual(A.leerRecargas(almacen), { ultima: T0 + 70_000, intentos: 2 });
  A.olvidarRecargas(almacen);
  assert.deepEqual(A.leerRecargas(almacen), { ultima: 0, intentos: 0 });
});

await prueba("borrador: se guarda y se lee por chat, y se borra", () => {
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

await prueba("borrador: guardar texto vacio lo quita", () => {
  const almacen = almacenFalso();
  A.guardarBorrador("agent:c1", "algo", almacen);
  A.guardarBorrador("agent:c1", "   ", almacen);
  assert.equal(A.leerBorrador("agent:c1", almacen), "");
});

await prueba("borrador: sin almacenamiento no revienta", () => {
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

await prueba("pendiente: se toma una sola vez (la marca se borra al leerlo)", () => {
  const almacen = almacenFalso();
  A.guardarEnvioPendiente(pendiente, almacen);
  assert.deepEqual(A.tomarEnvioPendiente(almacen), pendiente);
  assert.equal(A.tomarEnvioPendiente(almacen), null);
});

await prueba("pendiente: dato roto se descarta", () => {
  const almacen = almacenFalso();
  almacen.setItem("aizen:envio-pendiente", "{no es json");
  assert.equal(A.tomarEnvioPendiente(almacen), null);
  almacen.setItem("aizen:envio-pendiente", JSON.stringify({ chatKey: "x" }));
  assert.equal(A.tomarEnvioPendiente(almacen), null);
  assert.equal(almacen.getItem("aizen:envio-pendiente"), null);
});

await prueba("pendiente: se reenvia si es del chat abierto, reciente y no esta guardado", () => {
  assert.equal(A.puedeReenviarPendiente({ pendiente, chatAbiertoId: "c1", ahora: T0 + 20_000, yaGuardado: false }), true);
});

await prueba("pendiente: no se reenvia si ya esta guardado en el chat", () => {
  assert.equal(A.puedeReenviarPendiente({ pendiente, chatAbiertoId: "c1", ahora: T0 + 20_000, yaGuardado: true }), false);
});

await prueba("pendiente: no se reenvia con mas de 2 minutos", () => {
  assert.equal(A.puedeReenviarPendiente({ pendiente, chatAbiertoId: "c1", ahora: T0 + 120_001, yaGuardado: false }), false);
  assert.equal(A.puedeReenviarPendiente({ pendiente, chatAbiertoId: "c1", ahora: T0 + 120_000, yaGuardado: false }), true);
});

await prueba("pendiente: no se reenvia a otro chat ni con hora en el futuro ni vacio", () => {
  assert.equal(A.puedeReenviarPendiente({ pendiente, chatAbiertoId: "c2", ahora: T0 + 1_000, yaGuardado: false }), false);
  assert.equal(A.puedeReenviarPendiente({ pendiente, chatAbiertoId: "c1", ahora: T0 - 5_000, yaGuardado: false }), false);
  assert.equal(A.puedeReenviarPendiente({ pendiente: { ...pendiente, texto: "  " }, chatAbiertoId: "c1", ahora: T0 + 1_000, yaGuardado: false }), false);
});

/* ---------------- Revision de version ANTES de enviar (intento 4) ---------------- */

await prueba("antes de enviar: version nueva -> avisa que esta vieja (el texto se guarda y no se envia)", async () => {
  A.olvidarRevision();
  assert.equal(await A.versionViejaAntesDeEnviar(async () => true, T0), true);
});

await prueba("antes de enviar: misma version -> no esta vieja, se envia", async () => {
  A.olvidarRevision();
  assert.equal(await A.versionViejaAntesDeEnviar(async () => false, T0), false);
});

await prueba("antes de enviar: /api/version no contesta -> se envia normal", async () => {
  A.olvidarRevision();
  assert.equal(await A.versionViejaAntesDeEnviar(() => new Promise(() => {}), T0, 20), false);
  A.olvidarRevision();
  assert.equal(await A.versionViejaAntesDeEnviar(async () => { throw new Error("sin red"); }, T0), false);
});

await prueba("antes de enviar: una revision de menos de 15 s se reutiliza; la de mas, se vuelve a preguntar", async () => {
  A.olvidarRevision();
  A.recordarRevision(true, T0);
  let preguntas = 0;
  const consultar = async () => { preguntas += 1; return false; };
  assert.equal(await A.versionViejaAntesDeEnviar(consultar, T0 + 14_000), true);
  assert.equal(preguntas, 0);
  assert.equal(await A.versionViejaAntesDeEnviar(consultar, T0 + 15_000), false);
  assert.equal(preguntas, 1);
});

await prueba("pendiente: guardar avisa si no se pudo (entonces el texto sale normal)", () => {
  assert.equal(A.guardarEnvioPendiente(pendiente, almacenFalso()), true);
  assert.equal(A.guardarEnvioPendiente(pendiente, null), false);
  const roto = { getItem: () => null, removeItem: () => {}, setItem: () => { throw new Error("lleno"); } };
  assert.equal(A.guardarEnvioPendiente(pendiente, roto), false);
});

await prueba("pendiente: el texto que ya salio (mismo texto guardado) no se reenvia", () => {
  assert.equal(A.puedeReenviarPendiente({ pendiente, chatAbiertoId: "c1", ahora: T0 + 5_000, yaGuardado: true }), false);
});

await prueba("olvidarEscritura: tras enviar, la recarga no espera los 5 s", () => {
  A.marcarEscritura(T0);
  assert.equal(A.estaOcupada(T0 + 1_000), true);
  A.olvidarEscritura();
  assert.equal(A.estaOcupada(T0 + 1_000), false);
});

/* ---------------- Lineas [nota-de-voz] vs la regla de la vigilancia ---------------- */

const Z = await import(path.resolve("trabajador-tablero/lib/zonas.mjs"));

await prueba("nota de voz: el codigo solo escribe 'error' cuando hubo error", () => {
  const ruta = fs.readFileSync("src/app/api/cliente/chats/upload-audio/route.ts", "utf8");
  const accion = fs.readFileSync("src/app/actions/agent-actions.ts", "utf8");
  assert.match(ruta, /\.\.\.\(respuesta\.ok \? \{\} : \{ error \}\)/);
  assert.match(accion, /\.\.\.\(error \? \{ error \} : \{\}\)/);
});

await prueba("nota de voz: una linea de subida que salio bien no cuenta como falla; una con error, si", () => {
  const ok = '[nota-de-voz] {"paso":"subida","resultado":"ok","status":200,"bytes":1234,"mime":"audio/webm","ms":300,"userId":"u1"}';
  const mal = '[nota-de-voz] {"paso":"subida","resultado":"error","status":500,"bytes":1234,"mime":"audio/webm","ms":300,"userId":"u1","error":"sin espacio"}';
  assert.equal(Z.esLineaDeErrorReal(ok, { minutosDesdeSubir: 10 }), false);
  assert.equal(Z.esLineaDeErrorReal(mal, { minutosDesdeSubir: 10 }), true);
});

console.log(`\n${pruebas} pruebas OK`);
