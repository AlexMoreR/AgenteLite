// Pruebas del VIGILANTE DE REASIGNACIÓN (src/features/supervisor-reasignacion): avisos por WhatsApp a la
// asesora, reasignación a los 30 min, solo en horario laboral, sin avisos duplicados.
// Reglas puras + el servicio con la base, el reloj y los envíos simulados (sin red ni base real).
// Correr: npm run test:supervisor-reasignacion
import assert from "node:assert/strict";
import { cargar } from "./supervisor-cargar.mjs";

/* ------------------------------------------------------------------ mundo simulado */

const settings = new Map();
const avisosGuardados = [];
const enviados = { whatsapp: [], push: [], dueno: [], actividad: [], realtime: [] };
const NUMEROS = { ingrid: "573001111111", maria: "573002222222", stef: "573003333333" };
const NOMBRES = { ingrid: "Ingrid Sanchez", maria: "Maria Bautista", stef: "Stheffani Diaz" };
const mundo = { ahora: new Date(), chats: [], respuestas: {}, pausadas: new Set(), activos: ["ingrid", "maria", "stef"], numeros: { ...NUMEROS }, lineaCaida: false };

const mismoMs = (a, b) => new Date(a).getTime() === new Date(b).getTime();
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
  supervisorAviso: {
    create: async ({ data }) => {
      if (avisosGuardados.some((a) => a.conversationId === data.conversationId && a.tipo === data.tipo && mismoMs(a.episodio, data.episodio))) {
        throw Object.assign(new Error("Unique constraint"), { code: "P2002" });
      }
      const fila = { id: `a${avisosGuardados.length + 1}`, whatsappEnviado: false, error: null, asesoraNuevaId: null, asesoraId: null, ...data, creadoEn: mundo.ahora };
      avisosGuardados.push(fila);
      return { id: fila.id };
    },
    findMany: async ({ where }) =>
      avisosGuardados.filter(
        (a) =>
          a.workspaceId === where.workspaceId &&
          (!where.conversationId || where.conversationId.in.includes(a.conversationId)) &&
          (!where.creadoEn?.gte || a.creadoEn >= where.creadoEn.gte) &&
          (!where.creadoEn?.lt || a.creadoEn < where.creadoEn.lt),
      ),
    update: async ({ where, data }) => Object.assign(avisosGuardados.find((a) => a.id === where.id), data),
    updateMany: async ({ where, data }) => {
      const filas = avisosGuardados.filter((a) => (where.id.in ? where.id.in.includes(a.id) : a.id === where.id) && (!("error" in where) || a.error === where.error));
      filas.forEach((f) => Object.assign(f, data));
      return { count: filas.length };
    },
  },
  conversation: {
    findMany: async ({ where }) =>
      mundo.chats.filter((c) => where.id.in.includes(c.conversationId)).map((c, i) => ({ id: c.conversationId, numero: 1000 + i, channelId: "linea1", contactId: `ct-${c.conversationId}` })),
    updateMany: async ({ where, data }) => {
      const chat = mundo.chats.find((c) => c.conversationId === where.id);
      if (!chat || chat.asesoraId !== where.assignedToUserId) return { count: 0 };
      chat.asesoraId = data.assignedToUserId;
      chat.asesoraNombre = NOMBRES[data.assignedToUserId];
      return { count: 1 };
    },
  },
  message: {
    findFirst: async ({ where }) => {
      const cuando = mundo.respuestas[where.conversationId];
      return cuando && cuando > where.createdAt.gt ? { id: "m" } : null;
    },
  },
  whatsAppChannel: {
    findMany: async () => [{ id: "linea1", metadata: { ids: ["ingrid", "maria", "stef"] } }],
    findFirst: async ({ where }) => {
      if (where.id === "cmt06kiob00lw2hk2mgllstsb") return { purpose: "ADMIN", evolutionInstanceName: "admin" };
      if (where.id === "ventas1") return { purpose: "SALES", evolutionInstanceName: "ventas" };
      return null;
    },
  },
  workspaceMember: {
    findMany: async ({ where }) => mundo.activos.filter((id) => where.userId.in.includes(id)).map((userId) => ({ userId })),
  },
};

