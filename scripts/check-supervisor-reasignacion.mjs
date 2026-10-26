// Pruebas de los AVISOS POR WHATSAPP Y LA REASIGNACIÓN AUTOMÁTICA (src/features/supervisor-reasignacion).
// Reglas puras + el vigilante con una base de mentira y un reloj simulado (sin red ni base real).
// Correr: npm run test:supervisor-reasignacion
import assert from "node:assert/strict";
import { cargar } from "./supervisor-cargar.mjs";

/* ------------------------------------------------------------------ base, envíos y chats simulados */

const M = 60_000;
const H = 60 * M;
const WS = "ws1";
const ADMIN = "cmt06kiob00lw2hk2mgllstsb";

const settings = new Map();
let avisosDb = [];
let chatsDb = []; // los ChatAbierto que "lee" el Supervisor
let asignadas = new Map(); // conversationId -> asesora (la verdad de la base)
const enviados = { whatsapp: [], push: [], pushAsignacion: [], actividad: [] };
let lineaEsAdmin = true;
let colaboradoras = ["ingrid", "maria", "laura"];
let numerosDeAvisos = { ingrid: "573001110001", maria: "573001110002", laura: "573001110003" };
let mensajesSalientes = []; // para "ya contestó"
const NOMBRES = { ingrid: "Ingrid Sanchez", maria: "Maria Bautista", laura: "Laura Gómez" };

const prisma = {
  appSetting: {
    findUnique: async ({ where }) => (settings.has(where.key) ? { key: where.key, value: settings.get(where.key) } : null),
    findMany: async ({ where }) =>
      [...settings.entries()].filter(([k]) => k.startsWith(where.key.startsWith)).map(([key, value]) => ({ key, value })),
    upsert: async ({ where, create, update }) => {
      settings.set(where.key, settings.has(where.key) ? update.value : create.value);
      return {};
    },
  },
  supervisorAviso: {
    create: async ({ data }) => {
      if (avisosDb.some((f) => f.conversationId === data.conversationId && f.tipo === data.tipo && f.episodio === data.episodio)) {
        throw Object.assign(new Error("Unique constraint"), { code: "P2002" });
      }
      const fila = { id: `a${avisosDb.length + 1}`, whatsappEnviado: false, error: null, creadoEn: new Date(), ...data };
      avisosDb.push(fila);
      return { id: fila.id };
    },
    findMany: async ({ where }) => avisosDb.filter((f) => f.workspaceId === where.workspaceId && where.conversationId.in.includes(f.conversationId)),
    update: async ({ where, data }) => {
      Object.assign(avisosDb.find((f) => f.id === where.id), data);
      return {};
    },
  },
  conversation: {
    findMany: async ({ where }) => where.id.in.map((id, i) => ({ id, numero: 4000 + Number(id.replace(/\D/g, "") || i), channelId: "ventas" })),
    updateMany: async ({ where, data }) => {
      if (asignadas.get(where.id) !== where.assignedToUserId) return { count: 0 };
      asignadas.set(where.id, data.assignedToUserId);
      const c = chatsDb.find((x) => x.conversationId === where.id);
      if (c) c.asesoraId = data.assignedToUserId;
      return { count: 1 };
    },
  },
  whatsAppChannel: {
    findFirst: async ({ where }) => {
      if (where.purpose === "ADMIN") return where.id === ADMIN && lineaEsAdmin ? { evolutionInstanceName: "admin" } : null;
      return { metadata: {} };
    },
  },
  workspaceMember: { findMany: async ({ where }) => where.userId.in.map((userId) => ({ userId })) },
  user: { findUnique: async ({ where }) => ({ name: NOMBRES[where.id] ?? where.id, email: null }) },
  message: { findMany: async () => mensajesSalientes },
};

