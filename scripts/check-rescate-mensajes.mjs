// Pruebas del rescate de mensajes perdidos del Agente V3. Correr: npm run test:rescate-mensajes
//
// Desde el 11-10-2026 el rescate NO tiene interruptor: corre siempre (pedido de Alex). Estas pruebas
// comprueban que sigue corriendo aunque la bandera vieja diga "off", y que las protecciones siguen
// en pie: no contesta lo ya atendido, no le habla encima a una asesora, respeta la IA pausada.
//
// Carga el código REAL del rescate (rescate-de-mensajes.ts), de la huella del motor (decisiones.ts)
// y del retomar (retomar.ts) transpilando el TypeScript. Reemplaza solo la base (una base en memoria
// con la forma de Prisma), el motor del V3 y lo que manda por WhatsApp.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import ts from "typescript";

const nodeRequire = createRequire(import.meta.url);
const SRC = path.resolve("src");

// --- Cargador mínimo de TypeScript con alias "@/" y reemplazos -------------------------------------
const cache = new Map();
function resolver(desde, especificador) {
  let base;
  if (especificador.startsWith("@/")) base = path.join(SRC, especificador.slice(2));
  else if (especificador.startsWith(".")) base = path.resolve(path.dirname(desde), especificador);
  else return null;
  for (const candidato of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
    if (fs.existsSync(candidato) && fs.statSync(candidato).isFile()) return candidato;
  }
  throw new Error(`No encuentro ${especificador} desde ${desde}`);
}
function cargar(archivo, reemplazos) {
  if (reemplazos.has(archivo)) return reemplazos.get(archivo);
  if (cache.has(archivo)) return cache.get(archivo).exports;
  const salida = ts.transpileModule(fs.readFileSync(archivo, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: archivo,
  });
  const mod = { exports: {} };
  cache.set(archivo, mod);
  const req = (especificador) => {
    const resuelto = resolver(archivo, especificador);
    return resuelto ? cargar(resuelto, reemplazos) : nodeRequire(especificador);
  };
  new Function("exports", "require", "module", "__filename", "__dirname", salida.outputText)(
    mod.exports,
    req,
    mod,
    archivo,
    path.dirname(archivo),
  );
  return mod.exports;
}
const ruta = (relativa) => path.join(SRC, relativa);

// --- Base en memoria con la forma de Prisma (solo lo que usan rescate, decisiones y retomar) -------
let db;
let ids = 0;
function baseVacia() {
  return { canales: [], conversaciones: [], mensajes: [], ajustes: new Map(), enviados: [], motor: [], pausas: [], notas: [] };
}
const cumpleFecha = (valor, filtro) => {
  if (!filtro) return true;
  if (filtro.lte && !(valor <= filtro.lte)) return false;
  if (filtro.gte && !(valor >= filtro.gte)) return false;
  return true;
};
const deLaConversacion = (where) =>
  db.mensajes
    .filter((m) => m.conversationId === where.conversationId)
    .filter((m) => (where.type?.not ? m.type !== where.type.not : true))
    .filter((m) => (where.direction ? m.direction === where.direction : true))
    .filter((m) => (where.content !== undefined ? m.content === where.content : true))
    .filter((m) => cumpleFecha(m.createdAt, where.createdAt))
    .sort((a, b) => b.createdAt - a.createdAt);

