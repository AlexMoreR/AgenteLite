// Pruebas de "asignar solo cuando el chat necesita asesora" (T-772, partes 1 y 2):
// src/lib/reparto-cuando-lo-necesita.ts, con el reparto por turno (src/lib/reparto-por-turno.ts) y el
// rescate de chats sin asesora (src/lib/rescate-de-chats-huerfanos.ts); parte 2: la asesora que escribe
// (src/lib/conversation-claim.ts) y el aviso del agente (src/lib/asignar-porque-el-agente-pide.ts). Sin base ni red: una base
// simulada en memoria. Correr: npm run test:reparto-cuando-lo-necesita
import assert from "node:assert/strict";

import { cargar } from "./supervisor-cargar.mjs";

// ── Base simulada ───────────────────────────────────────────────────────────────────────────────
const estado = { settings: new Map(), conversaciones: new Map(), mensajes: [], asignaciones: [], lecturasDeConfig: 0 };

function reiniciar() {
  estado.settings = new Map();
  estado.conversaciones = new Map();
  estado.mensajes = [];
  estado.asignaciones = [];
  estado.lecturasDeConfig = 0;
  rcn?.olvidarConfigsDeAsignacion();
}

/** ¿El valor cumple la condición de Prisma? Solo lo que usan estos archivos. */
function cumpleCampo(valor, condicion) {
  if (condicion === undefined) return true;
  if (condicion === null) return valor == null;
  if (condicion instanceof Date) return valor?.getTime() === condicion.getTime();
  if (typeof condicion !== "object") return valor === condicion;
  if ("in" in condicion && !condicion.in.includes(valor)) return false;
  if ("notIn" in condicion && condicion.notIn.includes(valor)) return false;
  if ("not" in condicion && (condicion.not === null ? valor == null : valor === condicion.not)) return false;
  if ("startsWith" in condicion && !String(valor ?? "").startsWith(condicion.startsWith)) return false;
  if ("lte" in condicion && !(valor && valor <= condicion.lte)) return false;
  if ("gte" in condicion && !(valor && valor >= condicion.gte)) return false;
  if ("lt" in condicion && !(valor && valor < condicion.lt)) return false;
  return true;
}

function cumpleMensaje(m, where = {}) {
  return ["conversationId", "type", "direction", "deletedAt", "content"].every((campo) => cumpleCampo(m[campo], where[campo]));
}

function cumpleConversacion(c, where = {}) {
  if (!cumpleCampo(c.assignedToUserId, where.assignedToUserId)) return false;
  if (!cumpleCampo(c.status, where.status)) return false;
  if (where.channelId && !cumpleCampo(c.channelId, where.channelId)) return false;
  if (where.channel?.is?.purpose && c.channel?.purpose !== where.channel.is.purpose) return false;
  if (!cumpleCampo(c.lastMessageAt, where.lastMessageAt)) return false;
  // El candado "No reasignar" (OR) no se simula: ningún chat de estas pruebas lo tiene.
  return true;
}

const desc = (a, b) => b.createdAt - a.createdAt;