const mocks = {
  "@/lib/prisma": { prisma },
  "@/lib/channel-collaborators": { calcularReparto: (metadata) => metadata.ids },
  "@/lib/conversation-activity": { recordConversationActivity: async (a) => void enviados.actividad.push(a) },
  "@/lib/evolution": {
    sendEvolutionTextMessageWithReconnect: async ({ instanceName, phoneNumber, text }) => {
      if (mundo.lineaCaida) throw new Error("línea desconectada");
      enviados.whatsapp.push({ instanceName, phoneNumber, text, para: Object.keys(NUMEROS).find((k) => NUMEROS[k] === phoneNumber) });
    },
  },
  "@/lib/en-linea": { filtrarSinPausaManual: async (_ws, ids) => new Set(ids.filter((id) => !mundo.pausadas.has(id))) },
  "@/lib/horario-de-reparto": { filtrarPorHorario: async (_ws, ids) => ids },
  "@/lib/realtime-notify": { notifyRealtimeUpdate: async (a) => void enviados.realtime.push(a) },
  "@/lib/web-push": {
    sendPushToUser: async ({ userId, payload }) => {
      enviados.push.push({ userId, ...payload });
      return 1;
    },
  },
  "@/features/avisos-gravedad/servicios/enrutador": {
    numeroDeAvisosDeLaPersona: async (_ws, userId) => mundo.numeros[userId] ?? null,
    leerConfigGravedad: async () => ({}),
    pushAAlexander: async (_ws, _c, payload) => {
      enviados.dueno.push(payload);
      return 1;
    },
  },
  "@/features/supervisor/servicios/datos": {
    leerChatsAbiertos: async () => mundo.chats.map((c) => ({ ...c })),
    nombresDeAsesoras: async () => NOMBRES,
  },
};

const r = cargar("src/features/supervisor-reasignacion/dominio/reglas.ts", mocks);
const vigilante = cargar("src/features/supervisor-reasignacion/servicios/vigilante.ts", mocks);
const registro = cargar("src/features/supervisor-reasignacion/servicios/registro.ts", mocks);
const accionable = cargar("src/features/supervisor-accionable/servicios/accionable.ts", {
  ...mocks,
  "@/lib/evolution": mocks["@/lib/evolution"],
});

