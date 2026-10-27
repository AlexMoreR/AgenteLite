// Pruebas del SUPERVISOR DE REASIGNACIÓN (src/features/supervisor-reasignacion): avisos por WhatsApp a
// los 5 minutos, reasignación a los 30, Caliente 24 h, bot pidió asesora, horario laboral y sin repetir.
// Las reglas puras con un reloj simulado, y el vigilante con la base y los envíos simulados (sin red ni base real).
// Correr: npm run test:supervisor-reasignacion
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { cargar, RAIZ } from "./supervisor-cargar.mjs";
import path from "node:path";

const { Prisma } = createRequire(path.join(RAIZ, "package.json"))("@prisma/client");

/* ------------------------------------------------------------------ base y envíos simulados */

const CANAL_ADMIN = "cmt06kiob00lw2hk2mgllstsb";
const NUMEROS = { ingrid: "573100000001", maria: "573100000002", ana: "573100000003" };
const CLIENTE = "573001234567";

const settings = new Map();
const enviados = { whatsapp: [], push: [], actividad: [], tiempoReal: [] };
let CHATS = [];
let PENDIENTES = [];
let CANDIDATAS = ["ingrid", "maria"];
let lecturasDeChats = 0;
const avisosGuardados = [];
let fallaElRegistro = false;
let siguienteId = 1;
const movidos = [];
let respondioAntes = false;
let lineaCaida = false;

const CANALES = [
  { id: CANAL_ADMIN, purpose: "ADMIN", evolutionInstanceName: "admin", metadata: null },
  { id: "linea-ventas", purpose: "SALES", evolutionInstanceName: "ventas", metadata: { agenteV3: true } },
];

const prisma = {
  appSetting: {
    findUnique: async ({ where }) => (settings.has(where.key) ? { key: where.key, value: settings.get(where.key) } : null),
    findMany: async ({ where }) =>
      [...settings.entries()].filter(([key]) => !where?.key?.startsWith || key.startsWith(where.key.startsWith)).map(([key, value]) => ({ key, value })),
    upsert: async ({ where, create, update }) => {
      settings.set(where.key, settings.has(where.key) ? update.value : create.value);
      return {};
    },
  },
  whatsAppChannel: {
    findFirst: async ({ where }) =>
      CANALES.find((c) => c.id === where.id && (where.purpose === undefined || c.purpose === where.purpose)) ?? null,
    findMany: async () => CANALES.filter((c) => c.metadata?.agenteV3),
  },
  workspaceMember: {
    findMany: async ({ where }) => {
      if (where.role) return [{ userId: "alex" }];
      return (where.userId?.in ?? []).map((userId) => ({ userId }));
    },
  },
  user: {
    findMany: async ({ where }) =>
      where.id.in.map((id) => ({ id, name: { ingrid: "Ingrid Sanchez", maria: "Maria Bautista", ana: "Ana Ruiz", alex: "Alex" }[id] ?? id, email: null })),
  },
  conversation: {
    findMany: async ({ where }) => where.id.in.map((id) => ({ id, numero: 1234 })),
    updateMany: async ({ where, data }) => {
      const chat = CHATS.find((c) => c.conversationId === where.id);
      if (!chat || chat.asesoraId !== where.assignedToUserId) return { count: 0 };
      movidos.push({ id: where.id, de: chat.asesoraId, a: data.assignedToUserId });
      chat.asesoraId = data.assignedToUserId;
      chat.asignadaEn = AHORA_ACTUAL();
      return { count: 1 };
    },
  },
  message: { findFirst: async () => (respondioAntes ? { id: "m1" } : null) },
  supervisorAviso: {
    findMany: async ({ where }) => avisosGuardados.filter((a) => where.conversationId.in.includes(a.conversationId)),
    create: async ({ data }) => {
      if (fallaElRegistro) throw new Error("base caída");
      if (avisosGuardados.some((a) => a.conversationId === data.conversationId && a.tipo === data.tipo && a.episodio.getTime() === data.episodio.getTime())) {
        throw new Prisma.PrismaClientKnownRequestError("duplicado", { code: "P2002", clientVersion: "test" });
      }
      const fila = { id: `a${siguienteId++}`, whatsappEnviado: false, error: null, creadoEn: AHORA_ACTUAL(), ...data };
      avisosGuardados.push(fila);
      return { id: fila.id };
    },
    update: async ({ where, data }) => {
      Object.assign(avisosGuardados.find((a) => a.id === where.id), data);
      return {};
    },
  },
  $queryRaw: async () => PENDIENTES,
};