const prisma = {
  appSetting: {
    findUnique: async ({ where }) => {
      if (where.key.startsWith("reparto:cuando:")) estado.lecturasDeConfig += 1;
      return estado.settings.has(where.key) ? { key: where.key, value: estado.settings.get(where.key) } : null;
    },
    upsert: async ({ where, create, update }) => {
      estado.settings.set(where.key, estado.settings.has(where.key) ? update.value : create.value);
      return {};
    },
  },
  conversation: {
    findUnique: async ({ where }) => {
      const c = estado.conversaciones.get(where.id);
      return c ? structuredClone(c) : null;
    },
    findFirst: async ({ where }) => {
      const c = estado.conversaciones.get(where.id);
      if (!c || c.workspaceId !== where.workspaceId || !cumpleCampo(c.assignedToUserId, where.assignedToUserId)) return null;
      return structuredClone(c);
    },
    updateMany: async ({ where, data }) => {
      const c = estado.conversaciones.get(where.id);
      if (!c || !cumpleCampo(c.assignedToUserId, where.assignedToUserId)) return { count: 0 };
      Object.assign(c, data);
      return { count: 1 };
    },
    findMany: async ({ where, take }) =>
      [...estado.conversaciones.values()]
        .filter((c) => cumpleConversacion(c, where))
        .sort((a, b) => b.lastMessageAt - a.lastMessageAt)
        .slice(0, take ?? Infinity)
        .map((c) => structuredClone(c)),
  },
  officialApiConversation: {
    updateMany: async ({ where, data }) => {
      const c = estado.conversaciones.get(where.id);
      if (!c || !cumpleCampo(c.assignedToUserId, where.assignedToUserId)) return { count: 0 };
      Object.assign(c, data);
      return { count: 1 };
    },
  },
  user: {
    findUnique: async ({ where }) => ({ name: where.id, email: null }),
  },
  whatsAppChannel: {
    findUnique: async ({ where }) => ({ id: where.id, purpose: where.id === "linea-admin" ? "ADMIN" : "SALES" }),
  },
  message: {
    findMany: async ({ where, take }) =>
      estado.mensajes.filter((m) => cumpleMensaje(m, where)).sort(desc).slice(0, take ?? Infinity).map((m) => ({ ...m })),
    findFirst: async ({ where }) => {
      const m = estado.mensajes.filter((x) => cumpleMensaje(x, where)).sort(desc)[0];
      return m ? { ...m } : null;
    },
    groupBy: async ({ where, _min, _max }) => {
      const grupos = new Map();
      for (const m of estado.mensajes.filter((x) => cumpleMensaje(x, where))) {
        const g = grupos.get(m.conversationId) ?? { conversationId: m.conversationId, min: m.createdAt, max: m.createdAt };
        if (m.createdAt < g.min) g.min = m.createdAt;
        if (m.createdAt > g.max) g.max = m.createdAt;
        grupos.set(m.conversationId, g);
      }
      return [...grupos.values()].map((g) => ({
        conversationId: g.conversationId,
        ...(_min ? { _min: { createdAt: g.min } } : {}),
        ...(_max ? { _max: { createdAt: g.max } } : {}),
      }));
    },
  },
};

const mocks = {
  "@/lib/prisma": { prisma },
  "@/lib/reparto-de-leads": {
    // Igual que la rueda de verdad: si el chat ya tiene dueña, no lo toca (null).
    autoAssignConversationToCollaborator: async ({ conversationId }) => {
      const c = estado.conversaciones.get(conversationId);
      if (!c || c.assignedToUserId) return null;
      c.assignedToUserId = "asesora-de-turno";
      estado.asignaciones.push(conversationId);
      return "asesora-de-turno";
    },
  },
  // La toma al escribir (conversation-claim.ts): sin sesión ni embudo ni historial de verdad.
  "@/auth": { auth: async () => null },
  "@/features/embudo/servicios/eventos": { registrarAsesoraRespondio: () => {} },
  "@/lib/conversation-activity": { recordConversationActivity: async () => {} },
  "@/lib/etapa-automatica-crm": { etapaAlAsignar: async () => {} },
};

const rcn = cargar("src/lib/reparto-cuando-lo-necesita.ts", mocks);
const turno = cargar("src/lib/reparto-por-turno.ts", mocks);
const rescate = cargar("src/lib/rescate-de-chats-huerfanos.ts", mocks);
const toma = cargar("src/lib/conversation-claim.ts", mocks);
const agentePide = cargar("src/lib/asignar-porque-el-agente-pide.ts", mocks);

// ── Chats ───────────────────────────────────────────────────────────────────────────────────────
const AHORA = new Date();
const haceMin = (min) => new Date(AHORA.getTime() - min * 60_000);
const ANUNCIO = "Hola, me interesa el COMBO de estética (camilla, escalera, silla y auxiliar)";
const BIENVENIDA = "Bienvenid@ a *Magilus* 👑";
const SERVICIOS = "¿Qué servicios vas a ofrecer en tu espacio?";

const IN = (content, type = "TEXT") => ({ direction: "INBOUND", type, content });
const BOT = (content, type = "TEXT") => ({ direction: "OUTBOUND", type, content });
const FOTO = () => BOT(null, "IMAGE");
const NOTA = (content) => ({ direction: "OUTBOUND", type: "SYSTEM", content });

/**
 * Guarda un chat: los mensajes van del más viejo al más nuevo, un minuto entre cada uno, y el último
 * llega `terminaHaceMin` minutos antes de AHORA.
 */