const mocks = {
  "@/lib/prisma": { prisma },
  "@/lib/channel-collaborators": { calcularReparto: () => colaboradoras },
  "@/lib/en-linea": { filtrarSinPausaManual: async (_w, ids) => new Set(ids) },
  "@/lib/horario-de-reparto": { filtrarPorHorario: async (_w, ids) => ids },
  "@/lib/conversation-activity": { recordConversationActivity: async (a) => void enviados.actividad.push(a) },
  "@/lib/realtime-notify": { notifyRealtimeUpdate: async () => {} },
  "@/lib/reparto-de-leads": { avisarAsignacionPorPush: async (a) => void enviados.pushAsignacion.push(a) },
  "@/lib/web-push": {
    sendPushToUser: async ({ userId, payload }) => {
      enviados.push.push({ userId, ...payload });
      return 1;
    },
  },
  "@/lib/evolution": {
    sendEvolutionTextMessageWithReconnect: async ({ instanceName, phoneNumber, text }) => {
      enviados.whatsapp.push({ instanceName, phoneNumber, text });
    },
  },
  "@/features/avisos-gravedad/servicios/enrutador": {
    leerConfigGravedad: async () => ({}),
    numeroDeAvisosDeLaPersona: async (_w, userId) => numerosDeAvisos[userId] ?? null,
    pushAAlexander: async (_w, _c, payload) => {
      enviados.push.push({ userId: "alexander", ...payload });
      return 1;
    },
  },
  "@/features/supervisor/servicios/datos": { leerChatsAbiertos: async () => chatsDb },
};

const r = cargar("src/features/supervisor-reasignacion/dominio/reglas.ts", mocks);
const vigilante = cargar("src/features/supervisor-reasignacion/servicios/vigilante.ts", mocks);
const registro = cargar("src/features/supervisor-reasignacion/servicios/registro.ts", mocks);

