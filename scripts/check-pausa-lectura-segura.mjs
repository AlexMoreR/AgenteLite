// Pruebas de la lectura de la pausa para el bot. Correr: npm run test:pausa-lectura-segura
//
// Si la base falla al leer "¿este chat está pausado?", el bot NO debe creer que está libre
// (le contestaba encima a la asesora). Carga el código REAL de src/lib/conversation-automation.ts
// transpilando el TypeScript y reemplaza solo la base y Prisma.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import ts from "typescript";

const nodeRequire = createRequire(import.meta.url);
const SRC = path.resolve("src");

// Base simulada: `filas` es lo que devuelve la consulta; `falla` hace que lance error.
const base = { filas: [], falla: false, fallaGuardado: false };
const prisma = {
  $queryRaw: async () => {
    if (base.falla) throw new Error("base caída");
    return base.filas;
  },
  $executeRaw: async () => {
    if (base.fallaGuardado) throw new Error("guardado caído");
    return 1;
  },
  conversation: { findUnique: async () => null },
};
const Prisma = { sql: (...a) => a, empty: "" };

function cargarModulo(archivo) {
  const salida = ts.transpileModule(fs.readFileSync(archivo, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: archivo,
  });
  const mod = { exports: {} };
  const req = (esp) => {
    if (esp === "@/lib/prisma") return { prisma };
    if (esp === "@prisma/client") return { Prisma };
    return nodeRequire(esp);
  };
  new Function("exports", "require", "module", salida.outputText)(mod.exports, req, mod);
  return mod.exports;
}
const { getConversationAutomationPaused, leerPausaParaElBot, setConversationAutomationPaused } = cargarModulo(
  path.join(SRC, "lib/conversation-automation.ts"),
);

// Captura los avisos del log.
const avisos = [];
const warnOriginal = console.warn;
console.warn = (...args) => avisos.push(args);
const limpiar = () => (avisos.length = 0);

let pruebas = 0;
async function prueba(nombre, fn) {
  limpiar();
  base.filas = [];
  base.falla = false;
  base.fallaGuardado = false;
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const entrada = { conversationId: "conv-1", workspaceId: "ws-1" };

await prueba("1. si la consulta falla, la lectura del bot responde 'no se pudo leer' y avisa en el log", async () => {
  base.falla = true;
  assert.equal(await leerPausaParaElBot(entrada), "no_se_pudo_leer");
  assert.equal(avisos.length, 1);
  assert.equal(avisos[0][1].conversationId, "conv-1");
  assert.match(avisos[0][1].error, /base caída/);
});

await prueba("2. con la base normal y chat sin pausa responde 'libre' (el bot sigue contestando)", async () => {
  base.filas = [{ automationPaused: false }];
  assert.equal(await leerPausaParaElBot(entrada), "libre");
  base.filas = [{ automationPaused: null }];
  assert.equal(await leerPausaParaElBot(entrada), "libre");
  base.filas = [];
  assert.equal(await leerPausaParaElBot(entrada), "libre");
  assert.equal(avisos.length, 0);
});

await prueba("3. con la base normal y chat pausado responde 'pausado'", async () => {
  base.filas = [{ automationPaused: true }];
  assert.equal(await leerPausaParaElBot(entrada), "pausado");
  assert.equal(avisos.length, 0);
});

await prueba("4. la función vieja sigue respondiendo 'no pausado' si falla, y avisa en el log", async () => {
  base.falla = true;
  assert.equal(await getConversationAutomationPaused(entrada), false);
  assert.equal(avisos.length, 1);
  base.falla = false;
  base.filas = [{ automationPaused: true }];
  assert.equal(await getConversationAutomationPaused(entrada), true);
});

await prueba("5. si el guardado falla responde false, no se cae y deja el error en el log con el chat", async () => {
  base.fallaGuardado = true;
  assert.equal(await setConversationAutomationPaused({ conversationId: "conv-9", paused: true }), false);
  assert.equal(avisos.length, 1);
  assert.equal(avisos[0][1].conversationId, "conv-9");
  assert.match(avisos[0][1].error, /guardado caído/);
  base.fallaGuardado = false;
  assert.equal(await setConversationAutomationPaused({ conversationId: "conv-9", paused: false }), true);
});

await prueba("6. route.ts: los 3 lugares usan la lectura nueva y solo 'libre' deja hablar al bot", async () => {
  const route = fs.readFileSync(path.join(SRC, "app/api/webhooks/evolution/route.ts"), "utf8");
  assert.ok(!route.includes("getConversationAutomationPaused"), "route.ts no debe usar la lectura vieja");
  assert.equal(route.match(/leerPausaParaElBot\(/g)?.length, 3, "debe haber 3 lecturas nuevas");
  assert.match(route, /const conversationAutomationPaused = pausaDelChat !== "libre";/);
  assert.match(route, /const v3Pausado = pausaV3 !== "libre";/);
  assert.match(route, /if \(pausaDuranteLaEspera !== "libre"\) \{/);
  // El bot V3 y las respuestas rápidas solo corren si no están pausados.
  assert.match(route, /canalUsaV3 && !v3Pausado && channel\.evolutionInstanceName/);
  assert.match(route, /!conversationAutomationPaused/);
  // El aviso a la clienta exige pausa REAL, no una falla de lectura.
  assert.match(route, /if \(pausaV3 === "pausado" && channel\.evolutionInstanceName && !fromMe && !isCallEvent\) \{/);
  assert.ok(route.includes("En un momento una de nuestras asesoras te contacta"));
});

console.warn = warnOriginal;
console.log(`\n${pruebas} pruebas OK`);