const prisma = {
  whatsAppChannel: {
    findMany: async ({ where }) => {
      assert.deepEqual(where.metadata.path, ["agenteV3"]);
      return db.canales.filter((c) => c.metadata?.agenteV3 === where.metadata.equals).map((c) => ({ id: c.id, workspaceId: c.workspaceId }));
    },
  },
  conversation: {
    findMany: async ({ where, take }) =>
      db.conversaciones
        .filter((c) => c.channelId === where.channelId)
        .filter((c) => (where.automationPaused !== undefined ? c.automationPaused === where.automationPaused : true))
        .filter((c) => (where.status ? c.status === where.status : true))
        .filter((c) => cumpleFecha(c.lastMessageAt, where.lastMessageAt))
        .sort((a, b) => b.lastMessageAt - a.lastMessageAt)
        .slice(0, take ?? Infinity)
        .map((c) => ({ id: c.id, contact: { metadata: c.contact.metadata ?? null } })),
    findFirst: async ({ where }) => {
      const c = db.conversaciones.find((x) => x.id === where.id && x.workspaceId === where.workspaceId);
      if (!c) return null;
      const canal = db.canales.find((x) => x.id === c.channelId);
      return { id: c.id, contact: c.contact, channel: canal };
    },
  },
  message: {
    findFirst: async ({ where }) => deLaConversacion(where)[0] ?? null,
    findMany: async ({ where, take }) => deLaConversacion(where).slice(0, take ?? Infinity),
    count: async ({ where }) => deLaConversacion(where).length,
    create: async ({ data }) => {
      const fila = { id: `m${++ids}`, createdAt: new Date(), ...data };
      db.mensajes.push(fila);
      return fila;
    },
  },
  appSetting: {
    findUnique: async ({ where }) => (db.ajustes.has(where.key) ? { key: where.key, value: db.ajustes.get(where.key) } : null),
    upsert: async ({ where, create, update }) => {
      db.ajustes.set(where.key, db.ajustes.has(where.key) ? update.value : create.value);
      return { key: where.key, value: db.ajustes.get(where.key) };
    },
  },
};

// --- Reemplazos ----------------------------------------------------------------------------------
const reemplazos = new Map([
  [ruta("lib/prisma.ts"), { prisma }],
  [ruta("lib/crm-stage-sync.ts"), { moverEtapaDesdeAgente: async () => {} }],
  [
    ruta("lib/conversation-activity.ts"),
    {
      recordConversationActivity: async (nota) => {
        db.notas.push(nota.text);
      },
    },
  ],
  [
    ruta("lib/conversation-automation.ts"),
    {
      setConversationAutomationPaused: async ({ conversationId, paused }) => {
        db.pausas.push({ conversationId, paused });
      },
    },
  ],
  [
    ruta("lib/evolution-envio.ts"),
    {
      sendAndPersistEvolutionFlowStepResilient: async ({ conversationId, step }) => {
        db.enviados.push({ conversationId, texto: step.content });
        db.mensajes.push({ id: `m${++ids}`, conversationId, direction: "OUTBOUND", type: "TEXT", content: step.content, createdAt: new Date() });
        return true;
      },
    },
  ],
  [ruta("features/agente-v3/servicios/avisos.ts"), { avisarAsesorPorWhatsApp: async () => {} }],
  [ruta("features/agente-v3/servicios/redactor.ts"), { responderConElRedactor: async () => "sin redactor en la prueba" }],
  [ruta("features/crm/services/stage-follow-up.ts"), { agendarSeguimientoDeEtapa: async () => {} }],
  [ruta("features/embudo/servicios/eventos.ts"), { registrarTurnoV3: async () => {} }],
]);

// La huella REAL del motor, sobre la base en memoria.
const { anotarDecision } = cargar(ruta("features/agente-v3/servicios/decisiones.ts"), reemplazos);

// El motor del V3: contesta y deja su huella, como el de verdad (motor/ejecutar.ts:184).
reemplazos.set(ruta("features/agente-v3/motor/ejecutar.ts"), {
  atenderConAgenteV3: async (entrada) => {
    const cuando = new Date().toISOString();
    db.motor.push({ conversationId: entrada.conversationId, mensaje: entrada.mensaje });
    await entrada.herramientas.enviarPaso({ kind: "text", content: `Respuesta a: ${entrada.mensaje}` });
    await anotarDecision(entrada.conversationId, { cuando, atendido: true, regla: "regla de prueba" });
    return { atendido: true, regla: "regla de prueba" };
  },
});

const { rescatarMensajesSinDecidir } = cargar(ruta("features/agente-v3/servicios/rescate-de-mensajes.ts"), reemplazos);

// --- Armado de escenarios ------------------------------------------------------------------------
const WS = "ws-magilus";
const hace = (min) => new Date(Date.now() - min * 60_000);

