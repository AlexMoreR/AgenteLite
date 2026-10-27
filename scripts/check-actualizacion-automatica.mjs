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

// --- Revisar la version antes de enviar (D) ---
async function pruebaAsync(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

await pruebaAsync("envio: con version nueva guarda el pendiente y NO envia", async () => {
  let enviados = 0;
  let guardados = 0;
  const r = await A.enviarSiLaVersionEstaAlDia({
    hayVersionNueva: async () => true,
    enviar: async () => void (enviados += 1),
    guardarPendiente: () => void (guardados += 1),
  });
  assert.deepEqual([r.enviado, enviados, guardados], [false, 0, 1]);
});

await pruebaAsync("envio: con la misma version envia y no guarda pendiente", async () => {
  let guardados = 0;
  const r = await A.enviarSiLaVersionEstaAlDia({
    hayVersionNueva: async () => false,
    enviar: async () => "listo",
    guardarPendiente: () => void (guardados += 1),
  });
  assert.deepEqual([r.enviado, r.resultado, guardados], [true, "listo", 0]);
});

await pruebaAsync("envio: si /api/version falla o no contesta, envia normal", async () => {
  const r = await A.enviarSiLaVersionEstaAlDia({
    hayVersionNueva: async () => {
      throw new Error("sin red");
    },
    enviar: async () => "listo",
    guardarPendiente: () => assert.fail("no debe guardar pendiente"),
  });
  assert.equal(r.enviado, true);
});

prueba("revision reciente: se reutiliza si tiene menos de 15 s, si no se vuelve a preguntar", () => {
  assert.equal(A.revisionVigente({ en: T0, vieja: true }, T0 + 14_999), true);
  assert.equal(A.revisionVigente({ en: T0, vieja: false }, T0 + 5_000), false);
  assert.equal(A.revisionVigente({ en: T0, vieja: true }, T0 + 15_001), null);
  assert.equal(A.revisionVigente(null, T0), null);
});

prueba("pendiente por version nueva: se usa una sola vez", () => {
  const almacen = almacenFalso();
  A.guardarEnvioPendiente(pendiente, almacen);
  assert.notEqual(A.tomarEnvioPendiente(almacen), null);
  assert.equal(A.tomarEnvioPendiente(almacen), null);
});

// --- Lineas [nota-de-voz] (A): una subida que salio bien no debe parecer falla ---
{
  const { esLineaDeErrorReal } = await import("../trabajador-tablero/lib/zonas.mjs");
  const ruta = fs.readFileSync("src/app/api/cliente/chats/upload-audio/route.ts", "utf8");
  const accion = fs.readFileSync("src/app/actions/agent-actions.ts", "utf8");
  prueba("nota de voz: el campo error solo se escribe cuando hay error", () => {
    assert.match(ruta, /\.\.\.\(error !== null \|\| !respuesta\.ok \? \{ error \} : \{\}\)/);
    assert.match(accion, /\.\.\.\(error !== null \? \{ error \} : \{\}\)/);
    const buena = `[nota-de-voz] ${JSON.stringify({ paso: "subida", resultado: "ok", status: 200, bytes: 100, mime: "audio/webm", ms: 90, userId: "u1" })}`;
    const mala = `[nota-de-voz] ${JSON.stringify({ paso: "subida", resultado: "error", status: 400, bytes: 100, mime: "audio/webm", ms: 90, userId: "u1", error: "Audio vacio" })}`;
    assert.equal(esLineaDeErrorReal(buena), false);
    assert.equal(esLineaDeErrorReal(mala), true);
  });
}

console.log(`\n${pruebas} pruebas OK`);