let pruebas = 0;
async function prueba(nombre, fn) {
  reiniciar();
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const M = 60_000;
const H = 3_600_000;
const WS = "ws1";
// Martes 6-oct-2026 10:00 Bogotá = 15:00 UTC (en horario laboral).
const T0 = new Date("2026-10-06T15:00:00Z");
const mas = (fecha, min) => new Date(fecha.getTime() + min * M);

function chat(extra = {}) {
  return {
    conversationId: "c1",
    asesoraId: "ingrid",
    asesoraNombre: NOMBRES.ingrid,
    etapa: "CALIFICADO",
    ultimoClienteEn: T0,
    ultimaRespuestaHumanaEn: null,
    textosPendientes: ["Hola, ¿cuánto cuesta la camilla?"],
    textosDelCliente: ["Hola, ¿cuánto cuesta la camilla?"],
    pausado: false,
    telefono: "573009876543",
    metadata: null,
    esLid: false,
    telefonoDescubierto: null,
    dormidoHasta: null,
    nombreCliente: "Laura Gómez",
    asignadaEn: null,
    temperatura: null,
    mensajes: [],
    ...extra,
  };
}

function config(extra = {}) {
  settings.set(r.claveConfigReasignacion(WS), JSON.stringify({ avisosActivo: true, reasignacionActiva: true, ...extra }));
}

function reiniciar() {
  settings.clear();
  avisosGuardados.length = 0;
  for (const k of Object.keys(enviados)) enviados[k].length = 0;
  Object.assign(mundo, { chats: [], respuestas: {}, pausadas: new Set(), activos: ["ingrid", "maria", "stef"], numeros: { ...NUMEROS }, lineaCaida: false });
}

async function vuelta(ahora) {
  mundo.ahora = ahora;
  return vigilante.vueltaDeReasignacion(ahora);
}

const tipos = () => avisosGuardados.map((a) => a.tipo);

/* ------------------------------------------------------------------ reglas puras */

await prueba("minutos laborales al minuto: martes 10:00 a 10:05 son 5", async () => {
  assert.equal(r.minutosLaboralesExactos(T0, mas(T0, 5), r.CONFIG_REASIGNACION_POR_DEFECTO.horario), 5);
});

await prueba("minutos laborales: lo de la noche y el domingo no cuenta; el lunes arranca al abrir", async () => {
  const h = r.CONFIG_REASIGNACION_POR_DEFECTO.horario;
  const sabado19 = new Date("2026-10-11T00:00:00Z"); // sábado 10-oct 19:00 Bogotá
  assert.equal(r.minutosLaboralesExactos(sabado19, new Date("2026-10-12T13:04:00Z"), h), 4); // lunes 8:04
  assert.equal(r.minutosLaboralesExactos(sabado19, new Date("2026-10-12T13:05:00Z"), h), 5);
  assert.equal(r.minutosLaboralesExactos(sabado19, new Date("2026-10-11T20:00:00Z"), h), 0); // domingo 15:00
  // Martes 21:00 → miércoles 8:05 = 5 min laborales
  assert.equal(r.minutosLaboralesExactos(new Date("2026-10-07T02:00:00Z"), new Date("2026-10-07T13:05:00Z"), h), 5);
});

await prueba("la config sin fila o rota queda con los interruptores APAGADOS y los valores de siempre", async () => {
  for (const texto of [null, "", "no es json", "[]", '{"avisoMin":"x"}']) {
    const c = r.leerConfigReasignacionDeTexto(texto);
    assert.equal(c.avisosActivo, false);
    assert.equal(c.reasignacionActiva, false);
    assert.equal(c.avisoMin, 5);
    assert.equal(c.reasignarMin, 30);
    assert.equal(c.calienteHoras, 24);
    assert.equal(c.canalId, "cmt06kiob00lw2hk2mgllstsb");
    assert.deepEqual(c.horario.dias, [1, 2, 3, 4, 5, 6]);
  }
  const c = r.leerConfigReasignacionDeTexto(JSON.stringify({ avisosActivo: true, reasignarMin: 15, horario: { desde: 7, hasta: 19, dias: [1, 2, 3] } }));
  assert.equal(c.avisosActivo, true);
  assert.equal(c.reasignarMin, 15);
  assert.deepEqual(c.horario, { desde: 7, hasta: 19, dias: [1, 2, 3] });
});

await prueba("elige a la candidata con menos chats esperando y nunca a la misma", async () => {
  const pendientes = new Map([["maria", 3], ["stef", 1]]);
  const elegida = r.elegirCandidata({ candidatas: ["ingrid", "maria", "stef"], excluir: "ingrid", pendientes, totales: new Map() });
  assert.equal(elegida, "stef");
  assert.equal(r.elegirCandidata({ candidatas: ["ingrid"], excluir: "ingrid", pendientes, totales: new Map() }), null);
});

await prueba("el texto lleva nombre (o teléfono tapado), etapa, minutos y el link; varios van en un solo mensaje", async () => {
  const enlace = r.enlaceDelChat(4567, "c1");
  assert.equal(enlace, "https://app.aizenbot.com/c/4567");
  const con = r.lineaDeAviso({ tipo: "AVISO", chat: chat(), minutos: 5, enlace });
  assert.match(con, /Laura Gómez/);
  assert.match(con, /Calificado/);
  assert.match(con, /5 min/);
  assert.match(con, /app\.aizenbot\.com\/c\/4567/);
  const sin = r.lineaDeAviso({ tipo: "AVISO", chat: chat({ nombreCliente: null }), minutos: 5, enlace });
  assert.match(sin, /•••• 6543/);
  assert.ok(!sin.includes("573009876543"));
  assert.equal(r.armarMensaje([con]), con);
  assert.match(r.armarMensaje([con, sin]), /2 avisos/);
});

/* ------------------------------------------------------------------ el servicio, con reloj simulado */

await prueba("sin config o con los dos interruptores apagados no hace nada", async () => {
  mundo.chats = [chat()];
  await vuelta(mas(T0, 40));
  assert.equal(avisosGuardados.length, 0);
  config({ avisosActivo: false, reasignacionActiva: false });
  await vuelta(mas(T0, 40));
  assert.equal(avisosGuardados.length, 0);
  assert.equal(enviados.whatsapp.length, 0);
});

await prueba("aviso a los 5 min (solo uno), reasignación a los 30 con dos avisos, y nada a los 31", async () => {
  config();
  mundo.chats = [
    chat(),
    chat({ conversationId: "c2", asesoraId: "stef", asesoraNombre: NOMBRES.stef, ultimoClienteEn: mas(T0, 28) }),
    chat({ conversationId: "c3", asesoraId: "stef", asesoraNombre: NOMBRES.stef, ultimoClienteEn: mas(T0, 29) }),
  ];
  await vuelta(mas(T0, 4));
  assert.equal(avisosGuardados.length, 0, "a los 4 min no pasa nada");

  await vuelta(mas(T0, 5));
  assert.deepEqual(tipos(), ["AVISO"]);
  assert.equal(enviados.whatsapp.length, 1);
  assert.equal(enviados.whatsapp[0].para, "ingrid");
  assert.equal(enviados.whatsapp[0].instanceName, "admin");
  assert.match(enviados.whatsapp[0].text, /Laura Gómez/);
  assert.match(enviados.whatsapp[0].text, /5 min/);
  assert.equal(avisosGuardados[0].whatsappEnviado, true);

  // Varias vueltas más: ni un aviso repetido.
  await vuelta(mas(T0, 5));
  await vuelta(mas(T0, 6));
  await vuelta(mas(T0, 20));
  assert.deepEqual(tipos(), ["AVISO"], "sin avisos duplicados");
  assert.equal(enviados.whatsapp.length, 1);

  await vuelta(mas(T0, 30));
  assert.deepEqual(tipos(), ["AVISO", "REASIGNACION"]);
  assert.equal(mundo.chats[0].asesoraId, "maria", "pasa a la que tiene menos chats esperando");
  assert.equal(enviados.actividad.length, 1);
  assert.equal(enviados.actividad[0].kind, "assigned");
  assert.equal(enviados.actividad[0].assigneeUserId, "maria");
  assert.match(enviados.actividad[0].text, /Supervisor/);
  assert.equal(enviados.realtime.length, 1);
  const nuevos = enviados.whatsapp.slice(1);
  assert.deepEqual(nuevos.map((m) => m.para).sort(), ["ingrid", "maria"]);
  assert.match(nuevos.find((m) => m.para === "maria").text, /Te pasaron un chat/);
  assert.match(nuevos.find((m) => m.para === "ingrid").text, /Pasé a Maria Bautista/);

  await vuelta(mas(T0, 31));
  await vuelta(mas(T0, 32));
  assert.deepEqual(tipos(), ["AVISO", "REASIGNACION"], "a los 31 no se repite nada");
  assert.equal(enviados.whatsapp.length, 3);
});

await prueba("si la asesora contesta a los 20 min no hay reasignación", async () => {
  config();
  mundo.chats = [chat()];
  await vuelta(mas(T0, 5));
  mundo.chats[0].ultimaRespuestaHumanaEn = mas(T0, 20);
  await vuelta(mas(T0, 30));
  assert.deepEqual(tipos(), ["AVISO"]);
  assert.equal(mundo.chats[0].asesoraId, "ingrid");
});

await prueba("si contesta justo en el instante de reasignar, el chat no se mueve", async () => {
  config();
  mundo.chats = [chat()];
  mundo.respuestas.c1 = mas(T0, 29); // llegó a la base pero la lectura del chat ya estaba hecha
  await vuelta(mas(T0, 30));
  assert.equal(mundo.chats[0].asesoraId, "ingrid");
  assert.equal(enviados.whatsapp.filter((m) => /Te pasaron/.test(m.text)).length, 0);
});

await prueba("fuera de horario no avisa ni reasigna; el lunes avisa a las 8:05 y reasigna a las 8:30", async () => {
  config();
  const sabado19 = new Date("2026-10-11T00:00:00Z"); // sábado 19:00 Bogotá
  mundo.chats = [chat({ ultimoClienteEn: sabado19 })];
  await vuelta(mas(sabado19, 30)); // sábado 19:30
  await vuelta(new Date("2026-10-11T18:00:00Z")); // domingo 13:00
  assert.equal(avisosGuardados.length, 0);
  await vuelta(new Date("2026-10-12T13:04:00Z")); // lunes 8:04
  assert.equal(avisosGuardados.length, 0);
  await vuelta(new Date("2026-10-12T13:05:00Z")); // lunes 8:05
  assert.deepEqual(tipos(), ["AVISO"]);
  await vuelta(new Date("2026-10-12T13:29:00Z"));
  assert.deepEqual(tipos(), ["AVISO"]);
  await vuelta(new Date("2026-10-12T13:30:00Z")); // lunes 8:30
  assert.deepEqual(tipos(), ["AVISO", "REASIGNACION"]);
});

await prueba("con la reasignación en 15 minutos, el chat se pasa a los 15", async () => {
  config({ reasignarMin: 15 });
  mundo.chats = [chat()];
  await vuelta(mas(T0, 14));
  assert.ok(!tipos().includes("REASIGNACION"));
  await vuelta(mas(T0, 15));
  assert.ok(tipos().includes("REASIGNACION"));
});

await prueba("cada interruptor es independiente", async () => {
  config({ avisosActivo: false, reasignacionActiva: true });
  mundo.chats = [chat()];
  await vuelta(mas(T0, 10));
  assert.equal(avisosGuardados.length, 0, "sin avisos, a los 10 min no hay nada");
  await vuelta(mas(T0, 30));
  assert.deepEqual(tipos(), ["REASIGNACION"]);

  reiniciar();
  config({ avisosActivo: true, reasignacionActiva: false });
  mundo.chats = [chat()];
  await vuelta(mas(T0, 5));
  await vuelta(mas(T0, 40));
  assert.deepEqual(tipos(), ["AVISO"], "sin reasignación solo avisa");
  assert.equal(mundo.chats[0].asesoraId, "ingrid");
});

await prueba("Caliente: a las 23 h sin mensaje de la asesora no avisa; a las 24 sí, una sola vez", async () => {
  config();
  const ultimaRespuesta = T0;
  mundo.chats = [chat({ etapa: "NEGOCIACION", ultimoClienteEn: mas(T0, -30), ultimaRespuestaHumanaEn: ultimaRespuesta, textosPendientes: [] })];
  await vuelta(new Date(T0.getTime() + 23 * H));
  assert.equal(avisosGuardados.length, 0);
  await vuelta(new Date(T0.getTime() + 24 * H));
  assert.deepEqual(tipos(), ["CALIENTE_24H"]);
  assert.match(enviados.whatsapp[0].text, /Caliente/);
  await vuelta(new Date(T0.getTime() + 24 * H + 5 * M));
  await vuelta(new Date(T0.getTime() + 26 * H));
  assert.deepEqual(tipos(), ["CALIENTE_24H"]);
});

await prueba("el bot pidió asesora: el aviso sale a los 5 min y no se duplica con el aviso normal", async () => {
  config({ reasignacionActiva: false });
  mundo.chats = [
    chat({
      mensajes: [
        { direccion: "IN", tipo: "TEXT", origen: null, texto: "Quiero hablar con una asesora", en: T0 },
        { direccion: "OUT", tipo: "TEXT", origen: null, texto: "Con gusto, ya te ayudo 🙌", en: mas(T0, 1) },
        { direccion: "OUT", tipo: "SYSTEM", origen: "activity", texto: "El agente pide un asesor", en: mas(T0, 1) },
      ],
    }),
  ];
  await vuelta(mas(T0, 4));
  assert.equal(avisosGuardados.length, 0);
  await vuelta(mas(T0, 5));
  await vuelta(mas(T0, 6));
  assert.deepEqual(tipos(), ["BOT_PIDIO_ASESORA"]);
  assert.match(enviados.whatsapp[0].text, /bot pidió/);
});

await prueba("sin otra asesora disponible: el chat no se mueve, queda anotado y el aviso llega al dueño (una vez)", async () => {
  config();
  mundo.activos = ["ingrid"];
  mundo.chats = [chat()];
  await vuelta(mas(T0, 30));
  await vuelta(mas(T0, 31));
  assert.deepEqual(tipos().sort(), ["AVISO", "SIN_CANDIDATA"]);
  assert.equal(mundo.chats[0].asesoraId, "ingrid");
  assert.equal(enviados.dueno.length, 1);
  assert.match(enviados.dueno[0].body, /No hay otra asesora/);
});

await prueba("una asesora pausada no recibe chats", async () => {
  config();
  mundo.pausadas = new Set(["maria", "stef"]);
  mundo.chats = [chat()];
  await vuelta(mas(T0, 30));
  assert.ok(tipos().includes("SIN_CANDIDATA"));
  assert.equal(mundo.chats[0].asesoraId, "ingrid");
});

await prueba("si la nueva asesora tampoco contesta: no se vuelve a pasar, se le avisa al dueño una vez", async () => {
  config();
  mundo.activos = ["ingrid", "maria"];
  mundo.chats = [chat()];
  await vuelta(mas(T0, 30));
  assert.equal(mundo.chats[0].asesoraId, "maria");
  await vuelta(mas(T0, 59));
  assert.ok(!tipos().includes("ESCALADA_DUENO"));
  await vuelta(mas(T0, 60));
  await vuelta(mas(T0, 90));
  assert.equal(tipos().filter((t) => t === "ESCALADA_DUENO").length, 1);
  assert.equal(tipos().filter((t) => t === "REASIGNACION").length, 1);
  assert.equal(mundo.chats[0].asesoraId, "maria");
  assert.equal(enviados.dueno.length, 1);
});

await prueba("un mensaje nuevo del cliente es un episodio nuevo: vuelve a avisar", async () => {
  config({ reasignacionActiva: false });
  mundo.chats = [chat()];
  await vuelta(mas(T0, 5));
  mundo.chats[0].ultimaRespuestaHumanaEn = mas(T0, 6);
  mundo.chats[0].ultimoClienteEn = mas(T0, 60);
  await vuelta(mas(T0, 65));
  assert.deepEqual(tipos(), ["AVISO", "AVISO"]);
});

await prueba("despedidas, chats ganados/perdidos y clientes del exterior no cuentan como sin respuesta", async () => {
  config();
  mundo.chats = [
    chat({ conversationId: "g", textosPendientes: ["muchas gracias, feliz noche"] }),
    chat({ conversationId: "p", etapa: "PERDIDO" }),
    chat({ conversationId: "x", etapa: "GANADO" }),
    chat({ conversationId: "e", telefono: "14155550123" }),
  ];
  await vuelta(mas(T0, 40));
  assert.equal(avisosGuardados.length, 0);
});

await prueba("varios chats de la misma asesora en la misma vuelta van en UN solo mensaje", async () => {
  config({ reasignacionActiva: false });
  mundo.chats = [chat({ conversationId: "a" }), chat({ conversationId: "b", ultimoClienteEn: mas(T0, -1) }), chat({ conversationId: "c", ultimoClienteEn: mas(T0, -2) })];
  await vuelta(mas(T0, 7));
  assert.equal(avisosGuardados.length, 3);
  assert.equal(enviados.whatsapp.length, 1);
  assert.match(enviados.whatsapp[0].text, /3 avisos/);
});

await prueba("línea equivocada (no administrativa) o asesora sin número: no se manda nada al cliente y queda el fallo anotado", async () => {
  config({ canalId: "ventas1", reasignacionActiva: false });
  mundo.chats = [chat()];
  await vuelta(mas(T0, 5));
  assert.equal(enviados.whatsapp.length, 0);
  assert.equal(avisosGuardados[0].whatsappEnviado, false);
  assert.match(avisosGuardados[0].error, /no es administrativa/);
  assert.equal(enviados.push.length, 1, "queda la notificación al teléfono");

  reiniciar();
  config({ reasignacionActiva: false });
  mundo.numeros = {};
  mundo.chats = [chat()];
  await vuelta(mas(T0, 5));
  assert.equal(enviados.whatsapp.length, 0);
  assert.match(avisosGuardados[0].error, /sin número/);
});

await prueba("línea Admin desconectada: el aviso queda como fallido pero la reasignación se hace igual", async () => {
  config();
  mundo.lineaCaida = true;
  mundo.chats = [chat()];
  await vuelta(mas(T0, 30));
  assert.equal(mundo.chats[0].asesoraId !== "ingrid", true);
  assert.equal(avisosGuardados.find((a) => a.tipo === "REASIGNACION").whatsappEnviado, false);
});

await prueba("jamás se manda a un número que no sea del equipo", async () => {
  config();
  mundo.chats = [chat(), chat({ conversationId: "c2", asesoraId: "stef", ultimoClienteEn: mas(T0, -30) })];
  await vuelta(mas(T0, 5));
  await vuelta(mas(T0, 30));
  assert.ok(enviados.whatsapp.length > 0);
  for (const m of enviados.whatsapp) assert.ok(Object.values(NUMEROS).includes(m.phoneNumber), `número inesperado ${m.phoneNumber}`);
  assert.ok(enviados.whatsapp.every((m) => m.instanceName === "admin"));
});

await prueba("el conteo diario por asesora cuadra con el registro", async () => {
  config();
  mundo.chats = [
    chat(),
    chat({ conversationId: "c2", asesoraId: "stef", asesoraNombre: NOMBRES.stef, ultimoClienteEn: mas(T0, 1) }),
  ];
  await vuelta(mas(T0, 6)); // avisos a ingrid y stef
  await vuelta(mas(T0, 31)); // reasignaciones
  const dia = r.diaDeBogota(T0);
  const reg = await registro.leerRegistroDelDia(WS, dia);
  assert.equal(reg.total, avisosGuardados.length);
  const ingrid = reg.conteo.find((c) => c.asesoraId === "ingrid");
  assert.equal(ingrid.avisos, 1);
  assert.equal(ingrid.reasignadosDeEllaA, 1);
  const recibidos = reg.conteo.reduce((suma, c) => suma + c.recibidos, 0);
  assert.equal(recibidos, avisosGuardados.filter((a) => a.tipo === "REASIGNACION").length);
  assert.equal(reg.conteo.reduce((suma, c) => suma + c.avisos, 0), avisosGuardados.filter((a) => a.tipo === "AVISO").length);
  const otroDia = await registro.leerRegistroDelDia(WS, "2026-10-05");
  assert.equal(otroDia.total, 0);
});

await prueba("el vigilante lee su configuración guardada", async () => {
  assert.equal(typeof accionable.gestionarAcciones, "function");
  config({ avisosActivo: true });
  const cfg = await cargar("src/features/supervisor-reasignacion/servicios/config.ts", mocks).leerConfigReasignacion(WS);
  assert.equal(cfg.avisosActivo, true);
});

console.log(`\n${pruebas} pruebas del vigilante de reasignación OK`);