let reloj = new Date();
const AHORA_ACTUAL = () => reloj;

const mocks = {
  "@/lib/prisma": { prisma },
  "@/lib/web-push": {
    sendPushToUser: async ({ userId, payload }) => {
      enviados.push.push({ userId, ...payload });
      return 1;
    },
  },
  "@/lib/evolution": {
    sendEvolutionTextMessageWithReconnect: async ({ instanceName, phoneNumber, text }) => {
      if (lineaCaida) throw new Error("línea desconectada");
      enviados.whatsapp.push({ instanceName, phoneNumber, text });
    },
  },
  "@/lib/anti-bloqueo/servicio": { leerConfigAntiBloqueo: async () => ({ avisos: { canalInternoId: CANAL_ADMIN } }) },
  "@/lib/conversation-activity": { recordConversationActivity: async (x) => void enviados.actividad.push(x) },
  "@/lib/realtime-notify": { notifyRealtimeUpdate: async (x) => void enviados.tiempoReal.push(x) },
  "@/lib/channel-collaborators": { calcularReparto: () => CANDIDATAS },
  "@/lib/en-linea": { filtrarSinPausaManual: async (_ws, ids) => new Set(ids) },
  "@/lib/horario-de-reparto": { filtrarPorHorario: async (_ws, ids) => ids },
  "@/lib/reparto-de-leads": { avisarAsignacionPorPush: async () => {} },
  "@/features/supervisor/servicios/datos": {
    leerChatsAbiertos: async () => {
      lecturasDeChats += 1;
      return CHATS;
    },
  },
};

const r = cargar("src/features/supervisor-reasignacion/dominio/reglas.ts", mocks);
const vigilante = cargar("src/features/supervisor-reasignacion/servicios/vigilante.ts", mocks);
const configServicio = cargar("src/features/supervisor-reasignacion/servicios/config.ts", mocks);
const enrutador = cargar("src/features/avisos-gravedad/servicios/enrutador.ts", mocks);
const registro = cargar("src/features/supervisor-reasignacion/servicios/registro.ts", mocks);

let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const M = 60_000;
const WS = "ws1";
// Martes 6-oct-2026 10:00 Bogotá = 15:00 UTC (en horario laboral).
const T0 = new Date("2026-10-06T15:00:00Z");
const mas = (fecha, min) => new Date(fecha.getTime() + min * M);

const CONFIG = { ...r.CONFIG_REASIGNACION_POR_DEFECTO, avisosActivo: true, reasignacionActiva: true };

function chatPlano(extra = {}) {
  return {
    conversationId: "c1",
    asesoraId: "ingrid",
    asesoraNombre: "Ingrid Sanchez",
    etapa: "CALIFICADO",
    ultimoClienteEn: T0,
    ultimaRespuestaHumanaEn: null,
    textosPendientes: ["hola, quiero la camilla"],
    textosDelCliente: ["hola, quiero la camilla"],
    telefono: CLIENTE,
    nombreCliente: "Laura Gómez",
    asignadaEn: mas(T0, -60),
    mensajes: [],
    ...extra,
  };
}

function vigilado(extra = {}) {
  return {
    conversationId: "c1",
    numero: 1234,
    asesoraId: "ingrid",
    etapa: "CALIFICADO",
    caliente: false,
    nombre: "Laura Gómez",
    telefono: CLIENTE,
    esperando: true,
    botPidioAsesora: false,
    primerPendienteEn: T0,
    asignadaEn: mas(T0, -60),
    ultimaRespuestaHumanaEn: null,
    ...extra,
  };
}