function canalV3(id = "canal-v3") {
  db.canales.push({ id, workspaceId: WS, agentId: null, evolutionInstanceName: "ventas1", metadata: { agenteV3: true }, purpose: "SALES" });
  return id;
}
function chat(id, { minutos = 5, pausada = false, asignada = null, canal = "canal-v3", mensajes = [] } = {}) {
  db.conversaciones.push({
    id,
    workspaceId: WS,
    channelId: canal,
    automationPaused: pausada,
    status: "OPEN",
    assignedToId: asignada,
    lastMessageAt: hace(minutos),
    contact: { id: `ct-${id}`, name: "Clienta", phoneNumber: "573000000000", metadata: null },
  });
  for (const m of mensajes) {
    db.mensajes.push({ id: `m${++ids}`, conversationId: id, type: "TEXT", ...m });
  }
}
const delCliente = (texto, minutos) => ({ direction: "INBOUND", content: texto, createdAt: hace(minutos) });
const nuestro = (texto, minutos) => ({ direction: "OUTBOUND", content: texto, createdAt: hace(minutos) });
const notaSistema = (texto, minutos) => ({ direction: "OUTBOUND", type: "SYSTEM", content: texto, createdAt: hace(minutos) });
const notasDelRescate = (id) => db.mensajes.filter((m) => m.conversationId === id && m.type === "SYSTEM" && m.rawPayload?.rescate);

let pruebas = 0;
async function prueba(nombre, fn) {
  db = baseVacia();
  canalV3();
  // Silencia los console.log del rescate y del retomar para que la salida se lea.
  const log = console.log;
  console.log = () => {};
  try {
    await fn();
  } finally {
    console.log = log;
  }
  pruebas += 1;
  console.log(`ok  ${nombre}`);
}

