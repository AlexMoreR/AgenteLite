// Pruebas de la lectura de la pausa del bot. Correr: npm run test:pausa-lectura-segura
//
// Si la base falla al leer "¿este chat está pausado?", el bot NO debe creer que está libre y hablarle
// encima a la asesora. Carga el código REAL de conversation-automation.ts (transpilando TypeScript)
// y reemplaza solo la base. Además revisa el texto de route.ts (los 3 puntos donde el bot decide hablar).
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import ts from "typescript";

const nodeRequire = createRequire(import.meta.url);
const SRC = path.resolve("src");

let filas = [];
let fallaLectura = false;
let fallaGuardado = false;
const avisos = [];
const prisma = {
  $queryRaw: async () => {
    if (fallaLectura) throw new Error("base no responde");
    return filas;
  },
  $executeRaw: async () => {
    if (fallaGuardado) throw new Error("no se pudo escribir");
    return 1;
  },
  conversation: { findUnique: async () => null },
};
const Prisma = { sql: (...a) => a, empty: "" };

const archivo = path.join(SRC, "lib/conversation-automation.ts");
const salida = ts.transpileModule(fs.readFileSync(archivo, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
});
const mod = { exports: {} };
new Function("exports", "require", "module", salida.outputText)(
  mod.exports,
  (nombre) => {
    if (nombre === "@prisma/client") return { Prisma };
    if (nombre === "@/lib/prisma") return { prisma };
    return nodeRequire(nombre);
  },
  mod,
);
const { getConversationAutomationPaused, leerPausaParaElBot, setConversationAutomationPaused } = mod.exports;

const warnOriginal = console.warn;
console.warn = (...args) => avisos.push(args);
const entrada = { conversationId: "c1", workspaceId: "w1" };
const reiniciar = () => {
  filas = [];
  fallaLectura = false;
  fallaGuardado = false;
  avisos.length = 0;
};

try {
  // 1. La consulta falla -> "no se pudo leer" y aviso en el log con el chat.
  reiniciar();
  fallaLectura = true;
  assert.equal(await leerPausaParaElBot(entrada), "no_se_pudo_leer");
  assert.equal(avisos.length, 1);
  assert.equal(avisos[0][1].conversationId, "c1");
  assert.match(avisos[0][1].error, /base no responde/);

  // 2. Chat sin pausa -> "libre": el bot sigue contestando.
  reiniciar();
  filas = [{ automationPaused: false }];
  assert.equal(await leerPausaParaElBot(entrada), "libre");
  filas = [];
  assert.equal(await leerPausaParaElBot(entrada), "libre");
  assert.equal(avisos.length, 0);

  // 3. Chat pausado -> "pausado".
  filas = [{ automationPaused: true }];
  assert.equal(await leerPausaParaElBot(entrada), "pausado");

  // 4. La función vieja sigue diciendo "no pausado" si falla (pantalla igual) y deja aviso.
  reiniciar();
  fallaLectura = true;
  assert.equal(await getConversationAutomationPaused(entrada), false);
  assert.equal(avisos.length, 1);
  reiniciar();
  filas = [{ automationPaused: true }];
  assert.equal(await getConversationAutomationPaused(entrada), true);

  // 5. Guardado que falla: responde false, no se cae y deja el error con el chat.
  reiniciar();
  fallaGuardado = true;
  assert.equal(await setConversationAutomationPaused({ conversationId: "c1", paused: true }), false);
  assert.equal(avisos.length, 1);
  assert.equal(avisos[0][1].conversationId, "c1");
  assert.match(avisos[0][1].error, /no se pudo escribir/);
  reiniciar();
  assert.equal(await setConversationAutomationPaused({ conversationId: "c1", paused: false }), true);
} finally {
  console.warn = warnOriginal;
}

// 6. Texto de route.ts: los 3 puntos usan la lectura nueva y solo "libre" deja hablar.
const route = fs.readFileSync(path.join(SRC, "app/api/webhooks/evolution/route.ts"), "utf8");
assert.ok(!route.includes("getConversationAutomationPaused"), "route.ts no debe usar la lectura vieja");
assert.equal((route.match(/leerPausaParaElBot\(/g) ?? []).length, 3, "tres lecturas cuidadosas");
assert.match(route, /const conversationAutomationPaused = pausaLeidaV2 !== "libre";/);
assert.match(route, /const v3Pausado = pausaLeidaV3 !== "libre";/);
assert.match(route, /if \(pausaDuranteLaEspera !== "libre"\) \{/);
assert.match(route, /const v3PausaReal = pausaLeidaV3 === "pausado";/);
assert.match(route, /if \(v3PausaReal && channel\.evolutionInstanceName && !fromMe && !isCallEvent\) \{/);
assert.ok(route.includes("canalUsaV3 && !v3Pausado"), "el V3 solo habla si no está pausado");

console.log("OK: la lectura de la pausa del bot es segura (si no se puede leer, el bot se calla)");