function reiniciar({ config = CONFIG, chats = [chatPlano()], pendientes = [{ id: "c1", desde: T0 }], candidatas = ["ingrid", "maria"] } = {}) {
  settings.clear();
  settings.set(`supervisor:reasignacion:${WS}`, JSON.stringify(config));
  settings.set(
    `agente-v3:avisos:${WS}`,
    JSON.stringify({
      canalId: CANAL_ADMIN,
      destinos: [
        { numero: NUMEROS.ingrid, userId: "ingrid" },
        { numero: NUMEROS.maria, userId: "maria" },
      ],
    }),
  );
  enviados.whatsapp.length = 0;
  enviados.push.length = 0;
  enviados.actividad.length = 0;
  enviados.tiempoReal.length = 0;
  avisosGuardados.length = 0;
  movidos.length = 0;
  CHATS = chats;
  PENDIENTES = pendientes;
  CANDIDATAS = candidatas;
  lecturasDeChats = 0;
  fallaElRegistro = false;
  respondioAntes = false;
  lineaCaida = false;
  configServicio.olvidarConfigReasignacion();
}

async function vuelta(fecha) {
  reloj = fecha;
  return vigilante.vueltaDeReasignacion(fecha);
}

/* ------------------------------------------------------------------ reglas puras */

await prueba("minutos laborales exactos: solo cuenta lunes a sábado de 8 a 18", () => {
  const h = r.HORARIO_LABORAL_POR_DEFECTO;
  assert.equal(r.minutosLaboralesExactos(T0, mas(T0, 5), h), 5);
  // Sábado 7:00 p. m. -> lunes 8:05 a. m.: solo 5 min cuentan.
  assert.equal(r.minutosLaboralesExactos(new Date("2026-10-11T00:00:00Z"), new Date("2026-10-12T13:05:00Z"), h), 5);
  // Martes 9:07 p. m. -> miércoles 8:07 a. m.: 7 min (no se pierde la fracción del bloque).
  assert.equal(r.minutosLaboralesExactos(new Date("2026-10-07T02:07:00Z"), new Date("2026-10-07T13:07:00Z"), h), 7);
  // Un domingo entero no cuenta.
  assert.equal(r.minutosLaboralesExactos(new Date("2026-10-11T13:00:00Z"), new Date("2026-10-11T23:00:00Z"), h), 0);
});

await prueba("el ajuste: sin fila todo apagado; se acotan los valores; texto roto = por defecto", () => {
  const apagado = r.leerConfigReasignacionDeTexto(null);
  assert.equal(apagado.avisosActivo, false);
  assert.equal(apagado.reasignacionActiva, false);
  assert.equal(apagado.minutosAviso, 5);
  assert.equal(apagado.minutosReasignacion, 30);
  assert.equal(apagado.horasCaliente, 24);
  assert.deepEqual(r.leerConfigReasignacionDeTexto("{roto").horario, r.HORARIO_LABORAL_POR_DEFECTO);
  const c = r.leerConfigReasignacionDeTexto(JSON.stringify({ avisosActivo: true, minutosReasignacion: "15", minutosAviso: -3, horario: { desde: 20, hasta: 5, dias: [1, 2, 9] } }));
  assert.equal(c.avisosActivo, true);
  assert.equal(c.reasignacionActiva, false);
  assert.equal(c.minutosReasignacion, 15);
  assert.equal(c.minutosAviso, 1);
  assert.deepEqual(c.horario, { desde: 8, hasta: 18, dias: [1, 2] });
});