// --- 0. Ya no hay interruptor --------------------------------------------------------------------
await prueba("(0) el switch ya no está en la pantalla ni en el código", async () => {
  const pagina = fs.readFileSync(ruta("app/cliente/agente-v3/page.tsx"), "utf8");
  assert.doesNotMatch(pagina, /FormActionSwitch/);
  assert.doesNotMatch(pagina, /<p[^>]*>Rescatar mensajes perdidos/);
  assert.doesNotMatch(pagina, /rescateEncendido|cambiarBanderaDeRescateAction/);
  assert.equal(fs.existsSync(ruta("app/actions/agente-v3-actions.ts")), false);
  const servicio = fs.readFileSync(ruta("features/agente-v3/servicios/rescate-de-mensajes.ts"), "utf8");
  assert.doesNotMatch(servicio, /export async function (rescateEncendido|guardarBanderaDeRescate)/);
  assert.doesNotMatch(servicio, /["'`]agente-v3:rescate:["'`]/);
  const modulo = cargar(ruta("features/agente-v3/servicios/rescate-de-mensajes.ts"), reemplazos);
  assert.equal(modulo.rescateEncendido, undefined);
  assert.equal(modulo.guardarBanderaDeRescate, undefined);
});

// --- 1. Siempre activo ---------------------------------------------------------------------------
await prueba("(1) con la bandera vieja en 'off' en la base, el rescate IGUAL corre y recupera", async () => {
  db.ajustes.set(`agente-v3:rescate:${WS}`, "off");
  chat("perdido", { mensajes: [nuestro("Hola, ¿en qué ciudad estás?", 20), delCliente("En Cali, cuánto vale el combo", 5)] });
  const r = await rescatarMensajesSinDecidir();
  assert.equal(r.rescatados, 1);
  assert.equal(db.motor.length, 1);
  assert.equal(db.motor[0].mensaje, "En Cali, cuánto vale el combo");
  assert.deepEqual(db.enviados.map((e) => e.conversationId), ["perdido"]);
  assert.match(notasDelRescate("perdido")[0].content, /se rescató un mensaje/);
  // La bandera vieja no se toca ni se borra: solo se ignora.
  assert.equal(db.ajustes.get(`agente-v3:rescate:${WS}`), "off");
});

await prueba("(1b) con la bandera en 'on' o sin fila también corre (no depende del ajuste)", async () => {
  chat("sin-fila", { mensajes: [delCliente("Buenas, info", 4)] });
  assert.equal((await rescatarMensajesSinDecidir()).rescatados, 1);
  db = baseVacia();
  canalV3();
  db.ajustes.set(`agente-v3:rescate:${WS}`, "on");
  chat("con-on", { mensajes: [delCliente("Buenas, info", 4)] });
  assert.equal((await rescatarMensajesSinDecidir()).rescatados, 1);
});

// --- 2. Protección: mensaje ya atendido ----------------------------------------------------------
await prueba("(2a) mensaje que el motor ya decidió (aunque haya callado) → no lo toca", async () => {
  chat("decidido", { mensajes: [delCliente("ok gracias", 6)] });
  await anotarDecision("decidido", { cuando: hace(5.9).toISOString(), atendido: false, regla: null });
  const r = await rescatarMensajesSinDecidir();
  assert.equal(r.rescatados, 0);
  assert.equal(db.motor.length, 0);
  assert.equal(db.enviados.length, 0);
  assert.equal(notasDelRescate("decidido").length, 0);
});

await prueba("(2b) ya le contestamos después (bot o asesora): el último es nuestro → no responde", async () => {
  chat("contestado", { mensajes: [delCliente("cuánto vale", 8), nuestro("El combo vale $989.000", 6), notaSistema("Ganó tal regla", 6)] });
  const r = await rescatarMensajesSinDecidir();
  assert.equal(r.revisados, 1);
  assert.equal(db.motor.length, 0);
  assert.equal(db.enviados.length, 0);
});

await prueba("(2c) un intento por mensaje: la segunda vuelta no vuelve a responder", async () => {
  chat("una-vez", { mensajes: [delCliente("hola", 5)] });
  assert.equal((await rescatarMensajesSinDecidir()).rescatados, 1);
  // El motor dejó su huella y además la respuesta: ni lo uno ni lo otro permiten repetir.
  assert.equal((await rescatarMensajesSinDecidir()).rescatados, 0);
  assert.equal(db.enviados.length, 1);
});

// --- 3. Protección: IA pausada -------------------------------------------------------------------
await prueba("(3) chat con la IA pausada → no responde, aunque el último sea del cliente y sin decisión", async () => {
  chat("pausado", { pausada: true, mensajes: [delCliente("me interesa la camilla", 5)] });
  const r = await rescatarMensajesSinDecidir();
  assert.equal(r.revisados, 0);
  assert.equal(db.motor.length, 0);
  assert.equal(db.enviados.length, 0);
  assert.equal(notasDelRescate("pausado").length, 0);
});

// --- 4. Protección: chat en manos de una asesora --------------------------------------------------
await prueba("(4a) la asesora escribió (eso pausa la IA) y el cliente contestó → no interfiere", async () => {
  chat("asesora-escribio", {
    pausada: true,
    asignada: "asesora-1",
    mensajes: [delCliente("info", 20), nuestro("Hola, soy Ingrid", 10), delCliente("dale, en Cali", 5)],
  });
  await rescatarMensajesSinDecidir();
  assert.equal(db.motor.length, 0);
  assert.equal(db.enviados.length, 0);
});

await prueba("(4b) la asesora escribió último (aunque la IA no estuviera pausada) → no le habla encima", async () => {
  chat("asesora-ultima", { asignada: "asesora-1", mensajes: [delCliente("info", 8), nuestro("Ya te paso el precio", 5)] });
  await rescatarMensajesSinDecidir();
  assert.equal(db.motor.length, 0);
  assert.equal(db.enviados.length, 0);
});

await prueba("(4c) regla actual (02-10-2026): asesora asignada que AÚN no escribió y IA sin pausa → sí rescata", async () => {
  chat("asignada-sin-escribir", { asignada: "asesora-1", mensajes: [delCliente("precio del sillón", 5)] });
  assert.equal((await rescatarMensajesSinDecidir()).rescatados, 1);
});

// --- 5. Límites de tiempo, intactos ---------------------------------------------------------------
await prueba("(5) antes de 3 min o después de 30 min → no lo toca", async () => {
  chat("muy-reciente", { minutos: 1, mensajes: [delCliente("hola", 1)] });
  chat("muy-viejo", { minutos: 45, mensajes: [delCliente("hola", 45)] });
  const r = await rescatarMensajesSinDecidir();
  assert.equal(r.revisados, 0);
  assert.equal(db.motor.length, 0);
});

await prueba("(6) línea que no usa el V3 → no lo toca", async () => {
  db.canales.push({ id: "canal-viejo", workspaceId: WS, metadata: { agenteV3: false }, evolutionInstanceName: "x" });
  chat("otra-linea", { canal: "canal-viejo", mensajes: [delCliente("hola", 5)] });
  assert.equal((await rescatarMensajesSinDecidir()).revisados, 0);
});

console.log(`\n${pruebas} pruebas ok`);
