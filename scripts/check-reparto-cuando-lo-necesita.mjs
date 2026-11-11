// Pruebas de "ASIGNAR SOLO CUANDO EL CHAT NECESITA ASESORA" (Alex, 11-11-2026):
// src/lib/reparto-cuando-lo-necesita.ts, el reparto por turno (src/lib/reparto-por-turno.ts) y el
// rescate de chats huérfanos (src/lib/rescate-de-chats-huerfanos.ts). Sin base ni red: base simulada.
// Correr: npm run test:reparto-cuando-lo-necesita
import assert from "node:assert/strict";

import { cargar } from "./supervisor-cargar.mjs";

// ── Base simulada ────────────────────────────────────────────────────────────────────────────────
const estado = { settings: new Map(), conversaciones: new Map(), canales: new Map(), mensajes: [], asignaciones: [] };

function reiniciar() {
  estado.settings = new Map();
  estado.conversaciones = new Map();
  estado.canales = new Map([
    ["ventas", { purpose: "SALES" }],
    ["admin", { purpose: "ADMIN" }],
  ]);
  estado.mensajes = [];
  estado.asignaciones = [];
}

const cumpleFecha = (valor, filtro) =>
  !filtro || ((!filtro.gte || valor >= filtro.gte) && (!filtro.lte || valor <= filtro.lte));

function cumpleMensaje(m, where = {}) {
  const id = where.conversationId;
  if (typeof id === "string" && m.conversationId !== id) return false;
  if (id?.in && !id.in.includes(m.conversationId)) return false;
  if (typeof where.type === "string" && m.type !== where.type) return false;
  if (where.type?.not && m.type === where.type.not) return false;
  if (where.direction && m.direction !== where.direction) return false;
  if (where.deletedAt === null && m.deletedAt) return false;
  if (!cumpleFecha(m.createdAt, where.createdAt)) return false;
  if (where.content?.startsWith) {
    const a = (m.content ?? "").toLowerCase();
    if (!a.startsWith(where.content.startsWith.toLowerCase())) return false;
  }
  return true;
}

function buscarMensajes({ where, orderBy, take }) {
  let filas = estado.mensajes.filter((m) => cumpleMensaje(m, where));
  if (orderBy?.createdAt) {
    filas.sort((a, b) => (orderBy.createdAt === "desc" ? b.createdAt - a.createdAt : a.createdAt - b.createdAt));
  }
  if (take) filas = filas.slice(0, take);
  return filas.map((m) => ({ ...m }));
}