await prueba("decidir: 4 min nada, 5 min un aviso, 30 min reasigna a la que menos tiene", () => {
  const entrada = (min, extra = {}) => ({ chats: [vigilado()], ahora: mas(T0, min), config: CONFIG, candidatas: ["ingrid", "maria"], registrados: new Set(), ...extra });
  assert.equal(r.decidir(entrada(4)).length, 0);
  const aviso = r.decidir(entrada(5));
  assert.equal(aviso.length, 1);
  assert.equal(aviso[0].tipo, "AVISO");
  assert.equal(aviso[0].minutos, 5);
  const mover = r.decidir(entrada(30));
  assert.equal(mover.length, 1);
  assert.equal(mover[0].tipo, "REASIGNACION");
  assert.equal(mover[0].asesoraNuevaId, "maria");
  // Maria ya tiene 2 esperando y Ana ninguna -> Ana.
  const otros = [vigilado({ conversationId: "c2", asesoraId: "maria" }), vigilado({ conversationId: "c3", asesoraId: "maria" })];
  const conAna = r.decidir(entrada(30, { chats: [vigilado(), ...otros], candidatas: ["ingrid", "maria", "ana"] }));
  assert.equal(conAna.find((d) => d.chat.conversationId === "c1").asesoraNuevaId, "ana");
});

await prueba("decidir: lo ya anotado no se repite y un chat se reasigna una sola vez", () => {
  const registrados = new Set([r.llaveDeAviso("c1", "AVISO", T0)]);
  assert.equal(r.decidir({ chats: [vigilado()], ahora: mas(T0, 6), config: CONFIG, candidatas: ["ingrid", "maria"], registrados }).length, 0);
  const movido = new Set([r.llaveDeAviso("c1", "REASIGNACION", T0)]);
  // La nueva asesora recibió el chat a las 10:30 y tampoco contesta: no se vuelve a pasar.
  const despues = vigilado({ asesoraId: "maria", asignadaEn: mas(T0, 30) });
  assert.equal(r.decidir({ chats: [despues], ahora: mas(T0, 70), config: CONFIG, candidatas: ["ingrid", "maria"], registrados: movido }).filter((d) => d.tipo === "REASIGNACION").length, 0);
});

await prueba("decidir: a la asesora que acaba de recibir el chat no se le cobra la espera anterior", () => {
  const recibido = vigilado({ asesoraId: "maria", asignadaEn: mas(T0, 40) });
  assert.equal(r.decidir({ chats: [recibido], ahora: mas(T0, 41), config: CONFIG, candidatas: ["ingrid", "maria"], registrados: new Set() }).length, 0);
});

await prueba("decidir: cada interruptor es independiente", () => {
  const base = { chats: [vigilado()], candidatas: ["ingrid", "maria"], registrados: new Set() };
  const sinAvisos = { ...CONFIG, avisosActivo: false };
  assert.equal(r.decidir({ ...base, ahora: mas(T0, 10), config: sinAvisos }).length, 0);
  assert.equal(r.decidir({ ...base, ahora: mas(T0, 30), config: sinAvisos })[0].tipo, "REASIGNACION");
  const sinReasignar = { ...CONFIG, reasignacionActiva: false };
  assert.equal(r.decidir({ ...base, ahora: mas(T0, 30), config: sinReasignar })[0].tipo, "AVISO");
  assert.equal(r.decidir({ ...base, ahora: mas(T0, 30), config: { ...CONFIG, avisosActivo: false, reasignacionActiva: false } }).length, 0);
});

await prueba("decidir: Caliente a las 24 h (no a las 23) y el bot pidió asesora", () => {
  const caliente = (horas) => vigilado({ esperando: false, primerPendienteEn: null, caliente: true, etapa: "NEGOCIACION", ultimaRespuestaHumanaEn: mas(T0, -horas * 60) });
  const entrada = (chat) => ({ chats: [chat], ahora: T0, config: CONFIG, candidatas: ["ingrid", "maria"], registrados: new Set() });
  assert.equal(r.decidir(entrada(caliente(23))).length, 0);
  const d = r.decidir(entrada(caliente(24)));
  assert.equal(d.length, 1);
  assert.equal(d[0].tipo, "CALIENTE_24H");
  assert.equal(r.decidir({ ...entrada(caliente(24)), registrados: new Set([r.llaveDeAviso("c1", "CALIENTE_24H", mas(T0, -24 * 60))]) }).length, 0);
  assert.equal(r.decidir({ ...entrada(vigilado({ botPidioAsesora: true })), ahora: mas(T0, 5) })[0].tipo, "BOT_PIDIO_ASESORA");
});