function chat(id, mensajes, extra = {}) {
  const { terminaHaceMin = 1, ...resto } = extra;
  const filas = mensajes.map((m, i) => ({
    id: `${id}-${i}`,
    conversationId: id,
    deletedAt: null,
    createdAt: haceMin(terminaHaceMin + (mensajes.length - 1 - i)),
    ...m,
  }));
  estado.mensajes.push(...filas);
  estado.conversaciones.set(id, {
    id,
    channelId: "linea-ventas",
    workspaceId: "ws1",
    status: "OPEN",
    assignedToUserId: null,
    automationPaused: false,
    lastMessageAt: filas.at(-1)?.createdAt ?? AHORA,
    channel: { purpose: "SALES" },
    contact: { metadata: null, bloqueadoEn: null, excludedFromCrm: false },
    ...resto,
  });
  return id;
}

const porTurno = (id) => turno.repartirSiElTurnoLoAmerita({ conversationId: id, channelId: "linea-ventas", workspaceId: "ws1" });
const configurar = async (config) => rcn.guardarConfigDeAsignacion("ws1", config);

let pruebas = 0;
async function prueba(nombre, fn) {
  reiniciar();
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

// ── 1. La configuración ─────────────────────────────────────────────────────────────────────────
await prueba("config: sin fila, JSON roto o valores raros = a, b y c prendidos, comoAntes apagado", async () => {
  const defecto = { agentePide: true, clientaPreguntaPlataOEntrega: true, asesoraEscribe: true, comoAntes: false };
  assert.deepEqual(await rcn.leerConfigDeAsignacion("ws1"), defecto);
  assert.deepEqual(rcn.leerConfigDeAsignacionDeTexto("{roto"), defecto);
  assert.deepEqual(rcn.leerConfigDeAsignacionDeTexto("[1,2]"), defecto);
  assert.deepEqual(rcn.leerConfigDeAsignacionDeTexto('{"comoAntes": 1, "agentePide": "x"}'), defecto);
  assert.deepEqual(rcn.leerConfigDeAsignacionDeTexto('{"clientaPreguntaPlataOEntrega": false}'), { ...defecto, clientaPreguntaPlataOEntrega: false });
  assert.deepEqual(rcn.leerConfigDeAsignacionDeTexto('{"comoAntes": "true"}'), { ...defecto, comoAntes: true });
  assert.equal(rcn.claveConfigDeAsignacion("ws1"), "reparto:cuando:ws1");
});

await prueba("config: guardar completa lo que falta, escribe JSON en reparto:cuando:<ws> y limpia la memoria", async () => {
  assert.equal((await rcn.leerConfigDeAsignacion("ws1")).comoAntes, false);
  const guardada = await configurar({ comoAntes: true, asesoraEscribe: "no" });
  assert.deepEqual(guardada, { agentePide: true, clientaPreguntaPlataOEntrega: true, asesoraEscribe: true, comoAntes: true });
  assert.deepEqual(JSON.parse(estado.settings.get("reparto:cuando:ws1")), guardada);
  // Sin limpiar la memoria seguiría leyendo comoAntes = false durante un minuto.
  assert.equal((await rcn.leerConfigDeAsignacion("ws1")).comoAntes, true);
});

await prueba("config: un minuto de memoria (no lee la base en cada mensaje)", async () => {
  await rcn.leerConfigDeAsignacion("ws1");
  await rcn.leerConfigDeAsignacion("ws1");
  await rcn.leerConfigDeAsignacion("ws1");
  assert.equal(estado.lecturasDeConfig, 1);
});

// ── 2. El detector ──────────────────────────────────────────────────────────────────────────────
await prueba("hablaDePlataOEntrega: precio, pago, envío, contraentrega y ciudad (sin importar tildes ni mayúsculas)", async () => {
  for (const frase of ["cuánto vale", "CUANTO CUESTA", "precio?", "qué valor tiene", "¿hacen contraentrega?", "cómo pago", "Aceptan NEQUI", "por transferencia", "hacen envíos?", "soy de Medellín", "vivo en Pereira", "BOGOTÁ"]) {
    assert.equal(rcn.hablaDePlataOEntrega(frase), true, frase);
  }
  for (const frase of ["Para el combo de estética", "masajes", "ok", "Me encanta", "Me llamo Florencia", "¿De qué color hay?"]) {
    assert.equal(rcn.hablaDePlataOEntrega(frase), false, frase);
  }
});

// ── 3. El reparto por turno ─────────────────────────────────────────────────────────────────────
const COMIENZO = [IN(ANUNCIO), BOT(BIENVENIDA), BOT(SERVICIOS)];
const CON_FOTOS = [...COMIENZO, IN("estética facial"), FOTO(), BOT("¿Te comparto el precio?")];

await prueba("'Para el combo de estética' NO asigna (ni antes ni después de las fotos)", async () => {
  await porTurno(chat("c1", [...COMIENZO, IN("Para el combo de estética")]));
  await porTurno(chat("c2", [...CON_FOTOS, IN("Para el combo de estética")]));
  assert.deepEqual(estado.asignaciones, []);
});

await prueba("'cuánto vale', '¿hacen contraentrega?', 'cómo pago' y 'soy de Medellín' SÍ asignan (con las fotos mandadas)", async () => {
  for (const [i, frase] of ["cuánto vale", "¿hacen contraentrega?", "cómo pago", "soy de Medellín"].entries()) {
    const id = chat(`p${i}`, [...CON_FOTOS, IN(frase)]);
    assert.equal((await porTurno(id)).asignada, true, frase);
  }
});

await prueba("la nota 'El agente pide un asesor' SÍ asigna, aunque no haya fotos", async () => {
  const id = chat("n1", [...COMIENZO, IN("Quiropodia"), NOTA("El agente pide un asesor: que conteste una persona")]);
  assert.equal((await porTurno(id)).asignada, true);
});

await prueba("la IA pausada asigna; la pausa de un bloqueo o de un contacto oculto del CRM no", async () => {
  assert.equal((await porTurno(chat("ia1", [...COMIENZO, IN("hola")], { automationPaused: true }))).asignada, true);
  const bloqueado = { metadata: null, bloqueadoEn: new Date(), excludedFromCrm: true };
  assert.equal((await porTurno(chat("ia2", [...COMIENZO, IN("hola")], { automationPaused: true, contact: bloqueado }))).asignada, false);
});

await prueba("con (b) apagado, 'cuánto vale' no asigna; con (a) apagado, la nota del agente no asigna", async () => {
  await configurar({ clientaPreguntaPlataOEntrega: false });
  assert.equal((await porTurno(chat("b1", [...CON_FOTOS, IN("cuánto vale")]))).asignada, false);
  // (a) sigue prendido: la nota sí asigna.
  assert.equal((await porTurno(chat("b2", [...CON_FOTOS, IN("cuánto vale"), NOTA("El agente pide un asesor: x")]))).asignada, true);
  await configurar({ agentePide: false });
  assert.equal((await porTurno(chat("a1", [...COMIENZO, IN("hola"), NOTA("El agente pide un asesor: x")], { automationPaused: true }))).asignada, false);
  assert.equal((await porTurno(chat("a2", [...CON_FOTOS, IN("cuánto vale")]))).asignada, true);
});

await prueba("con comoAntes prendido, cualquier respuesta a la bienvenida asigna (hasta un 'ok')", async () => {
  await configurar({ comoAntes: true });
  assert.equal((await porTurno(chat("ca1", [...COMIENZO, IN("ok")]))).asignada, true);
  assert.equal((await porTurno(chat("ca2", [...COMIENZO, IN("Para el combo de estética")]))).asignada, true);
  // El primer mensaje de la clienta, sin respuesta nuestra antes, sigue sin asignar.
  assert.equal((await porTurno(chat("ca3", [IN(ANUNCIO)]))).asignada, false);
});

await prueba("un chat con asesora nunca cambia de dueña (por turno ni por rescate)", async () => {
  const id = chat("d1", [...CON_FOTOS, IN("cuánto vale"), NOTA("El agente pide un asesor: x")], { assignedToUserId: "ingrid", terminaHaceMin: 40 });
  assert.equal((await porTurno(id)).asignada, false);
  await configurar({ comoAntes: true });
  assert.equal((await porTurno(id)).asignada, false);
  await rescate.rescatarChatsHuerfanos(AHORA);
  assert.equal(estado.conversaciones.get(id).assignedToUserId, "ingrid");
  assert.deepEqual(estado.asignaciones, []);
});

await prueba("la línea administrativa no reparte por turno", async () => {
  const id = chat("adm", [...CON_FOTOS, IN("cuánto vale")], { channelId: "linea-admin" });
  assert.equal((await turno.repartirSiElTurnoLoAmerita({ conversationId: id, channelId: "linea-admin", workspaceId: "ws1" })).asignada, false);
});

// ── 4. El rescate respeta la regla ──────────────────────────────────────────────────────────────
await prueba("rescate (48 h, el bot habló último): asigna lo que la regla pide y deja lo demás", async () => {
  chat("r-combo", [...COMIENZO, IN("Para el combo de estética"), BOT("¡Genial! ¿Te mando las fotos?")]);
  chat("r-precio", [...CON_FOTOS, IN("cuánto vale"), BOT("Te cuento…")]);
  chat("r-nota", [...COMIENZO, IN("Quiropodia"), NOTA("El agente pide un asesor: x"), BOT("Ya te paso con alguien")]);
  chat("r-ok", [...CON_FOTOS, IN("ok"), BOT("¡Perfecto!")]);
  await rescate.rescatarChatsHuerfanos(AHORA);
  assert.deepEqual(estado.asignaciones.sort(), ["r-nota", "r-precio"]);
});

await prueba("rescate de los 30 min: un 'ok' sin respuesta del bot ya no se pasa a una asesora", async () => {
  chat("m-ok", [...CON_FOTOS, IN("ok gracias")], { terminaHaceMin: 40 });
  chat("m-combo", [...COMIENZO, IN("Para el combo de estética")], { terminaHaceMin: 40 });
  chat("m-precio", [...COMIENZO, IN("¿hacen contraentrega?")], { terminaHaceMin: 40, automationPaused: false });
  chat("m-fotos-precio", [...CON_FOTOS, IN("¿hacen contraentrega?")], { terminaHaceMin: 40 });
  await rescate.rescatarChatsHuerfanos(AHORA);
  assert.deepEqual(estado.asignaciones, ["m-fotos-precio"]);
});

await prueba("rescate de los 30 min: si NUNCA le contestamos (el bot falló del todo), la red sigue", async () => {
  chat("m-nadie", [IN(ANUNCIO), IN("hola?")], { terminaHaceMin: 40 });
  await rescate.rescatarChatsHuerfanos(AHORA);
  assert.deepEqual(estado.asignaciones, ["m-nadie"]);
});

await prueba("rescate con (b) apagado no asigna por 'cuánto vale'; con comoAntes vuelve la regla del 30-10", async () => {
  chat("x-precio", [...CON_FOTOS, IN("cuánto vale"), BOT("Te cuento…")]);
  chat("x-ok", [...COMIENZO, IN("ok"), BOT("¡Perfecto!")], { terminaHaceMin: 3 });
  await configurar({ clientaPreguntaPlataOEntrega: false });
  await rescate.rescatarChatsHuerfanos(AHORA);
  assert.deepEqual(estado.asignaciones, []);
  await configurar({ comoAntes: true });
  await rescate.rescatarChatsHuerfanos(AHORA);
  assert.deepEqual(estado.asignaciones.sort(), ["x-ok", "x-precio"]);
});

// ── 5. La asesora que escribe (interruptor c) y el aviso del agente (interruptor a) — parte 2 ──
const escribe = (id, userId, source = "agent") => toma.claimConversationIfUnassigned({ source, conversationId: id, workspaceId: "ws1", userId });
const avisoDelAgente = (id) => agentePide.asignarPorqueElAgentePide({ conversationId: id, channelId: "linea-ventas", workspaceId: "ws1" });

await prueba("toma: con (c) prendido, la asesora que escribe en un chat sin dueña se lo queda (Ventas 1 y Ventas 2)", async () => {
  chat("t1", [...COMIENZO, IN("hola")]);
  chat("t2", [...COMIENZO, IN("hola")], { channelId: "linea-ventas-2" });
  await escribe("t1", "asesora-ventas-1");
  await escribe("t2", "asesora-ventas-2");
  assert.equal(estado.conversaciones.get("t1").assignedToUserId, "asesora-ventas-1");
  assert.equal(estado.conversaciones.get("t2").assignedToUserId, "asesora-ventas-2");
  // La API oficial, igual.
  chat("t3", [...COMIENZO, IN("hola")]);
  await escribe("t3", "asesora-ventas-1", "official");
  assert.equal(estado.conversaciones.get("t3").assignedToUserId, "asesora-ventas-1");
});

await prueba("toma: con (c) apagado, escribir no asigna (ni en Evolution ni en la API oficial)", async () => {
  await configurar({ asesoraEscribe: false });
  chat("t4", [...COMIENZO, IN("hola")]);
  await escribe("t4", "asesora-ventas-1");
  await escribe("t4", "asesora-ventas-2", "official");
  assert.equal(estado.conversaciones.get("t4").assignedToUserId, null);
  await configurar({ asesoraEscribe: true });
  await escribe("t4", "asesora-ventas-2");
  assert.equal(estado.conversaciones.get("t4").assignedToUserId, "asesora-ventas-2");
});

await prueba("toma: un chat ya asignado no cambia de dueña al escribir otra, ni el segundo asesor la pisa", async () => {
  chat("t5", [...COMIENZO, IN("hola")], { assignedToUserId: "ingrid", segundoAsesorId: "camila" });
  await escribe("t5", "asesora-ventas-2");
  await escribe("t5", "camila");
  assert.equal(estado.conversaciones.get("t5").assignedToUserId, "ingrid");
  assert.equal(estado.conversaciones.get("t5").segundoAsesorId, "camila");
});

await prueba("aviso del agente: con (a) prendido asigna (aunque no haya aviso por WhatsApp); con (a) apagado no", async () => {
  chat("v1", [...COMIENZO, IN("Quiropodia")]);
  assert.equal(await avisoDelAgente("v1"), "asesora-de-turno");
  assert.deepEqual(estado.asignaciones, ["v1"]);
  await configurar({ agentePide: false });
  chat("v2", [...COMIENZO, IN("Quiropodia")]);
  assert.equal(await avisoDelAgente("v2"), null);
  assert.equal(estado.conversaciones.get("v2").assignedToUserId, null);
  assert.deepEqual(estado.asignaciones, ["v1"]);
});

await prueba("aviso del agente: un chat con asesora no cambia", async () => {
  chat("v3", [...COMIENZO, IN("Quiropodia")], { assignedToUserId: "ingrid" });
  assert.equal(await avisoDelAgente("v3"), null);
  assert.equal(estado.conversaciones.get("v3").assignedToUserId, "ingrid");
  assert.deepEqual(estado.asignaciones, []);
});

console.log(`\n${pruebas} pruebas ok`);

// ── 6. Antes y después ──────────────────────────────────────────────────────────────────────────
/*
  Cinco chats escritos a mano, sin teléfono ni nombre, con la forma de los chats de ventas de hoy
  (el primero es el de "Para el combo de estética"). Esta sesión no puede leer chats reales (no usa
  el MCP); para comparar con chats de verdad, leerlos con `ver_conversacion` del MCP y copiarlos aquí
  sin teléfono ni nombre.

  Para cada chat se pregunta, mensaje por mensaje, si ya se asignaría: la regla vieja es la del
  30-10 (`comoAntes`: responder la bienvenida) y la nueva es la de hoy con los valores por defecto.
*/
const CASOS = [
  {
    nombre: "Combo de estética",
    mensajes: [IN(ANUNCIO), BOT(BIENVENIDA), BOT(SERVICIOS), IN("Para el combo de estética"), FOTO(), BOT("Te mando las fotos con el precio"), IN("Qué lindo"), IN("cuánto vale con envío?")],
  },
  {
    nombre: "Pregunta precio de entrada",
    mensajes: [IN("Precio del tocador?"), BOT(BIENVENIDA), BOT(SERVICIOS), IN("uñas"), FOTO(), IN("ok")],
  },
  {
    nombre: "Agente pide asesora",
    mensajes: [IN(ANUNCIO), BOT(BIENVENIDA), IN("Quiropodia"), NOTA("El agente pide un asesor: no pudo redactar una respuesta")],
  },
  {
    nombre: "Dice su ciudad",
    mensajes: [IN(ANUNCIO), BOT(BIENVENIDA), IN("masajes"), FOTO(), BOT("¿En qué ciudad estás?"), IN("soy de Medellín")],
  },
  {
    nombre: "Solo mira",
    mensajes: [IN(ANUNCIO), BOT(BIENVENIDA), IN("ok"), FOTO(), IN("gracias")],
  },
];

const enQueMensaje = (mensajes, config) => {
  for (let i = 1; i <= mensajes.length; i += 1) {
    const hasta = mensajes.slice(0, i).map((m, j) => ({ ...m, createdAt: new Date(Date.UTC(2026, 10, 19, 15, j)) }));
    if (rcn.elChatNecesitaAsesora({ mensajes: hasta, config })) return `#${i} "${(mensajes[i - 1].content ?? mensajes[i - 1].type).slice(0, 28)}"`;
  }
  return "no se asigna";
};

console.log("\nAntes y después (en qué mensaje se asigna el chat):");
const filas = CASOS.map((c) => ({
  chat: c.nombre,
  "regla vieja": enQueMensaje(c.mensajes, { comoAntes: true }),
  "regla nueva": enQueMensaje(c.mensajes, {}),
}));
console.table(filas);
// Lo que la tabla tiene que mostrar: la regla nueva nunca asigna antes que la vieja en el caso del combo.
assert.equal(filas[0]["regla nueva"].startsWith("#8"), true);
assert.equal(filas[4]["regla nueva"], "no se asigna");