let pruebas = 0;
async function prueba(nombre, fn) {
  reiniciar();
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

// Martes 6-oct-2026 10:00 Bogotá = 15:00 UTC (en horario laboral).
const T0 = new Date("2026-10-06T15:00:00Z");
const mas = (fecha, min) => new Date(fecha.getTime() + min * M);

function chat(extra = {}) {
  return {
    conversationId: "c1",
    asesoraId: "ingrid",
    etapa: "PROPUESTA",
    ultimoClienteEn: T0,
    ultimaRespuestaHumanaEn: null,
    textosPendientes: ["cómo hago para separar el combo"],
    textosDelCliente: ["hola", "cómo hago para separar el combo"],
    telefono: "573001234567",
    nombreCliente: "Laura Pérez",
    asignadaEn: null,
    ...extra,
  };
}

function reiniciar(config = { avisosActivo: true, reasignacionActiva: true }) {
  settings.clear();
  settings.set(`supervisor:reasignacion:${WS}`, JSON.stringify(config));
  avisosDb = [];
  chatsDb = [chat()];
  asignadas = new Map([["c1", "ingrid"]]);
  enviados.whatsapp = [];
  enviados.push = [];
  enviados.pushAsignacion = [];
  enviados.actividad = [];
  lineaEsAdmin = true;
  colaboradoras = ["ingrid", "maria", "laura"];
  numerosDeAvisos = { ingrid: "573001110001", maria: "573001110002", laura: "573001110003" };
  mensajesSalientes = [];
}

// La config se cachea 1 min con el reloj de verdad; para las pruebas se lee siempre del texto.
const configCache = cargar("src/features/supervisor-reasignacion/servicios/config.ts", mocks);
const vuelta = async (ahora) => {
  // sin caché: se reinicia el módulo de config llamando a guardar (que la borra)
  await configCache.guardarConfigReasignacion(WS, r.leerConfigDeTexto(settings.get(`supervisor:reasignacion:${WS}`)));
  return vigilante.vigilarNegocio(WS, ahora);
};

/* ------------------------------------------------------------------ reglas puras */

await prueba("minutos laborales: cuenta de a minuto y solo en horario", () => {
  const h = r.CONFIG_POR_DEFECTO.horario;
  assert.equal(r.minutosLaboralesExactos(T0, mas(T0, 5), h), 5);
  assert.equal(r.minutosLaboralesExactos(T0, mas(T0, 29), h), 29);
  // Sábado 10-oct 19:00 Bogotá (00:00 UTC del domingo) hasta lunes 12-oct 08:05 Bogotá: solo cuentan los 5 min del lunes.
  assert.equal(r.minutosLaboralesExactos(new Date("2026-10-11T00:00:00Z"), new Date("2026-10-12T13:05:00Z"), h), 5);
  // Domingo entero: 0.
  assert.equal(r.minutosLaboralesExactos(new Date("2026-10-11T13:00:00Z"), new Date("2026-10-11T23:00:00Z"), h), 0);
  // Cruza el cierre: de 17:50 a 18:00 cuentan 10 min.
  assert.equal(r.minutosLaboralesExactos(new Date("2026-10-06T22:50:00Z"), new Date("2026-10-07T00:30:00Z"), h), 10);
});

await prueba("la config sin fila o con JSON roto deja todo apagado y con los tiempos de siempre", () => {
  for (const texto of [null, "", "{no es json"]) {
    const c = r.leerConfigDeTexto(texto);
    assert.equal(c.avisosActivo, false);
    assert.equal(c.reasignacionActiva, false);
    assert.equal(c.minutosAviso, 5);
    assert.equal(c.minutosReasignacion, 30);
    assert.equal(c.horasCaliente, 24);
    assert.equal(c.canalId, ADMIN);
  }
  const c = r.leerConfigDeTexto(JSON.stringify({ avisosActivo: true, minutosAviso: 5, minutosReasignacion: 15, horario: { desde: 9, hasta: 17, dias: [1, 2, 3] } }));
  assert.equal(c.minutosReasignacion, 15);
  assert.deepEqual(c.horario, { desde: 9, hasta: 17, dias: [1, 2, 3] });
  // La reasignación nunca antes que el aviso.
  assert.equal(r.leerConfigDeTexto(JSON.stringify({ minutosAviso: 10, minutosReasignacion: 3 })).minutosReasignacion, 11);
});

await prueba("elige a la asesora con menos pendientes y nunca a la actual", () => {
  const pend = new Map([["maria", 3], ["laura", 1], ["ingrid", 0]]);
  assert.equal(r.elegirAsesora(["ingrid", "maria", "laura"], pend, "ingrid"), "laura");
  assert.equal(r.elegirAsesora(["ingrid"], pend, "ingrid"), null);
});

await prueba("el teléfono sale tapado y el nombre se respeta", () => {
  assert.equal(r.etiquetaDelCliente("Laura Pérez", "573001234567"), "Laura Pérez");
  assert.equal(r.etiquetaDelCliente(null, "573001234567"), "•••• 4567");
  assert.equal(r.etiquetaDelCliente("+57 300 123 4567", "573001234567"), "•••• 4567");
});

await prueba("el conteo diario por asesora cuadra con el registro", () => {
  const filas = [
    { tipo: "AVISO", asesoraId: "ingrid", asesoraNuevaId: null },
    { tipo: "AVISO", asesoraId: "ingrid", asesoraNuevaId: null },
    { tipo: "REASIGNACION", asesoraId: "ingrid", asesoraNuevaId: "maria" },
    { tipo: "CALIENTE_24H", asesoraId: "maria", asesoraNuevaId: null },
    { tipo: "BOT_PIDIO_ASESORA", asesoraId: "maria", asesoraNuevaId: null },
    { tipo: "SIN_CANDIDATA", asesoraId: "ingrid", asesoraNuevaId: null },
  ];
  const conteo = Object.fromEntries(r.conteoPorAsesora(filas).map((c) => [c.asesoraId, c]));
  assert.equal(conteo.ingrid.avisos, 2);
  assert.equal(conteo.ingrid.reasignadosDeEllas, 1);
  assert.equal(conteo.maria.recibidos, 1);
  assert.equal(conteo.maria.caliente24h, 1);
  assert.equal(conteo.maria.botPidioAsesora, 1);
  assert.deepEqual(r.rangoDelDiaBogota("2026-10-06").desde, new Date("2026-10-06T05:00:00Z"));
});

/* ------------------------------------------------------------------ el vigilante */

await prueba("aviso a los 5 min (uno solo), reasignación a los 30 y nada más a los 31", async () => {
  await vuelta(mas(T0, 4));
  assert.equal(enviados.whatsapp.length, 0, "a los 4 min no pasa nada");

  await vuelta(mas(T0, 5));
  await vuelta(mas(T0, 5));
  await vuelta(mas(T0, 6));
  assert.equal(enviados.whatsapp.length, 1, "un solo aviso aunque la vuelta corra varias veces");
  assert.equal(enviados.whatsapp[0].phoneNumber, numerosDeAvisos.ingrid);
  assert.equal(enviados.whatsapp[0].instanceName, "admin");
  assert.match(enviados.whatsapp[0].text, /Laura Pérez/);
  assert.match(enviados.whatsapp[0].text, /Propuesta/);
  assert.match(enviados.whatsapp[0].text, /5 min esperando/);
  assert.match(enviados.whatsapp[0].text, /https:\/\/app\.aizenbot\.com\/c\/\d+/);
  assert.equal(asignadas.get("c1"), "ingrid", "a los 5 min todavía no se reasigna");

  await vuelta(mas(T0, 30));
  assert.equal(asignadas.get("c1"), "laura", "pasa a la de menos pendientes (empate: por id)");
  const nuevos = enviados.whatsapp.slice(1);
  assert.equal(nuevos.length, 2, "uno a la nueva y otro a la anterior");
  assert.deepEqual(nuevos.map((m) => m.phoneNumber).sort(), [numerosDeAvisos.ingrid, numerosDeAvisos.laura].sort());
  assert.match(nuevos.find((m) => m.phoneNumber === numerosDeAvisos.laura).text, /Te pasaron/);
  assert.match(nuevos.find((m) => m.phoneNumber === numerosDeAvisos.ingrid).text, /Pasé a otra asesora/);
  assert.equal(enviados.actividad.length, 1);
  assert.equal(enviados.actividad[0].kind, "assigned");
  assert.equal(enviados.actividad[0].assigneeUserId, "laura");
  assert.match(enviados.actividad[0].text, /asignado por el Supervisor/);

  const antes = enviados.whatsapp.length;
  await vuelta(mas(T0, 31));
  await vuelta(mas(T0, 45));
  assert.equal(enviados.whatsapp.length, antes, "a los 31 no se repite nada");
  assert.equal(asignadas.get("c1"), "laura", "no se vuelve a pasar por el mismo mensaje del cliente");
  assert.deepEqual(avisosDb.map((f) => f.tipo).sort(), ["AVISO", "REASIGNACION"]);
  assert.ok(avisosDb.every((f) => f.whatsappEnviado), "el registro marca que el WhatsApp salió");
});

await prueba("si la asesora contesta a los 20 min no hay reasignación", async () => {
  await vuelta(mas(T0, 5));
  chatsDb[0].ultimaRespuestaHumanaEn = mas(T0, 20);
  await vuelta(mas(T0, 30));
  await vuelta(mas(T0, 40));
  assert.equal(asignadas.get("c1"), "ingrid");
  assert.equal(avisosDb.filter((f) => f.tipo === "REASIGNACION").length, 0);
});

await prueba("si contestó justo ahora (ya hay un mensaje suyo) no se mueve", async () => {
  mensajesSalientes = [{ rawPayload: { source: "manual" } }];
  await vuelta(mas(T0, 30));
  assert.equal(asignadas.get("c1"), "ingrid");
  assert.equal(avisosDb.length, 0);
});

await prueba("fuera de horario no avisa ni reasigna, y el conteo arranca al abrir", async () => {
  // Sábado 10-oct 19:00 Bogotá: el cliente escribe.
  chatsDb = [chat({ ultimoClienteEn: new Date("2026-10-11T00:00:00Z") })];
  await vuelta(new Date("2026-10-11T00:30:00Z")); // sábado 19:30
  await vuelta(new Date("2026-10-11T15:00:00Z")); // domingo 10:00
  assert.equal(enviados.whatsapp.length, 0);
  assert.equal(avisosDb.length, 0);
  // Lunes 12-oct 08:04 → nada; 08:05 → aviso; 08:30 → reasignación.
  await vuelta(new Date("2026-10-12T13:04:00Z"));
  assert.equal(enviados.whatsapp.length, 0);
  await vuelta(new Date("2026-10-12T13:05:00Z"));
  assert.equal(enviados.whatsapp.length, 1);
  assert.equal(asignadas.get("c1"), "ingrid");
  await vuelta(new Date("2026-10-12T13:30:00Z"));
  assert.equal(asignadas.get("c1"), "laura");
});

await prueba("con la reasignación en 15 minutos el chat pasa a los 15", async () => {
  settings.set(`supervisor:reasignacion:${WS}`, JSON.stringify({ avisosActivo: true, reasignacionActiva: true, minutosReasignacion: 15 }));
  await vuelta(mas(T0, 14));
  assert.equal(asignadas.get("c1"), "ingrid");
  await vuelta(mas(T0, 15));
  assert.equal(asignadas.get("c1"), "laura");
});

await prueba("cada interruptor apaga solo su paso", async () => {
  reiniciar({ avisosActivo: false, reasignacionActiva: true });
  await vuelta(mas(T0, 5));
  assert.equal(enviados.whatsapp.length, 0, "sin avisos no hay aviso a los 5");
  await vuelta(mas(T0, 30));
  assert.equal(asignadas.get("c1"), "laura", "la reasignación sigue funcionando");

  reiniciar({ avisosActivo: true, reasignacionActiva: false });
  await vuelta(mas(T0, 5));
  assert.equal(enviados.whatsapp.length, 1);
  await vuelta(mas(T0, 60));
  assert.equal(asignadas.get("c1"), "ingrid", "sin reasignación el chat no se mueve");

  reiniciar({ avisosActivo: false, reasignacionActiva: false });
  await vuelta(mas(T0, 60));
  assert.equal(avisosDb.length, 0);
});

await prueba("Caliente: a las 23 h no avisa, a las 24 h sí y una sola vez", async () => {
  chatsDb = [chat({ etapa: "NEGOCIACION", ultimoClienteEn: mas(T0, -24 * 60 - 30), ultimaRespuestaHumanaEn: mas(T0, -23 * 60) })];
  await vuelta(T0);
  assert.equal(enviados.whatsapp.length, 0);
  await vuelta(mas(T0, 60));
  await vuelta(mas(T0, 61));
  await vuelta(mas(T0, 120));
  const calientes = avisosDb.filter((f) => f.tipo === "CALIENTE_24H");
  assert.equal(calientes.length, 1);
  assert.equal(enviados.whatsapp.length, 1);
  assert.match(enviados.whatsapp[0].text, /Caliente/);
});

await prueba("el bot pidió asesora y nadie contesta: el aviso sale a los 5 min", async () => {
  chatsDb = [chat({ turno: { de: "MAGILUS", motivo: "bot_pidio_asesora", detalle: null, ultimoClienteEn: T0, respondioEn: mas(T0, 0) } })];
  await vuelta(mas(T0, 4));
  assert.equal(enviados.whatsapp.length, 0);
  await vuelta(mas(T0, 5));
  assert.equal(enviados.whatsapp.length, 1);
  assert.deepEqual(avisosDb.map((f) => f.tipo), ["BOT_PIDIO_ASESORA"]);
});

await prueba("si el bot respondió y se espera al cliente, no hay aviso", async () => {
  chatsDb = [chat({ turno: { de: "CLIENTE", motivo: "respondio_el_bot", detalle: null, ultimoClienteEn: T0, respondioEn: mas(T0, 0) } })];
  await vuelta(mas(T0, 40));
  assert.equal(avisosDb.length, 0);
});

await prueba("una despedida del cliente no cuenta como sin respuesta", async () => {
  chatsDb = [chat({ textosPendientes: ["muchas gracias"], textosDelCliente: ["muchas gracias"] })];
  await vuelta(mas(T0, 40));
  assert.equal(avisosDb.length, 0);
});

await prueba("sin otra asesora disponible: el chat no se mueve, queda anotado y le llega a Alexander", async () => {
  colaboradoras = ["ingrid"];
  await vuelta(mas(T0, 30));
  await vuelta(mas(T0, 31));
  assert.equal(asignadas.get("c1"), "ingrid");
  assert.deepEqual(avisosDb.map((f) => f.tipo), ["SIN_CANDIDATA"]);
  assert.equal(enviados.push.filter((p) => p.userId === "alexander").length, 1, "un solo push al dueño");
});

await prueba("línea que no es administrativa o número que no está en la lista: no se manda nada", async () => {
  lineaEsAdmin = false;
  await vuelta(mas(T0, 5));
  assert.equal(enviados.whatsapp.length, 0);
  assert.equal(avisosDb[0].whatsappEnviado, false);
  assert.match(avisosDb[0].error, /no es administrativa/);

  reiniciar();
  numerosDeAvisos = {};
  await vuelta(mas(T0, 5));
  assert.equal(enviados.whatsapp.length, 0);
  assert.match(avisosDb[0].error, /no tiene número de avisos/);
  assert.ok(enviados.push.length >= 1, "al menos el push al teléfono");
});

await prueba("el WhatsApp nunca va al teléfono del cliente", async () => {
  await vuelta(mas(T0, 5));
  await vuelta(mas(T0, 30));
  assert.ok(enviados.whatsapp.every((m) => Object.values(numerosDeAvisos).includes(m.phoneNumber)));
  assert.ok(enviados.whatsapp.every((m) => m.phoneNumber !== "573001234567"));
});

await prueba("varios chats de la misma asesora en una vuelta van en un solo mensaje", async () => {
  chatsDb = [chat({ conversationId: "c1" }), chat({ conversationId: "c2", nombreCliente: "Ana Ruiz" })];
  asignadas = new Map([["c1", "ingrid"], ["c2", "ingrid"]]);
  await vuelta(mas(T0, 5));
  assert.equal(enviados.whatsapp.length, 1);
  assert.match(enviados.whatsapp[0].text, /Laura Pérez/);
  assert.match(enviados.whatsapp[0].text, /Ana Ruiz/);
  assert.equal(avisosDb.length, 2);
});

await prueba("el registro del día lista lo anotado y cuenta por asesora", async () => {
  await vuelta(mas(T0, 5));
  await vuelta(mas(T0, 30));
  // El registro lee por rango: se acomodan las fechas de los registros al día de la prueba.
  avisosDb.forEach((f) => (f.creadoEn = mas(T0, 10)));
  prisma.supervisorAviso.findMany = async () => avisosDb;
  prisma.user.findMany = async ({ where }) => where.id.in.map((id) => ({ id, name: NOMBRES[id], email: null }));
  const dia = await registro.leerRegistroDelDia(WS, "2026-10-06");
  assert.equal(dia.totales.avisos, 1);
  assert.equal(dia.totales.reasignaciones, 1);
  const ingrid = dia.conteo.find((c) => c.asesoraId === "ingrid");
  assert.equal(ingrid.avisos, 1);
  assert.equal(ingrid.reasignadosDeEllas, 1);
  assert.equal(dia.conteo.find((c) => c.asesoraId === "laura").recibidos, 1);
});

console.log(`\n${pruebas} pruebas OK`);