await prueba("textos: nombre, etapa, minutos y link; teléfono tapado; uno por asesora", () => {
  const texto = r.textoDeAvisos([{ tipo: "AVISO", chat: vigilado(), minutos: 5 }]);
  assert.match(texto, /Laura Gómez/);
  assert.match(texto, /Calificado/);
  assert.match(texto, /5 min/);
  assert.match(texto, /https:\/\/app\.aizenbot\.com\/c\/1234/);
  const sinNombre = r.textoDeAvisos([{ tipo: "AVISO", chat: vigilado({ nombre: "+57 300 123 4567" }), minutos: 7 }]);
  assert.match(sinNombre, /•••• 4567/);
  assert.ok(!sinNombre.includes("3001234567"));
  const varios = r.textoDeAvisos(Array.from({ length: 7 }, (_, i) => ({ tipo: "AVISO", chat: vigilado({ conversationId: `x${i}` }), minutos: 6 })));
  assert.match(varios, /7 clientes esperando/);
  assert.match(varios, /y 2 más/);
});

await prueba("conteo diario por asesora", () => {
  const conteo = r.conteoPorAsesora([
    { tipo: "AVISO", asesoraId: "ingrid", asesoraNuevaId: null },
    { tipo: "AVISO", asesoraId: "ingrid", asesoraNuevaId: null },
    { tipo: "REASIGNACION", asesoraId: "ingrid", asesoraNuevaId: "maria" },
    { tipo: "CALIENTE_24H", asesoraId: "maria", asesoraNuevaId: null },
  ]);
  assert.deepEqual(conteo.find((c) => c.asesoraId === "ingrid"), { asesoraId: "ingrid", avisos: 2, calientes: 0, botPidioAsesora: 0, chatsPerdidos: 1, chatsRecibidos: 0, sinCandidata: 0 });
  assert.deepEqual(conteo.find((c) => c.asesoraId === "maria"), { asesoraId: "maria", avisos: 0, calientes: 1, botPidioAsesora: 0, chatsPerdidos: 0, chatsRecibidos: 1, sinCandidata: 0 });
  assert.equal(r.fechaDeBogota(new Date("2026-10-07T03:00:00Z")), "2026-10-06");
  assert.equal(r.rangoDelDiaBogota("2026-10-06").desde.toISOString(), "2026-10-06T05:00:00.000Z");
  assert.equal(r.rangoDelDiaBogota("2026-02-31"), null);
});

/* ------------------------------------------------------------------ el vigilante, con la base simulada */