const prisma = {
  appSetting: {
    findUnique: async ({ where }) => (estado.settings.has(where.key) ? { value: estado.settings.get(where.key) } : null),
    upsert: async ({ where, create, update }) => {
      estado.settings.set(where.key, estado.settings.has(where.key) ? update.value : create.value);
      return {};
    },
  },
  conversation: {
    findUnique: async ({ where }) => {
      const c = estado.conversaciones.get(where.id);
      return c ? { ...c } : null;
    },
    findMany: async ({ where, take }) => {
      const filas = [...estado.conversaciones.values()].filter(
        (c) =>
          (where.assignedToUserId !== null || !c.assignedToUserId) &&
          !(where.status?.notIn ?? []).includes(c.status) &&
          (!where.channel?.is?.purpose || estado.canales.get(c.channelId)?.purpose === where.channel.is.purpose) &&
          cumpleFecha(c.lastMessageAt, where.lastMessageAt),
      );
      filas.sort((a, b) => b.lastMessageAt - a.lastMessageAt);
      return filas.slice(0, take ?? filas.length).map((c) => ({ ...c, contact: { metadata: c.metadata ?? null } }));
    },
  },
  whatsAppChannel: { findUnique: async ({ where }) => estado.canales.get(where.id) ?? null },
  message: {
    findMany: async (q) => buscarMensajes(q),
    findFirst: async (q) => buscarMensajes({ ...q, take: 1 })[0] ?? null,
    groupBy: async ({ where, _min, _max }) => {
      const grupos = new Map();
      for (const m of buscarMensajes({ where })) {
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
    autoAssignConversationToCollaborator: async ({ conversationId }) => {
      const c = estado.conversaciones.get(conversationId);
      if (!c || c.assignedToUserId) return null;
      c.assignedToUserId = "asesora-de-turno";
      estado.asignaciones.push(conversationId);
      return c.assignedToUserId;
    },
  },
};

const regla = cargar("src/lib/reparto-cuando-lo-necesita.ts", mocks);
const turno = cargar("src/lib/turno-con-contenido.ts", mocks);
const { repartirSiElTurnoLoAmerita } = cargar("src/lib/reparto-por-turno.ts", mocks);
const { rescatarChatsHuerfanos } = cargar("src/lib/rescate-de-chats-huerfanos.ts", mocks);

let pruebas = 0;
async function prueba(nombre, fn) {
  reiniciar();
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

// ── Chats de mentira ─────────────────────────────────────────────────────────────────────────────
const WS = "ws-1";
const AHORA = new Date(Date.UTC(2026, 10, 11, 18, 0));
const IN = (content, type = "TEXT") => ({ direction: "INBOUND", type, content });
const BOT = (content, type = "TEXT") => ({ direction: "OUTBOUND", type, content });
const NOTA = (content) => ({ direction: "OUTBOUND", type: "SYSTEM", content });

const ANUNCIO = "Hola, me interesa el *COMBO* de estética (camilla, escalera, silla y auxiliar)";
const BIENVENIDA = "Bienvenid@ a *Magilus* 👑 Fabricantes de mobiliario para peluquerías, barbería, spa y salones de belleza.";
const SERVICIOS = "¿Qué servicios vas a ofrecer en tu espacio - *masajes, estética facial, tratamientos corporales*?";

/** Crea un chat con sus mensajes (del más viejo al más nuevo, uno por minuto, terminando `haceMin` antes de AHORA). */
function crearChat(id, mensajes, { asesora = null, canal = "ventas", pausada = false, haceMin = 1 } = {}) {
  const fin = AHORA.getTime() - haceMin * 60_000;
  mensajes.forEach((m, i) => {
    estado.mensajes.push({
      conversationId: id,
      deletedAt: null,
      ...m,
      createdAt: new Date(fin - (mensajes.length - 1 - i) * 60_000),
    });
  });
  estado.conversaciones.set(id, {
    id,
    channelId: canal,
    workspaceId: WS,
    assignedToUserId: asesora,
    automationPaused: pausada,
    status: "OPEN",
    lastMessageAt: new Date(fin),
  });
}

const repartir = (id, canal = "ventas") => repartirSiElTurnoLoAmerita({ conversationId: id, channelId: canal, workspaceId: WS });
const config = (cambios = {}) => regla.guardarConfigDeAsignacion(WS, cambios);
const conRegla = (mensajes, cambios = {}, extra = {}) =>
  regla.elChatNecesitaAsesora({
    mensajes,
    config: { ...regla.CONFIG_DE_ASIGNACION_POR_DEFECTO, ...cambios },
    agentePidioAsesor: false,
    iaPausada: false,
    ...extra,
  });

/* 1. El detector */
await prueba("hablaDePlataOEntrega: precio, pago, envío, contraentrega y ciudad SÍ", () => {
  for (const texto of [
    "cuánto vale",
    "Cuanto Vale??",
    "CUÁNTO CUESTA EL COMBO",
    "qué precio tiene",
    "y el valor?",
    "¿hacen contraentrega?",
    "pago contra entrega?",
    "cómo pago",
    "por nequi se puede?",
    "hago transferencia",
    "hacen envíos a Pasto?",
    "envio",
    "soy de Medellín",
    "Vivo en santa marta",
    "Medellín",
    "Cali, Valle",
  ]) {
    assert.equal(regla.hablaDePlataOEntrega(texto), true, texto);
  }
});
await prueba("hablaDePlataOEntrega: 'Para el combo de estética', saludos, 'ok', 'masajes', vacío NO", () => {
  for (const texto of ["Para el combo de estética", "hola", "buenas tardes", "ok", "ok vale", "Masajes", "Para cejas y pestañas", "me envías fotos", "", null]) {
    assert.equal(regla.hablaDePlataOEntrega(texto), false, String(texto));
  }
});

/* 2. La configuración */
await prueba("config: por defecto a, b y c prendidos y comoAntes apagado; completa lo que falta", async () => {
  assert.deepEqual(await regla.leerConfigDeAsignacion("ws-sin-fila"), {
    agentePide: true,
    clientaPreguntaPlataOEntrega: true,
    asesoraEscribe: true,
    comoAntes: false,
  });
  assert.equal(regla.claveConfigDeAsignacion("ws9"), "reparto:cuando:ws9");
  assert.deepEqual(regla.leerConfigDeAsignacionDeTexto("{roto"), regla.CONFIG_DE_ASIGNACION_POR_DEFECTO);
  assert.deepEqual(regla.leerConfigDeAsignacionDeTexto("[1,2]"), regla.CONFIG_DE_ASIGNACION_POR_DEFECTO);
  assert.deepEqual(regla.leerConfigDeAsignacionDeTexto('{"comoAntes": true, "agentePide": "x"}'), {
    ...regla.CONFIG_DE_ASIGNACION_POR_DEFECTO,
    comoAntes: true,
  });
  assert.deepEqual(regla.leerConfigDeAsignacionDeTexto('{"clientaPreguntaPlataOEntrega": "false"}'), {
    ...regla.CONFIG_DE_ASIGNACION_POR_DEFECTO,
    clientaPreguntaPlataOEntrega: false,
  });
});
await prueba("config: guardar escribe JSON completo en AppSetting y limpia el caché de 60 s", async () => {
  assert.equal((await regla.leerConfigDeAsignacion(WS)).comoAntes, false);
  // Escribir directo en la base no se ve: está en el caché.
  estado.settings.set("reparto:cuando:ws-1", '{"comoAntes": true}');
  assert.equal((await regla.leerConfigDeAsignacion(WS)).comoAntes, false);
  const guardada = await config({ clientaPreguntaPlataOEntrega: false });
  assert.deepEqual(JSON.parse(estado.settings.get("reparto:cuando:ws-1")), guardada);
  assert.deepEqual(await regla.leerConfigDeAsignacion(WS), { ...regla.CONFIG_DE_ASIGNACION_POR_DEFECTO, clientaPreguntaPlataOEntrega: false });
  await config({});
});

/* 3. El reparto por turno */
await prueba("'Para el combo de estética' tras la bienvenida: NO asigna", async () => {
  await config({});
  crearChat("c1", [IN(ANUNCIO), BOT(BIENVENIDA), BOT(SERVICIOS), IN("Para el combo de estética"), BOT("¡Perfecto! ¿Te comparto fotos?")]);
  assert.deepEqual(await repartir("c1"), { asignada: false });
  assert.equal(estado.conversaciones.get("c1").assignedToUserId, null);
});
await prueba("'cuánto vale', '¿hacen contraentrega?', 'cómo pago', 'soy de Medellín': SÍ asignan", async () => {
  await config({});
  for (const [i, texto] of ["cuánto vale", "¿hacen contraentrega?", "cómo pago", "soy de Medellín"].entries()) {
    const id = `c-si-${i}`;
    crearChat(id, [IN(ANUNCIO), BOT(BIENVENIDA), IN(texto), BOT("Claro, ya te cuento")]);
    assert.deepEqual(await repartir(id), { asignada: true }, texto);
  }
});
await prueba("la nota 'El agente pide un asesor' SÍ asigna; la IA pausada también", async () => {
  await config({});
  crearChat("c-nota", [IN(ANUNCIO), BOT(BIENVENIDA), IN("Masajes"), NOTA("El agente pide un asesor: quiere cotizar 3 camillas")]);
  assert.deepEqual(await repartir("c-nota"), { asignada: true });
  crearChat("c-pausa", [IN(ANUNCIO), BOT(BIENVENIDA), IN("Masajes")], { pausada: true });
  assert.deepEqual(await repartir("c-pausa"), { asignada: true });
  // Otra nota del sistema no cuenta.
  crearChat("c-otra-nota", [IN(ANUNCIO), BOT(BIENVENIDA), IN("Masajes"), NOTA("Chat asignado a Yair")]);
  assert.deepEqual(await repartir("c-otra-nota"), { asignada: false });
});
await prueba("con (a) apagado, la nota del agente y la IA pausada no asignan", async () => {
  await config({ agentePide: false });
  crearChat("c-a", [IN(ANUNCIO), BOT(BIENVENIDA), IN("Masajes"), NOTA("El agente pide un asesor: x")], { pausada: true });
  assert.deepEqual(await repartir("c-a"), { asignada: false });
  await config({});
});
await prueba("con (b) apagado, 'cuánto vale' no asigna", async () => {
  await config({ clientaPreguntaPlataOEntrega: false });
  crearChat("c-b", [IN(ANUNCIO), BOT(BIENVENIDA), IN("cuánto vale")]);
  assert.deepEqual(await repartir("c-b"), { asignada: false });
  await config({});
});
await prueba("con comoAntes prendido, cualquier respuesta a la bienvenida asigna (hasta 'ok')", async () => {
  await config({ comoAntes: true, agentePide: false, clientaPreguntaPlataOEntrega: false });
  for (const [i, texto] of ["ok", "Para el combo de estética", "Masajes"].entries()) {
    const id = `c-antes-${i}`;
    crearChat(id, [IN(ANUNCIO), BOT(BIENVENIDA), IN(texto)]);
    assert.deepEqual(await repartir(id), { asignada: true }, texto);
  }
  // El primer mensaje del lead sigue sin asignar, igual que antes.
  crearChat("c-antes-primero", [IN("cuánto vale el combo")]);
  assert.deepEqual(await repartir("c-antes-primero"), { asignada: false });
  await config({});
});
await prueba("un chat con asesora nunca cambia de dueña (ni con comoAntes)", async () => {
  for (const cambios of [{}, { comoAntes: true }]) {
    await config(cambios);
    const id = `c-duena-${cambios.comoAntes ? "antes" : "nueva"}`;
    crearChat(id, [IN(ANUNCIO), BOT(BIENVENIDA), IN("cuánto vale"), NOTA("El agente pide un asesor: precio")], { asesora: "maria", pausada: true });
    assert.deepEqual(await repartir(id), { asignada: false });
    assert.equal(estado.conversaciones.get(id).assignedToUserId, "maria");
  }
  assert.deepEqual(estado.asignaciones, []);
  await config({});
});
await prueba("la línea administrativa no reparte, aunque pregunte el precio", async () => {
  await config({});
  crearChat("c-admin", [IN("hola"), BOT("Buenas"), IN("cuánto vale")], { canal: "admin" });
  assert.deepEqual(await repartir("c-admin", "admin"), { asignada: false });
});

/* 4. El rescate */
await prueba("rescate (48 h): 'Para el combo de estética' no se rescata; 'cuánto vale' y la nota sí", async () => {
  await config({});
  crearChat("r-combo", [IN(ANUNCIO), BOT(BIENVENIDA), IN("Para el combo de estética"), BOT("¿Te comparto fotos?")], { haceMin: 5 });
  crearChat("r-precio", [IN(ANUNCIO), BOT(BIENVENIDA), IN("cuánto vale"), BOT("Ya te digo")], { haceMin: 5 });
  crearChat("r-nota", [IN(ANUNCIO), BOT(BIENVENIDA), IN("Masajes"), NOTA("El agente pide un asesor: cotización"), BOT("Ya te contacta una asesora")], { haceMin: 5 });
  const r = await rescatarChatsHuerfanos(AHORA);
  assert.equal(r.repartidos, 2);
  assert.deepEqual(estado.asignaciones.sort(), ["r-nota", "r-precio"]);
  assert.equal(estado.conversaciones.get("r-combo").assignedToUserId, null);
});
await prueba("rescate (30 min): la clienta habló última y la regla dice que no: no se rescata", async () => {
  await config({});
  crearChat("r30-gracias", [IN(ANUNCIO), BOT(BIENVENIDA), BOT(SERVICIOS), IN("Para el combo de estética")], { haceMin: 40 });
  crearChat("r30-ciudad", [IN(ANUNCIO), BOT(BIENVENIDA), IN("soy de Medellín")], { haceMin: 40 });
  const r = await rescatarChatsHuerfanos(AHORA);
  assert.equal(r.repartidos, 1);
  assert.deepEqual(estado.asignaciones, ["r30-ciudad"]);
});
await prueba("rescate (30 min): si nadie le contestó nunca (el bot se cayó), se rescata igual", async () => {
  await config({});
  crearChat("r30-abandonado", [IN(ANUNCIO), IN("hola?")], { haceMin: 40 });
  const r = await rescatarChatsHuerfanos(AHORA);
  assert.deepEqual(estado.asignaciones, ["r30-abandonado"]);
  assert.equal(r.repartidos, 1);
});
await prueba("rescate con comoAntes: como antes (responder la bienvenida basta; la media hora rescata todo)", async () => {
  await config({ comoAntes: true });
  crearChat("ra-combo", [IN(ANUNCIO), BOT(BIENVENIDA), IN("Para el combo de estética"), BOT("¿Te comparto fotos?")], { haceMin: 5 });
  crearChat("ra-30", [IN(ANUNCIO), BOT(BIENVENIDA), BOT(SERVICIOS), IN("ok")], { haceMin: 40 });
  crearChat("ra-nada", [IN(ANUNCIO), BOT(BIENVENIDA)], { haceMin: 5 });
  await rescatarChatsHuerfanos(AHORA);
  assert.deepEqual(estado.asignaciones.sort(), ["ra-30", "ra-combo"]);
  await config({});
});
await prueba("rescate: los chats con asesora no se tocan", async () => {
  await config({});
  crearChat("r-duena-48", [IN(ANUNCIO), BOT(BIENVENIDA), IN("cuánto vale"), BOT("Ya te digo")], { asesora: "maria", haceMin: 5 });
  crearChat("r-duena-30", [IN(ANUNCIO), BOT(BIENVENIDA), IN("cuánto vale")], { asesora: "maria", haceMin: 40 });
  const r = await rescatarChatsHuerfanos(AHORA);
  assert.equal(r.repartidos, 0);
  assert.equal(estado.conversaciones.get("r-duena-48").assignedToUserId, "maria");
  assert.equal(estado.conversaciones.get("r-duena-30").assignedToUserId, "maria");
});

/* 5. La regla pura, en los casos de "ok" de antes */
await prueba("'ok' tras la bienvenida: con la regla nueva no asigna; con comoAntes sí", () => {
  const c = [IN(ANUNCIO), BOT(BIENVENIDA), IN("ok")];
  assert.equal(conRegla(c), false);
  assert.equal(conRegla(c, { comoAntes: true }), true);
  assert.equal(turno.respondioLaBienvenida(c), true);
});

/* 6. Antes y después: 5 casos de texto anónimo (sin teléfono ni nombre). */
const CASOS = [
  {
    caso: "Para el combo de estética",
    mensajes: [IN(ANUNCIO), BOT(BIENVENIDA), BOT(SERVICIOS), IN("Para el combo de estética"), BOT("¿Te comparto fotos?"), IN("sí porfa"), BOT("", "IMAGE"), IN("cuánto vale?")],
  },
  {
    caso: "Pregunta el precio de una vez",
    mensajes: [IN(ANUNCIO), BOT(BIENVENIDA), IN("cuánto cuesta la camilla"), BOT("Está en $450.000")],
  },
  {
    caso: "Solo dice 'ok' y se va",
    mensajes: [IN(ANUNCIO), BOT(BIENVENIDA), IN("ok"), BOT(SERVICIOS)],
  },
  {
    caso: "Masajes y luego la ciudad",
    mensajes: [IN(ANUNCIO), BOT(BIENVENIDA), BOT(SERVICIOS), IN("Masajes"), BOT("¡Perfecto! ¿En qué ciudad estás?"), IN("Cali")],
  },
  {
    caso: "Pide cotización y el agente pasa a asesora",
    mensajes: [IN(ANUNCIO), BOT(BIENVENIDA), IN("necesito 3 camillas para mi spa"), BOT("¡Claro!"), NOTA("El agente pide un asesor: cotización de varias unidades")],
  },
];

/** En qué mensaje (1, 2, …) se asigna por primera vez con cada regla; null = no se asigna. */
function primerMensajeQueAsigna(mensajes, decide) {
  for (let n = 1; n <= mensajes.length; n += 1) {
    const hasta = mensajes.slice(0, n);
    const sinNotas = hasta.filter((m) => m.type !== "SYSTEM");
    const pidio = regla.agentePidioAsesorEnNotas(hasta.filter((m) => m.type === "SYSTEM").map((m) => m.content));
    if (decide(sinNotas, pidio)) return n;
  }
  return null;
}

const tabla = CASOS.map(({ caso, mensajes }) => {
  const vieja = primerMensajeQueAsigna(mensajes, (m) => turno.respondioLaBienvenida(m));
  const nueva = primerMensajeQueAsigna(mensajes, (m, pidio) => conRegla(m, {}, { agentePidioAsesor: pidio }));
  const describir = (n) => (n == null ? "no asigna" : `mensaje ${n}: «${(mensajes[n - 1].content || mensajes[n - 1].type).slice(0, 40)}»`);
  return { caso, "regla vieja": describir(vieja), "regla nueva": describir(nueva), vieja, nueva };
});
await prueba("antes y después: la regla nueva nunca asigna antes que la vieja, y el combo espera al precio", () => {
  for (const fila of tabla) {
    if (fila.nueva != null && fila.vieja != null) assert.ok(fila.nueva >= fila.vieja, fila.caso);
  }
  assert.equal(tabla[0].vieja, 4);
  assert.equal(tabla[0].nueva, 8);
  assert.equal(tabla[2].nueva, null);
});

console.log(`\n${pruebas} pruebas ok\n`);
console.log("Antes y después (5 casos de texto anónimo):");
console.table(tabla.map(({ caso, "regla vieja": vieja, "regla nueva": nueva }) => ({ caso, "regla vieja": vieja, "regla nueva": nueva })));