await prueba("cliente sin respuesta: 10:04 nada, 10:05 un aviso (una sola vez), 10:30 reasigna, 10:31 nada", async () => {
  reiniciar();
  await vuelta(mas(T0, 4));
  assert.equal(enviados.whatsapp.length, 0);

  await vuelta(mas(T0, 5));
  assert.equal(enviados.whatsapp.length, 1);
  const aviso = enviados.whatsapp[0];
  assert.equal(aviso.phoneNumber, NUMEROS.ingrid);
  assert.equal(aviso.instanceName, "admin");
  assert.match(aviso.text, /Laura Gómez/);
  assert.match(aviso.text, /5 min/);
  assert.match(aviso.text, /\/c\/1234/);
  // La vuelta corre varias veces seguidas: no se repite.
  await vuelta(mas(T0, 5));
  await vuelta(mas(T0, 6));
  await vuelta(mas(T0, 20));
  assert.equal(enviados.whatsapp.length, 1);
  assert.equal(avisosGuardados.length, 1);
  assert.equal(avisosGuardados[0].tipo, "AVISO");
  assert.equal(avisosGuardados[0].whatsappEnviado, true);

  const total = await vuelta(mas(T0, 30));
  assert.equal(total.reasignados, 1);
  assert.deepEqual(movidos, [{ id: "c1", de: "ingrid", a: "maria" }]);
  const nuevos = enviados.whatsapp.slice(1);
  assert.equal(nuevos.length, 2);
  assert.ok(nuevos.some((w) => w.phoneNumber === NUMEROS.maria && /Te pasaron un chat/.test(w.text)));
  assert.ok(nuevos.some((w) => w.phoneNumber === NUMEROS.ingrid && /Se te quitó un chat/.test(w.text)));
  assert.equal(enviados.actividad.length, 1);
  assert.equal(enviados.actividad[0].kind, "assigned");
  assert.equal(enviados.actividad[0].assigneeUserId, "maria");
  assert.match(enviados.actividad[0].text, /asignado por el Supervisor/);
  assert.equal(enviados.tiempoReal.length, 1);
  const rea = avisosGuardados.find((a) => a.tipo === "REASIGNACION");
  assert.equal(rea.asesoraId, "ingrid");
  assert.equal(rea.asesoraNuevaId, "maria");

  const antes = { w: enviados.whatsapp.length, a: avisosGuardados.length, m: movidos.length };
  await vuelta(mas(T0, 31));
  await vuelta(mas(T0, 34));
  assert.deepEqual({ w: enviados.whatsapp.length, a: avisosGuardados.length, m: movidos.length }, antes);
  // La que recibió el chat tiene sus propios 5 minutos: un aviso a las 10:35, una sola vez, y el chat no vuelve a moverse.
  await vuelta(mas(T0, 35));
  await vuelta(mas(T0, 36));
  await vuelta(mas(T0, 90));
  assert.equal(enviados.whatsapp.length, antes.w + 1);
  assert.equal(enviados.whatsapp.at(-1).phoneNumber, NUMEROS.maria);
  assert.equal(movidos.length, 1);
});

await prueba("si la asesora contesta a las 10:20 no hay reasignación", async () => {
  reiniciar();
  await vuelta(mas(T0, 5));
  CHATS[0].ultimaRespuestaHumanaEn = mas(T0, 20);
  await vuelta(mas(T0, 30));
  assert.equal(movidos.length, 0);
  assert.equal(enviados.whatsapp.length, 1);
});

await prueba("si ella escribe entre la lectura y el cambio, no se mueve", async () => {
  reiniciar();
  respondioAntes = true;
  await vuelta(mas(T0, 30));
  assert.equal(movidos.length, 0);
  assert.equal(enviados.whatsapp.length, 0);
  assert.match(avisosGuardados[0].error, /respondió/);
});

await prueba("fuera de horario no actúa y el reloj arranca al abrir (sábado 19:00 → lunes 8:05 / 8:30)", async () => {
  const sabado19 = new Date("2026-10-11T00:00:00Z");
  reiniciar({ chats: [chatPlano({ ultimoClienteEn: sabado19, asignadaEn: mas(sabado19, -600) })], pendientes: [{ id: "c1", desde: sabado19 }] });
  for (const f of [mas(sabado19, 10), mas(sabado19, 60), new Date("2026-10-11T15:00:00Z"), new Date("2026-10-12T12:59:00Z")]) await vuelta(f);
  assert.equal(enviados.whatsapp.length, 0);
  assert.equal(avisosGuardados.length, 0);
  assert.equal(lecturasDeChats, 0, "fuera de horario ni siquiera lee los chats");

  await vuelta(new Date("2026-10-12T13:04:00Z"));
  assert.equal(enviados.whatsapp.length, 0);
  await vuelta(new Date("2026-10-12T13:05:00Z"));
  assert.equal(enviados.whatsapp.length, 1);
  await vuelta(new Date("2026-10-12T13:29:00Z"));
  assert.equal(movidos.length, 0);
  await vuelta(new Date("2026-10-12T13:30:00Z"));
  assert.equal(movidos.length, 1);
});

await prueba("con la reasignación en 15 minutos, el chat se pasa a los 15", async () => {
  reiniciar({ config: { ...CONFIG, minutosReasignacion: 15 } });
  await vuelta(mas(T0, 14));
  assert.equal(movidos.length, 0);
  await vuelta(mas(T0, 15));
  assert.equal(movidos.length, 1);
});

await prueba("interruptores separados: sin avisos igual reasigna; sin reasignación solo avisa", async () => {
  reiniciar({ config: { ...CONFIG, avisosActivo: false } });
  await vuelta(mas(T0, 10));
  assert.equal(enviados.whatsapp.length, 0);
  await vuelta(mas(T0, 30));
  assert.equal(movidos.length, 1);

  reiniciar({ config: { ...CONFIG, reasignacionActiva: false } });
  await vuelta(mas(T0, 30));
  assert.equal(movidos.length, 0);
  assert.equal(enviados.whatsapp.length, 1);
  assert.equal(avisosGuardados[0].tipo, "AVISO");

  reiniciar({ config: { ...CONFIG, avisosActivo: false, reasignacionActiva: false } });
  const total = await vuelta(mas(T0, 40));
  assert.equal(total.negocios, 0);
  assert.equal(lecturasDeChats, 0);
});

await prueba("Caliente: a las 23 h no avisa, a las 24 h sí y una sola vez", async () => {
  const caliente = (horas) => chatPlano({ etapa: "NEGOCIACION", ultimoClienteEn: mas(T0, -horas * 60 - 30), ultimaRespuestaHumanaEn: mas(T0, -horas * 60) });
  reiniciar({ chats: [caliente(23)], pendientes: [] });
  await vuelta(T0);
  assert.equal(enviados.whatsapp.length, 0);
  reiniciar({ chats: [caliente(24)], pendientes: [] });
  await vuelta(T0);
  await vuelta(mas(T0, 1));
  assert.equal(enviados.whatsapp.length, 1);
  assert.match(enviados.whatsapp[0].text, /sin mensaje tuyo/);
  assert.equal(avisosGuardados[0].tipo, "CALIENTE_24H");
});

await prueba("el bot pidió asesora y nadie contesta: el mismo aviso a los 5 minutos", async () => {
  const mensajes = [
    { direccion: "IN", tipo: "TEXT", origen: null, texto: "quiero que me llamen", en: T0 },
    { direccion: "OUT", tipo: "TEXT", origen: null, texto: "En un momento una de nuestras asesoras te contacta 🙌", en: mas(T0, 0.1) },
  ];
  reiniciar({ chats: [chatPlano({ mensajes })] });
  await vuelta(mas(T0, 5));
  assert.equal(enviados.whatsapp.length, 1);
  assert.equal(avisosGuardados[0].tipo, "BOT_PIDIO_ASESORA");
  assert.match(enviados.whatsapp[0].text, /el bot pidió una asesora/);
});

await prueba("sin otra asesora disponible: el chat no se mueve, queda anotado y se avisa al dueño", async () => {
  reiniciar({ candidatas: ["ingrid"] });
  const total = await vuelta(mas(T0, 30));
  assert.equal(total.sinCandidata, 1);
  assert.equal(movidos.length, 0);
  assert.equal(avisosGuardados.find((a) => a.tipo === "SIN_CANDIDATA").asesoraId, "ingrid");
  assert.ok(enviados.push.some((p) => p.userId === "alex" && /sin quién lo reciba/i.test(p.title)));
  await vuelta(mas(T0, 31));
  assert.equal(avisosGuardados.filter((a) => a.tipo === "SIN_CANDIDATA").length, 1);
});

await prueba("chats que no son de este vigilante: despedidas, ganados, sin asesora, robots", async () => {
  reiniciar({
    chats: [
      chatPlano({ conversationId: "g", textosPendientes: ["muchas gracias, feliz noche"], textosDelCliente: ["muchas gracias, feliz noche"] }),
      chatPlano({ conversationId: "w", etapa: "GANADO" }),
      chatPlano({ conversationId: "s", asesoraId: null }),
      chatPlano({ conversationId: "o", ocultoDelCrm: true }),
      chatPlano({ conversationId: "e", telefono: "14155550123", textosDelCliente: ["hello"], textosPendientes: ["hello"] }),
    ],
    pendientes: ["g", "w", "s", "o", "e"].map((id) => ({ id, desde: T0 })),
  });
  await vuelta(mas(T0, 40));
  assert.equal(enviados.whatsapp.length, 0);
  assert.equal(movidos.length, 0);
});

await prueba("varios chats de la misma asesora en una vuelta van en UN solo mensaje", async () => {
  reiniciar({
    chats: [chatPlano({ conversationId: "a" }), chatPlano({ conversationId: "b", nombreCliente: "Pedro Pérez" })],
    pendientes: [{ id: "a", desde: T0 }, { id: "b", desde: T0 }],
  });
  await vuelta(mas(T0, 6));
  assert.equal(enviados.whatsapp.length, 1);
  assert.match(enviados.whatsapp[0].text, /2 clientes esperando/);
  assert.equal(avisosGuardados.length, 2);
});

await prueba("si no se pudo anotar, no se manda", async () => {
  reiniciar();
  fallaElRegistro = true;
  await vuelta(mas(T0, 40));
  assert.equal(enviados.whatsapp.length, 0);
  assert.equal(movidos.length, 0);
});

await prueba("línea Admin desconectada: el aviso queda como falló, llega el push y la reasignación se hace igual", async () => {
  reiniciar();
  lineaCaida = true;
  await vuelta(mas(T0, 5));
  assert.equal(avisosGuardados[0].whatsappEnviado, false);
  assert.match(avisosGuardados[0].error, /desconectada/);
  assert.ok(enviados.push.some((p) => p.userId === "ingrid"));
  await vuelta(mas(T0, 30));
  assert.equal(movidos.length, 1);
});

await prueba("solo al equipo: línea que no es administrativa o número fuera de la lista → no se manda nada", async () => {
  reiniciar();
  // Una línea de VENTAS pedida como línea de avisos.
  let res = await enrutador.whatsAppAPersonaDelEquipo({ workspaceId: WS, userId: "ingrid", texto: "hola", canalId: "linea-ventas" });
  assert.equal(res.ok, false);
  assert.match(res.motivo, /administrativa/);
  // Una persona sin número en la lista de avisos del equipo.
  res = await enrutador.whatsAppAPersonaDelEquipo({ workspaceId: WS, userId: "ana", texto: "hola", canalId: CANAL_ADMIN });
  assert.equal(res.ok, false);
  assert.match(res.motivo, /sin número/);
  assert.equal(enviados.whatsapp.length, 0);
  // Recorrido completo: todo lo que salió fue a un número del equipo, nunca al cliente.
  await vuelta(mas(T0, 5));
  await vuelta(mas(T0, 30));
  assert.ok(enviados.whatsapp.length >= 3);
  for (const w of enviados.whatsapp) {
    assert.ok(Object.values(NUMEROS).includes(w.phoneNumber), `salió a ${w.phoneNumber}`);
    assert.notEqual(w.phoneNumber, CLIENTE);
    assert.equal(w.instanceName, "admin");
  }
});

await prueba("el registro del día y el conteo por asesora cuadran con lo anotado", async () => {
  reiniciar();
  await vuelta(mas(T0, 5));
  await vuelta(mas(T0, 30));
  const filas = avisosGuardados.map((a) => ({ ...a, creadoEn: T0 }));
  prisma.supervisorAviso.count = async () => filas.length;
  const original = prisma.supervisorAviso.findMany;
  prisma.supervisorAviso.findMany = async () => filas;
  const dia = await registro.leerRegistroDelDia(WS, "2026-10-06");
  prisma.supervisorAviso.findMany = original;
  assert.equal(dia.total, 2);
  const ingrid = dia.conteo.find((c) => c.asesoraId === "ingrid");
  const maria = dia.conteo.find((c) => c.asesoraId === "maria");
  assert.equal(ingrid.asesora, "Ingrid Sanchez");
  assert.equal(ingrid.avisos, 1);
  assert.equal(ingrid.chatsPerdidos, 1);
  assert.equal(maria.chatsRecibidos, 1);
  assert.equal(await registro.leerRegistroDelDia(WS, "mal"), null);
});

console.log(`\n${pruebas} pruebas del supervisor de reasignación: todas bien.`);
