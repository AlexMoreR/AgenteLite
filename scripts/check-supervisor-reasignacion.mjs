// Pruebas de los AVISOS POR WHATSAPP Y LA REASIGNACIÓN AUTOMÁTICA del Supervisor
// (src/features/supervisor-reasignacion): reglas puras, la vuelta del vigilante con la base y los
// envíos simulados, el registro del día, y que el Supervisor accionable no repite el WhatsApp.
// Sin red ni base real. Correr: npm run test:supervisor-reasignacion
import assert from "node:assert/strict";
import { cargar } from "./supervisor-cargar.mjs";

/* ------------------------------------------------------------------ base y envíos simulados */

/** El error de Prisma por regla única (lo que mira el vigilante). */
class PrismaClientKnownRequestError extends Error {
  constructor(mensaje, { code }) {
    super(mensaje);
    this.code = code;
  }
}

const WS = "ws1";
const M = 60_000;
/** La hora de la "base" (creadoEn por defecto = now()). La fija cada vuelta. */
let reloj = new Date("2026-10-06T15:00:00Z");

const settings = new Map();
const avisos = []; // filas de SupervisorAviso
let siguienteId = 1;
const llamadas = { updateMany: [], deletes: [], actividad: [], realtime: [], pushAsignacion: [], whatsapp: [], push: [], lecturas: [] };
const simular = {
  /** La base falla al mover el chat (no un count 0: una excepción). */
  updateFalla: false,
  /** El chat lo movió otra persona entre tanto: updateMany devuelve 0. */
  conteoCero: false,
  /** Una persona le escribió al cliente justo antes de reasignar. */
  respuestaHumana: false,
  /** La lectura del registro "no ve" lo anotado (para probar la regla única de la base). */
  registroCiego: false,
  /** La base ve un "En espera" vigente puesto en este momento (lo que se vuelve a mirar justo antes de mover el chat). */
  enEsperaEn: null,
};
let chatsAbiertos = [];
/** Las colaboradoras de la línea de ventas (metadata.collaboratorIds). */
let colaboradoras = ["maria", "ingrid", "genesis"];
const MIEMBROS = [
  { userId: "alex", role: "OWNER", name: "Magilus" },
  { userId: "maria", role: "MEMBER", name: "Maria Bautista" },
  { userId: "ingrid", role: "MEMBER", name: "Ingrid Sanchez" },
  { userId: "genesis", role: "MEMBER", name: "Genesis Moreno" },
  { userId: "laura", role: "MEMBER", name: "Laura Sin Número" },
  { userId: "sofia", role: "MEMBER", name: "Sofia Teléfono Cliente" },
];
const NOMBRES = Object.fromEntries(MIEMBROS.map((m) => [m.userId, m.name]));
const numeroDelChat = (id) => 1000 + Number(id.replace(/\D/g, "") || 0);

function lineaPorId(id) {
  if (id === "linea-admin") return { id, purpose: "ADMIN", evolutionInstanceName: "admin", metadata: {} };
  if (id === "linea-ventas") return { id, purpose: "SALES", evolutionInstanceName: "ventas", metadata: { collaboratorIds: colaboradoras } };
  return null;
}

function cumple(fila, where) {
  for (const [campo, cond] of Object.entries(where ?? {})) {
    const valor = fila[campo];
    if (cond && typeof cond === "object" && !(cond instanceof Date)) {
      if (cond.in && !cond.in.includes(valor)) return false;
      if (cond.gte && !(valor.getTime() >= cond.gte.getTime())) return false;
      if (cond.lt && !(valor.getTime() < cond.lt.getTime())) return false;
    } else if (valor !== cond) return false;
  }
  return true;
}

const prisma = {
  appSetting: {
    findUnique: async ({ where }) => (settings.has(where.key) ? { key: where.key, value: settings.get(where.key) } : null),
    findMany: async ({ where } = {}) =>
      [...settings.entries()].filter(([key]) => !where?.key?.startsWith || key.startsWith(where.key.startsWith)).map(([key, value]) => ({ key, value })),
    upsert: async ({ where, create, update }) => {
      settings.set(where.key, settings.has(where.key) ? update.value : create.value);
      return {};
    },
  },
  supervisorAviso: {
    create: async ({ data }) => {
      const repetida = avisos.find((f) => f.conversationId === data.conversationId && f.tipo === data.tipo && f.episodio.getTime() === data.episodio.getTime());
      if (repetida) throw new PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002" });
      const fila = { id: `av${siguienteId++}`, whatsappEnviado: false, creadoEn: new Date(reloj), ...data, episodio: new Date(data.episodio) };
      avisos.push(fila);
      return { id: fila.id };
    },
    findMany: async ({ where, orderBy }) => {
      if (simular.registroCiego) return [];
      const filas = avisos.filter((f) => cumple(f, where)).map((f) => ({ ...f }));
      if (orderBy?.creadoEn === "desc") filas.sort((a, b) => b.creadoEn - a.creadoEn);
      return filas;
    },
    update: async ({ where, data }) => {
      const fila = avisos.find((f) => f.id === where.id);
      if (!fila) throw new Error("no existe");
      Object.assign(fila, data);
      return fila;
    },
    delete: async ({ where }) => {
      llamadas.deletes.push(where.id);
      const i = avisos.findIndex((f) => f.id === where.id);
      if (i < 0) throw new Error("no existe");
      return avisos.splice(i, 1)[0];
    },
  },
  conversation: {
    findMany: async ({ where }) =>
      where.id.in.map((id) => ({ id, numero: numeroDelChat(id), channelId: "linea-ventas", contactId: `ct-${id}` })),
    findFirst: async ({ where }) => ({ id: where.id, numero: numeroDelChat(where.id) }),
    updateMany: async (args) => {
      llamadas.updateMany.push(args);
      if (simular.updateFalla) throw new Error("la base no respondió");
      return { count: simular.conteoCero ? 0 : 1 };
    },
  },
  message: {
    findFirst: async ({ where }) => {
      // La nota del botón "En espera" (mensaje del sistema) o una respuesta de una persona.
      if (where?.type === "SYSTEM") return simular.enEsperaEn ? { createdAt: simular.enEsperaEn, rawPayload: { origen: "en-espera" } } : null;
      return simular.respuestaHumana ? { id: "m-humano" } : null;
    },
  },
  embudoLead: { findMany: async () => [] },
  whatsAppChannel: { findFirst: async ({ where }) => lineaPorId(where.id) },
  workspaceMember: {
    findMany: async ({ where }) =>
      MIEMBROS.filter((m) => (!where.role || where.role.in.includes(m.role)) && (!where.userId?.in || where.userId.in.includes(m.userId))).map((m) => ({ userId: m.userId })),
    findFirst: async ({ where }) => {
      const m = MIEMBROS.find((x) => x.userId === where.userId);
      return m ? { user: { name: m.name, email: null } } : null;
    },
  },
};

const mocks = {
  "@prisma/client": { Prisma: { PrismaClientKnownRequestError } },
  "@/lib/prisma": { prisma },
  "@/lib/web-push": {
    sendPushToUser: async ({ userId, payload }) => {
      llamadas.push.push({ userId, ...payload });
      return 1;
    },
  },
  "@/lib/evolution": {
    sendEvolutionTextMessageWithReconnect: async ({ instanceName, phoneNumber, text }) => {
      llamadas.whatsapp.push({ instanceName, phoneNumber, text });
    },
  },
  "@/lib/anti-bloqueo/servicio": { leerConfigAntiBloqueo: async () => ({ avisos: { canalInternoId: "linea-admin" } }) },
  "@/features/supervisor/servicios/datos": {
    leerChatsAbiertos: async () => {
      llamadas.lecturas.push(reloj);
      return chatsAbiertos;
    },
    nombresDeAsesoras: async () => NOMBRES,
  },
  "@/lib/conversation-activity": { recordConversationActivity: async (input) => llamadas.actividad.push(input) },
  "@/lib/realtime-notify": { notifyRealtimeUpdate: async (input) => llamadas.realtime.push(input) },
  "@/lib/reparto-de-leads": { avisarAsignacionPorPush: async (input) => llamadas.pushAsignacion.push(input) },
  "@/lib/horario-de-reparto": { filtrarPorHorario: async (_ws, ids) => ids },
  "@/lib/en-linea": { filtrarSinPausaManual: async (_ws, ids) => new Set(ids) },
};

const r = cargar("src/features/supervisor-reasignacion/dominio/reglas.ts", mocks);
const vigilante = cargar("src/features/supervisor-reasignacion/servicios/vigilante.ts", mocks);
const registro = cargar("src/features/supervisor-reasignacion/servicios/registro.ts", mocks);
const enrutador = cargar("src/features/avisos-gravedad/servicios/enrutador.ts", mocks);
const accionable = cargar("src/features/supervisor-accionable/servicios/accionable.ts", mocks);
const reglasAccionable = cargar("src/features/supervisor-accionable/dominio/reglas.ts", mocks);

let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

/* ------------------------------------------------------------------ ayudas */

/** Una hora de Bogotá (UTC−5 fijo): bog("2026-10-06 10:05"). */
const bog = (texto) => new Date(`${texto.replace(" ", "T")}:00-05:00`);
const mas = (fecha, min) => new Date(fecha.getTime() + min * M);
const MARTES = "2026-10-06"; // martes
const T0 = bog(`${MARTES} 10:00`);
const HORARIO = r.CONFIG_REASIGNACION_POR_DEFECTO.horario;

const NUM = { dueno: "573000002277", maria: "573000001111", genesis: "573000003333", ingrid: "573000004444" };
const TEL_CLIENTE = "573001234567";

function chatAbierto({ id = "c1", asesora = "maria", clienteEn = T0, ...extra } = {}) {
  return {
    conversationId: id,
    asesoraId: asesora,
    asesoraNombre: NOMBRES[asesora] ?? null,
    etapa: "CALIFICADO",
    ultimoClienteEn: clienteEn,
    ultimaRespuestaHumanaEn: null,
    textosPendientes: ["cuánto vale el envío?"],
    textosDelCliente: ["hola", "cuánto vale el envío?"],
    telefono: TEL_CLIENTE,
    asignadaEn: mas(clienteEn, -60),
    temperatura: null,
    nombreCliente: `Cliente ${id}`,
    mensajes: [{ direccion: "IN", tipo: "TEXT", origen: null, texto: "cuánto vale el envío?", en: clienteEn }],
    ...extra,
  };
}

// Las pruebas de la mecánica general (anotar una vez, carreras, líneas) siguen con 30 min para reasignar;
// las de la regla "ya respondió" usan CFG_DEFECTO, con los tiempos por defecto (15 min).
const CFG = (extra = {}) => r.normalizarConfigReasignacion({ avisosActivos: true, reasignacionActiva: true, canalId: "linea-admin", reasignarMin: 30, ...extra });
const CFG_DEFECTO = (extra = {}) => r.normalizarConfigReasignacion({ avisosActivos: true, reasignacionActiva: true, canalId: "linea-admin", ...extra });

function reiniciar() {
  settings.clear();
  avisos.length = 0;
  for (const lista of Object.values(llamadas)) lista.length = 0;
  simular.updateFalla = false;
  simular.conteoCero = false;
  simular.respuestaHumana = false;
  simular.registroCiego = false;
  simular.enEsperaEn = null;
  colaboradoras = ["maria", "ingrid", "genesis"];
  chatsAbiertos = [];
  enrutador.olvidarConfigGravedad();
  accionable.olvidarConfigAccionable();
  settings.set(
    "agente-v3:avisos:ws1",
    JSON.stringify({
      canalId: "linea-admin",
      destinos: [
        { numero: NUM.dueno, soloDe: null },
        { numero: NUM.maria, soloDe: "maria", userId: "maria" },
        { numero: NUM.genesis, soloDe: "genesis", userId: "genesis" },
        { numero: NUM.ingrid, soloDe: "ingrid", userId: "ingrid" },
        // Por error, el número de un cliente quedó en la lista del equipo: igual nunca se le manda.
        { numero: TEL_CLIENTE, soloDe: "sofia", userId: "sofia" },
      ],
    }),
  );
  settings.set("avisos:gravedad:ws1", JSON.stringify({ activo: true }));
}

/** Una vuelta del vigilante a la hora dada. */
async function vuelta(hora, config = CFG()) {
  reloj = hora instanceof Date ? hora : bog(hora);
  return vigilante.vueltaDelNegocio({ workspaceId: WS, config, ahora: reloj });
}
const filas = (tipo) => avisos.filter((f) => !tipo || f.tipo === tipo);
const waA = (numero) => llamadas.whatsapp.filter((w) => w.phoneNumber === numero);

/* ------------------------------------------------------------------ reglas puras */

await prueba("minutosLaborales exacto: cruza el cierre, la noche y el domingo", () => {
  // Viernes 17:50 → sábado 8:10 (L–S 8–18): 10 min del viernes + 10 del sábado.
  assert.equal(r.minutosLaborales(bog("2026-10-09 17:50"), bog("2026-10-10 08:10"), HORARIO), 20);
  // Viernes 17:40 → sábado 8:10: 20 + 10.
  assert.equal(r.minutosLaborales(bog("2026-10-09 17:40"), bog("2026-10-10 08:10"), HORARIO), 30);
  // Sábado 19:00 → lunes 8:05: el domingo no cuenta.
  assert.equal(r.minutosLaborales(bog("2026-10-10 19:00"), bog("2026-10-12 08:05"), HORARIO), 5);
  assert.equal(r.minutosLaborales(T0, mas(T0, 4), HORARIO), 4);
  assert.equal(r.minutosLaborales(T0, mas(T0, 4.99), HORARIO), 4, "al minuto, hacia abajo");
  assert.equal(r.minutosLaborales(mas(T0, 5), T0, HORARIO), 0, "al revés = 0");
  assert.equal(r.minutosLaborales(bog("2026-10-06 06:00"), bog("2026-10-06 07:59"), HORARIO), 0, "antes de abrir");
  assert.equal(r.minutosLaborales(T0, mas(T0, 30 * 24 * 60), HORARIO), 6 * 10 * 60, "máximo 7 días");
  assert.equal(r.enHorarioLaboral(T0, HORARIO), true);
  assert.equal(r.enHorarioLaboral(bog("2026-10-06 18:00"), HORARIO), false);
  assert.equal(r.enHorarioLaboral(bog("2026-10-11 10:00"), HORARIO), false, "domingo");
});

await prueba("normalizarConfigReasignacion: apagado por defecto, acota valores y fuerza reasignarMin > avisoMin", () => {
  const d = r.normalizarConfigReasignacion({});
  assert.equal(d.avisosActivos, false);
  assert.equal(d.reasignacionActiva, false);
  assert.equal(d.avisoMin, 5);
  assert.equal(d.reasignarMin, 15);
  assert.equal(d.recordatorioMin, 30);
  assert.equal(d.avisoSupervisorMin, 120);
  assert.equal(d.esperaHoras, 4);
  assert.equal(d.calienteHoras, 24);
  assert.equal(d.canalId, r.LINEA_ADMIN_POR_DEFECTO);
  assert.deepEqual(r.leerConfigReasignacionDeTexto("{roto"), d);
  assert.deepEqual(r.leerConfigReasignacionDeTexto("[1,2]"), d);
  assert.equal(r.normalizarConfigReasignacion({ avisosActivos: "true", reasignacionActiva: "si" }).avisosActivos, true);
  assert.equal(r.normalizarConfigReasignacion({ reasignacionActiva: "si" }).reasignacionActiva, false, "solo true / 'true'");
  const c = r.normalizarConfigReasignacion({ avisoMin: 0, reasignarMin: 9999, calienteHoras: 0, canalId: "  otra  " });
  assert.equal(c.avisoMin, 1);
  assert.equal(c.reasignarMin, 600);
  assert.equal(c.calienteHoras, 1);
  assert.equal(c.canalId, "otra");
  assert.equal(r.normalizarConfigReasignacion({ avisoMin: 500 }).avisoMin, 240);
  assert.equal(r.normalizarConfigReasignacion({ avisoMin: 10, reasignarMin: 5 }).reasignarMin, 11, "reasignar siempre después del aviso");
  assert.equal(r.normalizarConfigReasignacion({ avisoMin: 240, reasignarMin: 2 }).reasignarMin, 241);
  assert.equal(r.normalizarConfigReasignacion({ avisoMin: "7", reasignarMin: "x" }).avisoMin, 7);
  assert.equal(r.normalizarConfigReasignacion({ reasignarMin: "x" }).reasignarMin, 15);
  assert.deepEqual(r.normalizarConfigReasignacion({ horario: { desde: 20, hasta: 10 } }).horario, HORARIO, "horario al revés = el de siempre");
  assert.deepEqual(r.normalizarConfigReasignacion({ horario: { desde: 7, hasta: 19, dias: [7, "2", 2, -1, 1.5, 5] } }).horario, { desde: 7, hasta: 19, dias: [2, 5] });
});

await prueba("inicioDeLaEspera: el PRIMER mensaje después de la última respuesta HUMANA (el bot no reinicia el reloj)", () => {
  const c = chatAbierto({
    mensajes: [
      { direccion: "IN", tipo: "TEXT", origen: null, texto: "hola", en: mas(T0, -30) },
      { direccion: "OUT", tipo: "TEXT", origen: "manual", texto: "hola!", en: mas(T0, -20) },
      { direccion: "IN", tipo: "TEXT", origen: null, texto: "precio?", en: mas(T0, -10) },
      { direccion: "IN", tipo: "SYSTEM", origen: "activity", texto: "nota", en: mas(T0, -5) },
      { direccion: "IN", tipo: "TEXT", origen: null, texto: "cuánto vale el envío?", en: T0 },
      { direccion: "IN", tipo: "TEXT", origen: null, texto: "posterior (no cuenta)", en: mas(T0, 5) },
    ],
  });
  assert.equal(r.inicioDeLaEspera(c).getTime(), mas(T0, -10).getTime());
  assert.equal(r.inicioDeLaEspera(chatAbierto({ mensajes: null })).getTime(), T0.getTime(), "sin mensajes: el último del cliente");
  assert.equal(r.inicioDeLaEspera(chatAbierto({ ultimoClienteEn: null })), null);
  // El bot contestó entre medio: para la asesora el reloj sigue desde el primer mensaje sin respuesta
  // humana; la TANDA (lo que pide la reasignación como margen) sí arranca después del bot.
  const conBot = chatAbierto({
    mensajes: [
      { direccion: "IN", tipo: "TEXT", origen: null, texto: "precio?", en: mas(T0, -40) },
      { direccion: "OUT", tipo: "TEXT", origen: null, texto: "vale 100", en: mas(T0, -39) },
      { direccion: "IN", tipo: "TEXT", origen: null, texto: "cuánto vale el envío?", en: T0 },
    ],
  });
  assert.equal(r.inicioDeLaEspera(conBot).getTime(), mas(T0, -40).getTime());
  assert.equal(r.inicioDeLaTanda(conBot).getTime(), T0.getTime());
});

await prueba("reloj: el bot contestando no evita la reasignación, pero la asesora siempre tiene el margen del aviso", () => {
  const config = CFG();
  const chat = chatAbierto({
    asignadaEn: mas(T0, -120),
    mensajes: [
      { direccion: "IN", tipo: "TEXT", origen: null, texto: "precio?", en: mas(T0, -40) },
      { direccion: "OUT", tipo: "TEXT", origen: null, texto: "vale 100", en: mas(T0, -39) },
      { direccion: "IN", tipo: "TEXT", origen: null, texto: "cuánto vale el envío?", en: T0 },
    ],
  });
  const decidir = (ahora) => r.decidirLaVuelta({ chats: [chat], ahora, config, yaAnotados: new Set() }).map((d) => d.tipo);
  // A las 10:00 ya lleva 40 min sin respuesta humana, pero la tanda acaba de empezar: aviso, no reasignación.
  assert.deepEqual(decidir(T0), ["AVISO"]);
  assert.deepEqual(decidir(mas(T0, 4)), ["AVISO"]);
  assert.deepEqual(decidir(mas(T0, 5)), ["REASIGNACION"]);
});

await prueba("al prender un interruptor no sale de golpe lo atrasado: el reloj cuenta desde que se prendió", () => {
  const prendido = mas(T0, 60);
  const anterior = r.normalizarConfigReasignacion({});
  const config = r.conMarcasDeActivacion(CFG(), anterior, prendido);
  assert.equal(config.avisosDesde.getTime(), prendido.getTime());
  assert.equal(config.reasignacionDesde.getTime(), prendido.getTime());
  // Volver a guardar con todo prendido conserva la marca; apagar la borra.
  assert.equal(r.conMarcasDeActivacion(CFG(), config, mas(prendido, 10)).avisosDesde.getTime(), prendido.getTime());
  assert.equal(r.conMarcasDeActivacion(CFG({ avisosActivos: false }), config, mas(prendido, 10)).avisosDesde, null);
  // Lo que mande la pantalla en esas marcas no cuenta.
  assert.equal(r.conMarcasDeActivacion(CFG({ avisosDesde: "2020-01-01T00:00:00Z" }), anterior, prendido).avisosDesde.getTime(), prendido.getTime());
  // Un cliente que espera desde las 10:00 y se prende a las 11:00: nada al prender, aviso 11:05, reasignación 11:30.
  const releido = r.leerConfigReasignacionDeTexto(JSON.stringify(config));
  const chat = chatAbierto();
  const decidir = (ahora) => r.decidirLaVuelta({ chats: [chat], ahora, config: releido, yaAnotados: new Set() }).map((d) => d.tipo);
  assert.deepEqual(decidir(prendido), []);
  assert.deepEqual(decidir(mas(prendido, 5)), ["AVISO"]);
  assert.deepEqual(decidir(mas(prendido, 30)), ["REASIGNACION"]);
});

await prueba("decidirLaVuelta: 4 min nada, 5 aviso, 30 reasignación; lo anotado no se decide dos veces", () => {
  const config = CFG();
  const c = chatAbierto();
  const decidir = (ahora, yaAnotados = new Set()) => r.decidirLaVuelta({ chats: [c], ahora, config, yaAnotados });
  assert.deepEqual(decidir(mas(T0, 4)), []);
  const cinco = decidir(mas(T0, 5));
  assert.deepEqual(cinco.map((d) => [d.tipo, d.asesoraId, d.minutos]), [["AVISO", "maria", 5]]);
  assert.equal(cinco[0].episodio.getTime(), T0.getTime());
  const anotado = new Set([r.claveDelEpisodio("c1", "AVISO", cinco[0].episodio)]);
  assert.deepEqual(decidir(mas(T0, 6), anotado), []);
  assert.deepEqual(decidir(mas(T0, 29), anotado), []);
  assert.deepEqual(decidir(mas(T0, 30), anotado).map((d) => d.tipo), ["REASIGNACION"]);
  // Un cliente que insiste: el reloj corre desde el PRIMER mensaje de la tanda (9:58), no el último.
  const insiste = chatAbierto({
    mensajes: [
      { direccion: "IN", tipo: "TEXT", origen: null, texto: "hola", en: mas(T0, -2) },
      { direccion: "IN", tipo: "TEXT", origen: null, texto: "cuánto vale el envío?", en: T0 },
    ],
  });
  const tanda = r.decidirLaVuelta({ chats: [insiste], ahora: mas(T0, 28), config, yaAnotados: new Set() });
  assert.deepEqual(tanda.map((d) => [d.tipo, d.minutos, d.episodio.getTime()]), [["REASIGNACION", 30, mas(T0, -2).getTime()]]);
  // Sin dueña, de otro país, ganado o resuelto: nada.
  assert.deepEqual(r.decidirLaVuelta({ chats: [chatAbierto({ asesora: null })], ahora: mas(T0, 40), config, yaAnotados: new Set() }), []);
  assert.deepEqual(r.decidirLaVuelta({ chats: [chatAbierto({ etapa: "GANADO" })], ahora: mas(T0, 40), config, yaAnotados: new Set() }), []);
  assert.deepEqual(r.decidirLaVuelta({ chats: [chatAbierto({ telefono: "5511987654321" })], ahora: mas(T0, 40), config, yaAnotados: new Set() }), []);
  // Un cierre ("muchas gracias") no espera respuesta.
  assert.deepEqual(r.decidirLaVuelta({ chats: [chatAbierto({ textosPendientes: ["muchas gracias"] })], ahora: mas(T0, 40), config, yaAnotados: new Set() }), []);
  // Los dos interruptores apagados: nada.
  assert.deepEqual(r.decidirLaVuelta({ chats: [c], ahora: mas(T0, 40), config: CFG({ avisosActivos: false, reasignacionActiva: false }), yaAnotados: new Set() }), []);
});

await prueba("pendientesPorAsesora y elegirAsesora: la de menos chats esperando, nunca la anterior", () => {
  const chats = [
    chatAbierto({ id: "c1", asesora: "maria" }),
    chatAbierto({ id: "c2", asesora: "ingrid" }),
    chatAbierto({ id: "c3", asesora: "ingrid" }),
    chatAbierto({ id: "c4", asesora: "genesis" }),
    chatAbierto({ id: "c5", asesora: "genesis", ultimaRespuestaHumanaEn: mas(T0, 1) }), // ya respondió
    chatAbierto({ id: "c6", asesora: null }),
  ];
  const p = r.pendientesPorAsesora(chats, mas(T0, 10), HORARIO);
  assert.deepEqual(Object.fromEntries(p), { maria: 1, ingrid: 2, genesis: 1 });
  assert.equal(r.elegirAsesora(["maria", "ingrid", "genesis"], p, "maria"), "genesis");
  assert.equal(r.elegirAsesora(["maria", "ingrid", "genesis"], p, "genesis"), "maria");
  assert.equal(r.elegirAsesora(["ingrid", "laura"], p, "maria"), "laura", "sin pendientes = 0");
  assert.equal(r.elegirAsesora(["maria", "genesis"], new Map(), "ingrid"), "maria", "a igualdad, la primera");
  assert.equal(r.elegirAsesora(["maria"], p, "maria"), null);
  assert.equal(r.elegirAsesora([], p, "maria"), null);
});

await prueba("textos: cortos, con enlace, sin el teléfono del cliente; un solo mensaje con todas las líneas", () => {
  assert.equal(r.clienteDelChat({ nombreCliente: "Laura Gómez", telefono: TEL_CLIENTE }), "Laura Gómez");
  assert.equal(r.clienteDelChat({ nombreCliente: "+57 300 123 4567", telefono: TEL_CLIENTE }), "•••• 4567");
  assert.equal(r.clienteDelChat({ nombreCliente: null, telefono: TEL_CLIENTE }), "•••• 4567");
  assert.equal(r.clienteDelChat({ nombreCliente: "", telefono: null }), "cliente sin nombre");
  assert.equal(r.enlaceDelChat(1001, "c1"), "https://app.aizenbot.com/c/1001");
  assert.match(r.enlaceDelChat(null, "c1"), /chatKey=agent%3Ac1/);
  assert.equal(r.etiquetaDeEtapa("NEGOCIACION"), "Caliente");
  assert.equal(r.etiquetaDeEtapa(null), "Sin etapa");
  const base = { cliente: "Laura Gómez", etapa: "Calificado", enlace: "https://app.aizenbot.com/c/1001" };
  const texto = r.textoDelAviso([
    { tipo: "AVISO", ...base, minutos: 5 },
    { tipo: "BOT_PIDIO_ASESORA", ...base, minutos: 7 },
    { tipo: "CALIENTE_24H", ...base, minutos: 24 * 60 },
    { tipo: "REASIGNADO_A_TI", ...base, minutos: 30, otra: "Maria Bautista" },
    { tipo: "TE_LO_QUITARON", ...base, minutos: 30, otra: "Genesis Moreno" },
    { tipo: "SIN_CANDIDATA", ...base, minutos: 30, otra: "Maria Bautista", motivo: "sin_asesora" },
    { tipo: "SIN_CANDIDATA", ...base, minutos: 60, otra: "Genesis Moreno", motivo: "ya_reasignado" },
  ]);
  assert.ok(texto.startsWith("*Supervisor*"));
  for (const parte of ["5 min esperando tu respuesta", "El bot pidió asesora", "Caliente sin mensaje tuyo hace 24 h", "Te pasaron este chat (era de Maria Bautista)", "Se le pasó a Genesis Moreno", "No hay otra asesora disponible", "Ya se reasignó y sigue sin respuesta (Genesis Moreno)", "1 h"]) {
    assert.ok(texto.includes(parte), `el texto trae "${parte}"`);
  }
  assert.equal(texto.split("app.aizenbot.com/c/1001").length - 1, 7, "cada línea con su enlace");
  assert.ok(!texto.includes("3001234567"));
});

await prueba("conteoPorAsesora: avisos, le quitaron, recibió, sin candidata y WhatsApp fallidos", () => {
  const conteo = r.conteoPorAsesora([
    { tipo: "AVISO", asesoraId: "maria", asesoraNuevaId: null, whatsappEnviado: true },
    { tipo: "AVISO", asesoraId: "maria", asesoraNuevaId: null, whatsappEnviado: false },
    { tipo: "REASIGNACION", asesoraId: "maria", asesoraNuevaId: "genesis", whatsappEnviado: true },
    { tipo: "BOT_PIDIO_ASESORA", asesoraId: "ingrid", asesoraNuevaId: null, whatsappEnviado: true },
    { tipo: "CALIENTE_24H", asesoraId: "ingrid", asesoraNuevaId: null, whatsappEnviado: true },
    { tipo: "SIN_CANDIDATA", asesoraId: "genesis", asesoraNuevaId: null, whatsappEnviado: true },
  ]);
  assert.deepEqual(conteo.map((c) => c.asesoraId), ["maria", "genesis", "ingrid"], "primero a la que más le quitaron");
  const de = Object.fromEntries(conteo.map((c) => [c.asesoraId, c]));
  assert.deepEqual(de.maria, { asesoraId: "maria", avisos: 2, botPidioAsesora: 0, caliente24h: 0, recordatorios: 0, sinRespuesta2h: 0, noReasignados: 0, reasignadosLeQuitaron: 1, reasignadosRecibio: 0, sinCandidata: 0, whatsappFallidos: 1 });
  assert.equal(de.genesis.reasignadosRecibio, 1);
  assert.equal(de.genesis.sinCandidata, 1);
  assert.equal(de.ingrid.botPidioAsesora, 1);
  assert.equal(de.ingrid.caliente24h, 1);
  assert.deepEqual(r.conteoPorAsesora([]), []);
});

await prueba("rangoDelDia / fechaBogota: el día de Bogotá en UTC", () => {
  const rango = r.rangoDelDia(MARTES);
  assert.equal(rango.desde.toISOString(), "2026-10-06T05:00:00.000Z");
  assert.equal(rango.hasta.toISOString(), "2026-10-07T05:00:00.000Z");
  assert.equal(r.rangoDelDia("06-10-2026"), null);
  assert.equal(r.rangoDelDia("2026-13-45"), null);
  assert.equal(r.fechaBogota(new Date("2026-10-07T04:59:00Z")), MARTES, "las 23:59 de Bogotá siguen siendo el martes");
  assert.equal(r.fechaBogota(new Date("2026-10-07T05:00:00Z")), "2026-10-07");
});

/* ------------------------------------------------------------------ el vigilante (base y envíos simulados) */

await prueba("caso 1: martes 10:00 sin respuesta → 10:04 nada; 10:05 UN aviso aunque la vuelta corra varias veces", async () => {
  reiniciar();
  chatsAbiertos = [chatAbierto()];
  let res = await vuelta(`${MARTES} 10:04`);
  assert.equal(res.decisiones.length, 0);
  assert.equal(avisos.length, 0);
  for (const hora of ["10:05", "10:05", "10:05", "10:06"]) await vuelta(`${MARTES} ${hora}`);
  assert.equal(filas("AVISO").length, 1, "una sola fila");
  assert.equal(llamadas.whatsapp.length, 1, "un solo WhatsApp");
  const w = llamadas.whatsapp[0];
  assert.equal(w.phoneNumber, NUM.maria);
  assert.equal(w.instanceName, "admin", "por la línea Admin");
  assert.match(w.text, /Cliente c1 · Calificado · 5 min esperando tu respuesta/);
  assert.match(w.text, /app\.aizenbot\.com\/c\/1001/);
  assert.ok(!w.text.includes("3001234567"));
  assert.equal(filas("AVISO")[0].whatsappEnviado, true);
  assert.equal(filas("AVISO")[0].asesoraId, "maria");
  assert.equal(filas("AVISO")[0].minutosEsperando, 5);
  // La regla única de la base: aunque la lectura del registro no lo vea, no se manda dos veces.
  simular.registroCiego = true;
  res = await vuelta(`${MARTES} 10:07`);
  assert.deepEqual(res.decisiones.map((d) => d.tipo), ["AVISO"], "se decide de nuevo…");
  assert.equal(res.enviados.length, 0, "…pero la base no deja anotarlo y no sale");
  assert.equal(llamadas.whatsapp.length, 1);
  simular.registroCiego = false;
});

await prueba("caso 1: 10:30 pasa a la de menos pendientes, avisa a las dos, nota 'assigned'; 10:31 nada", async () => {
  // Ingrid tiene otro chat esperando; Genesis ninguno → va para Genesis.
  chatsAbiertos = [chatAbierto(), chatAbierto({ id: "c9", asesora: "ingrid", clienteEn: bog(`${MARTES} 10:28`), nombreCliente: "Otro" })];
  let res = await vuelta(`${MARTES} 10:29`);
  assert.equal(res.reasignados.length, 0);
  res = await vuelta(`${MARTES} 10:30`);
  assert.deepEqual(res.reasignados, [{ conversationId: "c1", de: "maria", a: "genesis" }]);
  assert.equal(llamadas.updateMany.length, 1);
  assert.deepEqual(llamadas.updateMany[0], {
    where: { id: "c1", workspaceId: WS, assignedToUserId: "maria", status: "OPEN" },
    data: { assignedToUserId: "genesis" },
  });
  assert.equal(llamadas.actividad.length, 1);
  assert.equal(llamadas.actividad[0].kind, "assigned");
  assert.equal(llamadas.actividad[0].assigneeUserId, "genesis");
  assert.match(llamadas.actividad[0].text, /Supervisor pasó el chat a Genesis Moreno: Maria Bautista no le había escrito al cliente en 30 min/);
  assert.deepEqual(llamadas.pushAsignacion, [{ conversationId: "c1", userId: "genesis" }]);
  assert.equal(llamadas.realtime.length, 1);
  const rea = filas("REASIGNACION");
  assert.equal(rea.length, 1);
  assert.equal(rea[0].asesoraNuevaId, "genesis");
  assert.equal(rea[0].whatsappEnviado, true);
  assert.equal(llamadas.whatsapp.length, 3, "el aviso de las 10:05 + dos de la reasignación");
  assert.match(waA(NUM.genesis)[0].text, /Te pasaron este chat \(era de Maria Bautista\)/);
  assert.match(waA(NUM.maria)[1].text, /Se le pasó a Genesis Moreno el chat de Cliente c1/);
  assert.equal(waA(NUM.ingrid).length, 0);
  // 10:31: el chat ya es de Genesis (la nota de asignación es de las 10:30).
  chatsAbiertos = [chatAbierto({ asesora: "genesis", asignadaEn: bog(`${MARTES} 10:30`) })];
  res = await vuelta(`${MARTES} 10:31`);
  assert.equal(res.decisiones.length, 0);
  assert.equal(llamadas.whatsapp.length, 3);
  assert.equal(llamadas.updateMany.length, 1);
});

await prueba("caso 8b: ya se reasignó y la nueva tampoco contesta → aviso a los 5 y SIN_CANDIDATA al dueño a los 30 (no se pasa de nuevo)", async () => {
  let res = await vuelta(`${MARTES} 10:35`);
  assert.deepEqual(res.decisiones.map((d) => [d.tipo, d.asesoraId]), [["AVISO", "genesis"]], "su reloj arrancó cuando le llegó");
  assert.equal(waA(NUM.genesis).length, 2);
  res = await vuelta(`${MARTES} 11:00`);
  assert.deepEqual(res.decisiones.map((d) => [d.tipo, d.motivo]), [["SIN_CANDIDATA", "ya_reasignado"]]);
  assert.equal(res.reasignados.length, 0);
  assert.equal(llamadas.updateMany.length, 1, "no se reasigna de nuevo");
  const dueno = waA(NUM.dueno);
  assert.equal(dueno.length, 1);
  assert.match(dueno[0].text, /Ya se reasignó y sigue sin respuesta \(Genesis Moreno\)/);
  assert.ok(llamadas.push.some((p) => p.userId === "alex"), "y un push al dueño");
  await vuelta(`${MARTES} 11:01`);
  await vuelta(`${MARTES} 11:30`);
  assert.equal(waA(NUM.dueno).length, 1, "una sola vez");
});

await prueba("caso 12: leerRegistroDelDia cuadra con lo que quedó en el registro", async () => {
  const reg = await registro.leerRegistroDelDia(WS, MARTES);
  assert.equal(reg.fecha, MARTES);
  assert.deepEqual(reg.filas.map((f) => f.tipo), ["SIN_CANDIDATA", "AVISO", "REASIGNACION", "AVISO"], "de la más nueva a la más vieja");
  const rea = reg.filas.find((f) => f.tipo === "REASIGNACION");
  assert.equal(rea.asesora, "Maria Bautista");
  assert.equal(rea.asesoraNueva, "Genesis Moreno");
  assert.equal(rea.numeroDelChat, 1001);
  assert.equal(rea.minutosEsperando, 30);
  const de = Object.fromEntries(reg.conteo.map((c) => [c.asesoraId, c]));
  assert.equal(de.maria.asesora, "Maria Bautista");
  assert.equal(de.maria.avisos, 1);
  assert.equal(de.maria.reasignadosLeQuitaron, 1);
  assert.equal(de.genesis.reasignadosRecibio, 1);
  assert.equal(de.genesis.avisos, 1);
  assert.equal(de.genesis.sinCandidata, 1);
  assert.equal(de.genesis.whatsappFallidos + de.maria.whatsappFallidos, 0);
  assert.deepEqual(
    reg.conteo.map((c) => {
      const sinNombre = { ...c };
      delete sinNombre.asesora;
      return sinNombre;
    }),
    r.conteoPorAsesora(avisos),
  );
  assert.equal((await registro.leerRegistroDelDia(WS, "2026-10-07")).filas.length, 0, "otro día: nada");
  assert.equal(await registro.leerRegistroDelDia(WS, "ayer"), null);
});

await prueba("caso 2: la asesora contesta a las 10:20 → ni reasignación ni aviso nuevo", async () => {
  reiniciar();
  chatsAbiertos = [chatAbierto()];
  await vuelta(`${MARTES} 10:05`);
  assert.equal(llamadas.whatsapp.length, 1);
  chatsAbiertos = [chatAbierto({ ultimaRespuestaHumanaEn: bog(`${MARTES} 10:20`) })];
  for (const hora of ["10:25", "10:30", "10:45"]) {
    const res = await vuelta(`${MARTES} ${hora}`);
    assert.equal(res.decisiones.length, 0, hora);
  }
  assert.equal(llamadas.whatsapp.length, 1);
  assert.equal(llamadas.updateMany.length, 0);
  assert.equal(filas("REASIGNACION").length, 0);
});

await prueba("caso 3: fuera de horario (sábado 19:00 o domingo) → nada ese día; el lunes aviso 8:05 y reasignación 8:30", async () => {
  for (const escribio of ["2026-10-10 19:00", "2026-10-11 10:00"]) {
    reiniciar();
    chatsAbiertos = [chatAbierto({ clienteEn: bog(escribio) })];
    for (const hora of ["2026-10-10 19:30", "2026-10-10 23:00", "2026-10-11 10:30", "2026-10-11 17:00", "2026-10-12 07:59", "2026-10-12 08:04"]) {
      if (bog(hora) < bog(escribio)) continue;
      const res = await vuelta(hora);
      assert.equal(res.decisiones.length, 0, `${escribio} → ${hora}: nada`);
    }
    assert.equal(avisos.length, 0);
    let res = await vuelta("2026-10-12 08:05");
    assert.deepEqual(res.decisiones.map((d) => [d.tipo, d.minutos]), [["AVISO", 5]], escribio);
    res = await vuelta("2026-10-12 08:29");
    assert.equal(res.decisiones.length, 0);
    res = await vuelta("2026-10-12 08:30");
    assert.deepEqual(res.reasignados.map((x) => x.a), ["ingrid"], "la primera disponible distinta de la anterior");
  }
});

await prueba("caso 4: con reasignarMin 15 el chat se pasa a los 15", async () => {
  reiniciar();
  chatsAbiertos = [chatAbierto()];
  const config = CFG({ reasignarMin: 15 });
  assert.equal((await vuelta(`${MARTES} 10:05`, config)).decisiones[0].tipo, "AVISO");
  assert.equal((await vuelta(`${MARTES} 10:14`, config)).reasignados.length, 0);
  assert.equal((await vuelta(`${MARTES} 10:15`, config)).reasignados.length, 1);
  assert.equal(filas("REASIGNACION")[0].minutosEsperando, 15);
});

await prueba("caso 5: con un interruptor apagado ese paso no hace nada y el otro sigue", async () => {
  // Avisos apagados: nada a los 5, a los 30 reasigna.
  reiniciar();
  chatsAbiertos = [chatAbierto()];
  const sinAvisos = CFG({ avisosActivos: false });
  assert.equal((await vuelta(`${MARTES} 10:05`, sinAvisos)).decisiones.length, 0);
  assert.equal((await vuelta(`${MARTES} 10:29`, sinAvisos)).decisiones.length, 0);
  assert.equal(llamadas.whatsapp.length, 0);
  const res = await vuelta(`${MARTES} 10:30`, sinAvisos);
  assert.equal(res.reasignados.length, 1);
  assert.equal(filas("AVISO").length, 0);
  // Reasignación apagada: aviso a los 5, nada a los 30.
  reiniciar();
  chatsAbiertos = [chatAbierto()];
  const sinReasignar = CFG({ reasignacionActiva: false });
  assert.equal((await vuelta(`${MARTES} 10:05`, sinReasignar)).decisiones[0].tipo, "AVISO");
  for (const hora of ["10:30", "10:31", "11:30"]) {
    const r2 = await vuelta(`${MARTES} ${hora}`, sinReasignar);
    assert.equal(r2.decisiones.length, 0, hora);
  }
  assert.equal(llamadas.updateMany.length, 0);
  assert.equal(llamadas.whatsapp.length, 1);
});

await prueba("caso 6: Caliente sin mensaje de su asesora: 23 h no, 24 h sí, una sola vez", async () => {
  reiniciar();
  const respondio = bog("2026-10-05 11:00"); // lunes
  chatsAbiertos = [
    chatAbierto({ etapa: "NEGOCIACION", clienteEn: bog("2026-10-05 10:50"), ultimaRespuestaHumanaEn: respondio, asignadaEn: bog("2026-10-05 09:00") }),
  ];
  let res = await vuelta(mas(respondio, 23 * 60));
  assert.equal(res.decisiones.length, 0, "23 h: no");
  res = await vuelta(mas(respondio, 24 * 60));
  assert.deepEqual(res.decisiones.map((d) => [d.tipo, d.minutos]), [["CALIENTE_24H", 24 * 60]]);
  assert.match(llamadas.whatsapp[0].text, /Caliente sin mensaje tuyo hace 24 h: Cliente c1 · Caliente/);
  await vuelta(mas(respondio, 24 * 60 + 1));
  await vuelta(mas(respondio, 26 * 60));
  assert.equal(filas("CALIENTE_24H").length, 1);
  assert.equal(llamadas.whatsapp.length, 1, "una sola vez");
});

await prueba("caso 7: el bot pidió asesora y nadie contestó → BOT_PIDIO_ASESORA a los 5 min", async () => {
  reiniciar();
  const pidio = T0;
  chatsAbiertos = [
    chatAbierto({
      clienteEn: mas(T0, -2),
      turno: { de: "MAGILUS", motivo: "bot_pidio_asesora", detalle: "El agente pide un asesor", ultimoClienteEn: mas(T0, -2), respondioEn: pidio },
      mensajes: [
        { direccion: "IN", tipo: "TEXT", origen: null, texto: "quiero hablar con una asesora", en: mas(T0, -2) },
        { direccion: "OUT", tipo: "TEXT", origen: null, texto: "En un momento una de nuestras asesoras te contacta 🙌", en: pidio },
      ],
    }),
  ];
  assert.equal((await vuelta(mas(pidio, 4))).decisiones.length, 0);
  const res = await vuelta(mas(pidio, 5));
  assert.deepEqual(res.decisiones.map((d) => [d.tipo, d.minutos]), [["BOT_PIDIO_ASESORA", 5]]);
  assert.equal(filas("BOT_PIDIO_ASESORA").length, 1);
  assert.match(waA(NUM.maria)[0].text, /El bot pidió asesora: Cliente c1/);
});

await prueba("caso 8a: sin otra asesora disponible → el chat no se mueve, SIN_CANDIDATA y aviso al dueño", async () => {
  reiniciar();
  colaboradoras = ["maria"];
  chatsAbiertos = [chatAbierto()];
  await vuelta(`${MARTES} 10:05`);
  const res = await vuelta(`${MARTES} 10:30`);
  assert.equal(res.reasignados.length, 0);
  assert.equal(llamadas.updateMany.length, 0, "el chat no se mueve");
  assert.equal(llamadas.actividad.length, 0);
  const sin = filas("SIN_CANDIDATA");
  assert.equal(sin.length, 1);
  assert.equal(sin[0].asesoraId, "maria");
  assert.equal(sin[0].whatsappEnviado, true);
  assert.equal(filas("REASIGNACION").length, 0);
  const dueno = waA(NUM.dueno);
  assert.equal(dueno.length, 1, "al destino sin soloDe (el dueño)");
  assert.match(dueno[0].text, /No hay otra asesora disponible para pasarle el chat \(es de Maria Bautista\)/);
  assert.deepEqual(llamadas.push.map((p) => p.userId), ["alex"]);
  // Las vueltas siguientes no repiten.
  await vuelta(`${MARTES} 10:31`);
  await vuelta(`${MARTES} 10:45`);
  assert.equal(waA(NUM.dueno).length, 1);
  assert.equal(filas("SIN_CANDIDATA").length, 1);
});

await prueba("caso 9: línea de ventas o asesora sin número → no se manda nada y la fila queda con el error", async () => {
  // La línea configurada es de ventas.
  reiniciar();
  chatsAbiertos = [chatAbierto()];
  let res = await vuelta(`${MARTES} 10:05`, CFG({ canalId: "linea-ventas" }));
  assert.equal(res.decisiones.length, 1);
  assert.equal(llamadas.whatsapp.length, 0, "nunca por una línea de ventas");
  assert.equal(filas("AVISO")[0].whatsappEnviado, false);
  assert.match(filas("AVISO")[0].error, /no es administrativa/);
  // Una línea que no existe.
  reiniciar();
  chatsAbiertos = [chatAbierto()];
  await vuelta(`${MARTES} 10:05`, CFG({ canalId: "no-existe" }));
  assert.equal(llamadas.whatsapp.length, 0);
  assert.match(filas("AVISO")[0].error, /no existe/);
  // La asesora no tiene número en la lista del equipo.
  reiniciar();
  chatsAbiertos = [chatAbierto({ asesora: "laura" })];
  res = await vuelta(`${MARTES} 10:05`);
  assert.equal(llamadas.whatsapp.length, 0);
  assert.deepEqual(res.enviados.map((e) => [e.destino, e.numero, e.ok]), [["laura", null, false]]);
  assert.equal(filas("AVISO")[0].whatsappEnviado, false);
  assert.match(filas("AVISO")[0].error, /no tiene número de avisos/);
  // El "número de avisos" de la asesora es el teléfono de un cliente: nunca se le manda.
  reiniciar();
  chatsAbiertos = [chatAbierto({ asesora: "sofia" })];
  res = await vuelta(`${MARTES} 10:05`);
  assert.equal(llamadas.whatsapp.length, 0);
  assert.equal(res.enviados[0].numero, null);
  assert.equal(filas("AVISO")[0].whatsappEnviado, false);
  // Y el WhatsApp que falla queda anotado.
  reiniciar();
  chatsAbiertos = [chatAbierto()];
  const original = mocks["@/lib/evolution"].sendEvolutionTextMessageWithReconnect;
  mocks["@/lib/evolution"].sendEvolutionTextMessageWithReconnect = async () => {
    throw new Error("instancia caída");
  };
  try {
    await vuelta(`${MARTES} 10:05`);
  } finally {
    mocks["@/lib/evolution"].sendEvolutionTextMessageWithReconnect = original;
  }
  assert.equal(filas("AVISO")[0].whatsappEnviado, false);
  assert.match(filas("AVISO")[0].error, /no salió el WhatsApp: instancia caída/);
});

await prueba("caso 10: varios chats de la misma asesora en la misma vuelta → UN solo WhatsApp con todos", async () => {
  reiniciar();
  chatsAbiertos = [chatAbierto({ id: "c1" }), chatAbierto({ id: "c2" }), chatAbierto({ id: "c3", clienteEn: mas(T0, -3) }), chatAbierto({ id: "c4", asesora: "ingrid" })];
  const res = await vuelta(`${MARTES} 10:05`);
  assert.equal(res.decisiones.length, 4);
  assert.equal(waA(NUM.maria).length, 1);
  assert.equal(waA(NUM.ingrid).length, 1);
  assert.equal(llamadas.whatsapp.length, 2);
  for (const id of ["c1", "c2", "c3"]) assert.ok(waA(NUM.maria)[0].text.includes(`Cliente ${id}`), id);
  assert.ok(!waA(NUM.maria)[0].text.includes("Cliente c4"));
  assert.ok(filas("AVISO").every((f) => f.whatsappEnviado));
});

await prueba("caso 11: carreras → otra la movió (count 0) se borra la fila; una persona ya respondió, no se reasigna", async () => {
  reiniciar();
  chatsAbiertos = [chatAbierto()];
  await vuelta(`${MARTES} 10:05`);
  simular.conteoCero = true;
  let res = await vuelta(`${MARTES} 10:30`);
  assert.equal(llamadas.updateMany.length, 1);
  assert.equal(res.reasignados.length, 0);
  assert.equal(llamadas.deletes.length, 1);
  assert.equal(filas("REASIGNACION").length, 0, "la fila se borró");
  assert.equal(llamadas.actividad.length, 0);
  assert.equal(llamadas.whatsapp.length, 1, "solo el aviso de las 10:05");
  // Respuesta humana justo antes de reasignar.
  reiniciar();
  chatsAbiertos = [chatAbierto()];
  simular.respuestaHumana = true;
  res = await vuelta(`${MARTES} 10:30`);
  assert.deepEqual(res.decisiones.map((d) => d.tipo), ["REASIGNACION"]);
  assert.equal(res.reasignados.length, 0);
  assert.equal(llamadas.updateMany.length, 0);
  assert.equal(avisos.length, 0);
  assert.equal(llamadas.whatsapp.length, 0);
});

await prueba("la base falla al mover el chat → se borra la anotación y la próxima vuelta lo reintenta", async () => {
  reiniciar();
  chatsAbiertos = [chatAbierto()];
  simular.updateFalla = true;
  let res = await vuelta(`${MARTES} 10:30`);
  assert.equal(res.reasignados.length, 0);
  assert.equal(filas("REASIGNACION").length, 0);
  assert.equal(llamadas.whatsapp.length, 0);
  simular.updateFalla = false;
  res = await vuelta(`${MARTES} 10:31`);
  assert.equal(res.reasignados.length, 1);
  assert.equal(llamadas.realtime[0].type, "waha-update", "la bandeja vuelve a pedir la fila del chat");
});

await prueba("el chat del dueño (no es asesora de la línea) no se reasigna", async () => {
  reiniciar();
  chatsAbiertos = [chatAbierto({ asesora: "alex" })];
  const res = await vuelta(`${MARTES} 10:30`);
  assert.equal(res.reasignados.length, 0);
  assert.equal(llamadas.updateMany.length, 0);
  assert.equal(avisos.length, 0);
});

await prueba("fuera de horario ni siquiera lee los chats", async () => {
  reiniciar();
  chatsAbiertos = [chatAbierto()];
  await vuelta("2026-10-06 19:00");
  await vuelta("2026-10-11 10:00");
  assert.equal(llamadas.lecturas.length, 0);
  await vuelta(`${MARTES} 10:05`);
  assert.equal(llamadas.lecturas.length, 1);
});

await prueba("sin chats con dueña o sin nada que decidir: no toca la base ni manda nada", async () => {
  reiniciar();
  chatsAbiertos = [chatAbierto({ asesora: null })];
  const res = await vuelta(`${MARTES} 11:00`);
  assert.deepEqual(res, { decisiones: [], reasignados: [], enviados: [] });
  assert.equal(llamadas.whatsapp.length + llamadas.push.length + avisos.length, 0);
});

/* ------------------------------------------------------------------ el accionable ya no repite el WhatsApp */

function chatAccionable(extra = {}) {
  return {
    conversationId: "c1",
    asesoraId: "maria",
    asesoraNombre: "Maria Bautista",
    etapa: "NEGOCIACION",
    ultimoClienteEn: mas(T0, -20),
    ultimaRespuestaHumanaEn: null,
    textosPendientes: ["cómo hago para separar el combo"],
    textosDelCliente: ["hola", "cómo hago para separar el combo"],
    telefono: TEL_CLIENTE,
    nombreCliente: "Laura Gómez",
    asignadaEn: mas(T0, -60),
    ...extra,
  };
}
function hallazgo(clave, chats) {
  return {
    clave,
    familia: "ATENCION",
    severidad: "IMPORTANTE",
    titulo: `alerta ${clave}`,
    que: "qué",
    desde: mas(T0, -20),
    producto: null,
    asesoraId: "maria",
    leadsAfectados: chats.length,
    evidencia: { chats, reglas: [], versiones: [] },
    metrica: "",
    esperado: "",
    observado: "",
    hechos: [],
    hipotesis: [],
    causaPosible: "",
    impacto: "Se pierden ventas.",
    recomendacion: "",
    queCambiar: "",
    riesgo: "",
    comoMedir: "",
    tocaProduccion: true,
  };
}

async function avisoDelAccionable(clave, chat, conAvisosNuevos) {
  reiniciar();
  settings.set("supervisor:accionable:ws1", JSON.stringify({ activo: true }));
  settings.set("equipo:supervisoras:ws1", JSON.stringify(["ingrid"]));
  if (conAvisosNuevos !== undefined) settings.set("supervisor:reasignacion:ws1", JSON.stringify({ avisosActivos: conAvisosNuevos }));
  accionable.olvidarConfigAccionable();
  const config = await accionable.leerConfigAccionable(WS);
  await accionable.gestionarAcciones({ workspaceId: WS, hallazgos: [hallazgo(clave, ["c1"])], chats: [chat], ahora: T0, config });
  return { push: llamadas.push.map((p) => p.userId), whatsapp: llamadas.whatsapp.map((w) => w.phoneNumber) };
}

await prueba("accionable: con avisosActivos el WhatsApp de 'caliente' y 'asignado' no sale (el push sí); 'pago' sigue", async () => {
  assert.equal(reglasAccionable.tipoDeLaClave("ATENCION:caliente-esperando:maria"), "caliente");
  const CALIENTE = "ATENCION:caliente-esperando:maria";
  const ASIGNADO = "ATENCION:asignado-sin-respuesta:maria";
  const PAGO = "ATENCION:pago-sin-respuesta:maria";
  // Sin la clave nueva (o apagada): como antes, push + WhatsApp a la asesora.
  assert.deepEqual(await avisoDelAccionable(CALIENTE, chatAccionable()), { push: ["maria"], whatsapp: [NUM.maria] });
  assert.deepEqual(await avisoDelAccionable(CALIENTE, chatAccionable(), false), { push: ["maria"], whatsapp: [NUM.maria] });
  // Con los avisos nuevos prendidos: solo el push.
  assert.deepEqual(await avisoDelAccionable(CALIENTE, chatAccionable(), true), { push: ["maria"], whatsapp: [] });
  assert.deepEqual(await avisoDelAccionable(ASIGNADO, chatAccionable(), true), { push: ["maria"], whatsapp: [] });
  // "Ya pagué" no lo cubren los avisos nuevos: el WhatsApp sigue.
  const pago = await avisoDelAccionable(PAGO, chatAccionable({ textosPendientes: ["ya pagué, te mando el comprobante"] }), true);
  assert.deepEqual(pago, { push: ["maria"], whatsapp: [NUM.maria] });
});

/* ------------------------------------------------------------------ regla nueva: ya respondió / En espera (25-oct-2026) */

/** Un chat donde la asesora ya le escribió al cliente (por el CRM o por el celular) y el cliente volvió a escribir en T0. */
function chatRespondido({ via = "manual", id = "c1", ...extra } = {}) {
  const ella = mas(T0, -30);
  return chatAbierto({
    id,
    asignadaEn: mas(T0, -120),
    ultimaRespuestaHumanaEn: ella,
    primeraRespuestaAsesoraEn: ella,
    ultimaRespuestaAsesoraEn: ella,
    mensajes: [
      { direccion: "IN", tipo: "TEXT", origen: null, texto: "cuánto vale el envío?", en: mas(T0, -40) },
      { direccion: "OUT", tipo: "TEXT", origen: via, texto: "ya te averiguo", en: ella },
      { direccion: "IN", tipo: "TEXT", origen: null, texto: "y entonces?", en: T0 },
    ],
    ...extra,
  });
}

await prueba("regla nueva 1: la asesora NO le ha escrito al cliente → aviso a los 5, reasignación a los 15 y línea en el historial", async () => {
  assert.equal(r.CONFIG_REASIGNACION_POR_DEFECTO.reasignarMin, 15);
  reiniciar();
  chatsAbiertos = [chatAbierto()];
  const config = CFG_DEFECTO();
  assert.equal((await vuelta(`${MARTES} 10:04`, config)).decisiones.length, 0);
  assert.deepEqual((await vuelta(`${MARTES} 10:05`, config)).decisiones.map((d) => d.tipo), ["AVISO"]);
  assert.equal((await vuelta(`${MARTES} 10:14`, config)).reasignados.length, 0);
  const res = await vuelta(`${MARTES} 10:15`, config);
  assert.equal(res.reasignados.length, 1);
  assert.equal(res.reasignados[0].de, "maria");
  assert.equal(filas("REASIGNACION")[0].minutosEsperando, 15);
  const linea = llamadas.actividad.find((a) => a.kind === "assigned");
  assert.match(linea.text, /^Supervisor pasó el chat a .+: Maria Bautista no le había escrito al cliente en 15 min\.$/);
});

await prueba("regla nueva 2: ya respondió ('ya te averiguo') por el CRM y por el celular → no se reasigna, recordatorio a los 30 y aviso al Supervisor a las 2 h", async () => {
  for (const via of ["manual", "instance"]) {
    reiniciar();
    chatsAbiertos = [chatRespondido({ via })];
    const config = CFG_DEFECTO();
    // Sin el aviso de los 5 minutos.
    assert.equal((await vuelta(`${MARTES} 10:05`, config)).decisiones.length, 0, via);
    assert.equal(filas("AVISO").length, 0);
    // 15 min: NO se reasigna y queda la línea en el historial (una sola vez).
    const quince = await vuelta(`${MARTES} 10:15`, config);
    assert.deepEqual(quince.decisiones.map((d) => d.tipo), ["NO_REASIGNADO"], via);
    assert.equal(quince.reasignados.length, 0);
    assert.equal(llamadas.updateMany.length, 0, "el chat nunca cambia de asesora");
    const noReasignado = llamadas.actividad.filter((a) => /^No se reasignó/.test(a.text));
    assert.equal(noReasignado.length, 1);
    assert.match(noReasignado[0].text, /Maria Bautista ya le había respondido al cliente/);
    assert.equal(noReasignado[0].kind, "note", "es una nota del sistema, no una asignación");
    assert.equal(llamadas.whatsapp.length, 0, "no sale ningún WhatsApp a los 15");
    // 29 min nada nuevo; 30 min recordatorio a ella.
    assert.equal((await vuelta(`${MARTES} 10:29`, config)).decisiones.length, 0);
    const treinta = await vuelta(`${MARTES} 10:30`, config);
    assert.deepEqual(treinta.decisiones.map((d) => d.tipo), ["RECORDATORIO"]);
    assert.equal(waA(NUM.maria).length, 1);
    assert.match(waA(NUM.maria)[0].text, /Recordatorio/);
    assert.equal(waA(NUM.dueno).length, 0, "todavía no se le avisa al Supervisor");
    assert.ok(llamadas.actividad.some((a) => /^Recordatorio a Maria Bautista/.test(a.text)));
    // 1 h 59: nada; a las 2 h aviso al Supervisor (al número del dueño).
    assert.equal((await vuelta(`${MARTES} 11:59`, config)).decisiones.length, 0);
    const dosHoras = await vuelta(`${MARTES} 12:00`, config);
    assert.deepEqual(dosHoras.decisiones.map((d) => d.tipo), ["SIN_RESPUESTA_2H"]);
    assert.equal(waA(NUM.dueno).length, 1);
    assert.match(waA(NUM.dueno)[0].text, /Maria Bautista lleva 2 h sin responderle/);
    assert.ok(llamadas.actividad.some((a) => /^Aviso al Supervisor: 2 h sin respuesta de Maria Bautista\.$/.test(a.text)));
    // Nunca se quita automáticamente, ni a las 3 ni a las 6 horas.
    await vuelta(`${MARTES} 13:00`, config);
    await vuelta(`${MARTES} 17:30`, config);
    assert.equal(llamadas.updateMany.length, 0);
    assert.equal(filas("REASIGNACION").length, 0);
    assert.deepEqual(filas().map((f) => f.tipo).sort(), ["NO_REASIGNADO", "RECORDATORIO", "SIN_RESPUESTA_2H"]);
  }
});

await prueba("regla nueva 3: solo respondió el bot (o un flujo) → no cuenta, el chat se reasigna a los 15 min", async () => {
  reiniciar();
  chatsAbiertos = [
    chatAbierto({
      asignadaEn: mas(T0, -120),
      mensajes: [
        { direccion: "IN", tipo: "TEXT", origen: null, texto: "cuánto vale el envío?", en: T0 },
        { direccion: "OUT", tipo: "TEXT", origen: null, texto: "vale 100", en: mas(T0, 0.5) },
        { direccion: "OUT", tipo: "TEXT", origen: "flow", texto: "mira el catálogo", en: mas(T0, 0.7) },
      ],
    }),
  ];
  const config = CFG_DEFECTO();
  assert.equal((await vuelta(`${MARTES} 10:14`, config)).reasignados.length, 0);
  assert.equal((await vuelta(`${MARTES} 10:15`, config)).reasignados.length, 1);
  assert.equal(filas("NO_REASIGNADO").length, 0);
});

await prueba("regla nueva 4: otra persona respondió desde el CRM con su usuario → no cuenta como respuesta de la asesora asignada", async () => {
  reiniciar();
  // La lectura de la base deja `primeraRespuestaAsesoraEn` vacía (no es de ella); sí hay respuesta humana de otra persona.
  chatsAbiertos = [
    chatAbierto({
      asignadaEn: mas(T0, -120),
      ultimaRespuestaHumanaEn: mas(T0, -30),
      primeraRespuestaAsesoraEn: null,
      mensajes: [
        { direccion: "IN", tipo: "TEXT", origen: null, texto: "precio?", en: mas(T0, -40) },
        { direccion: "OUT", tipo: "TEXT", origen: "manual", texto: "te ayudo yo", en: mas(T0, -30) },
        { direccion: "IN", tipo: "TEXT", origen: null, texto: "cuánto vale el envío?", en: mas(T0, -10) },
      ],
      ultimoClienteEn: mas(T0, -10),
    }),
  ];
  const config = CFG_DEFECTO();
  const res = await vuelta(`${MARTES} 10:05`, config);
  assert.deepEqual(res.decisiones.map((d) => d.tipo), ["REASIGNACION"], "10 min desde que el cliente volvió a escribir, tanda de 10");
  assert.equal(res.reasignados.length, 1);
});

await prueba("regla nueva 5: chat 'En espera' → ni recordatorios ni aviso al Supervisor ni reasignación; vuelven a las 4 h", async () => {
  reiniciar();
  const config = CFG_DEFECTO();
  // Ya había respondido y puso En espera a las 10:02.
  chatsAbiertos = [chatRespondido({ enEsperaDesde: mas(T0, 2) })];
  for (const hora of ["10:15", "10:30", "12:00", "13:59"]) {
    assert.equal((await vuelta(`${MARTES} ${hora}`, config)).decisiones.length, 0, hora);
  }
  assert.equal(llamadas.whatsapp.length, 0);
  assert.equal(llamadas.actividad.length, 0);
  // A las 4 h (14:02) se acaba la espera: sale el recordatorio, el aviso al Supervisor y la línea de "no se reasignó".
  const vencida = await vuelta(`${MARTES} 14:02`, config);
  assert.deepEqual(vencida.decisiones.map((d) => d.tipo).sort(), ["NO_REASIGNADO", "RECORDATORIO", "SIN_RESPUESTA_2H"]);
  assert.equal(llamadas.updateMany.length, 0);
  // Tampoco se reasigna a quien nunca respondió mientras está En espera.
  reiniciar();
  chatsAbiertos = [chatAbierto({ enEsperaDesde: mas(T0, 1) })];
  assert.equal((await vuelta(`${MARTES} 10:15`, config)).decisiones.length, 0);
  assert.equal((await vuelta(`${MARTES} 10:30`, config)).reasignados.length, 0);
  // Se vuelve a mirar justo antes de mover: si la lectura no lo veía pero ya está En espera, no se mueve ni se anota.
  reiniciar();
  chatsAbiertos = [chatAbierto()];
  simular.enEsperaEn = mas(T0, 10);
  const carrera = await vuelta(`${MARTES} 10:15`, config);
  assert.equal(carrera.reasignados.length, 0);
  assert.equal(llamadas.updateMany.length, 0);
  assert.equal(filas("REASIGNACION").length, 0, "no quedó anotada: cuando se quite se reintenta");
});

await prueba("regla nueva 6: En espera se acaba si ella le escribe al cliente y este vuelve a escribir", async () => {
  reiniciar();
  const config = CFG_DEFECTO();
  // En espera desde las 9:50; ella escribió a las 9:55 (acaba la espera) y el cliente volvió a escribir a las 10:00.
  chatsAbiertos = [chatRespondido({ enEsperaDesde: mas(T0, -10), ultimaRespuestaAsesoraEn: mas(T0, -5) })];
  assert.equal(r.enEsperaVigente(chatsAbiertos[0], mas(T0, 10), config), false);
  assert.equal((await vuelta(`${MARTES} 10:15`, config)).decisiones[0].tipo, "NO_REASIGNADO");
  assert.equal((await vuelta(`${MARTES} 10:30`, config)).decisiones[0].tipo, "RECORDATORIO");
  // Con la espera vigente, no.
  const vigente = chatRespondido({ enEsperaDesde: mas(T0, -10) });
  assert.equal(r.enEsperaVigente(vigente, mas(T0, 10), config), true);
  assert.equal(r.enEsperaVigente(vigente, mas(T0, 4 * 60 - 11), config), true);
  assert.equal(r.enEsperaVigente(vigente, mas(T0, 4 * 60 - 10), config), false, "a las 4 h exactas se acaba");
  assert.equal(r.enEsperaVigente(chatAbierto(), T0, config), false, "sin nota no hay espera");
});

await prueba("regla nueva 7: sin repetir → otra revisión automática no repite avisos ni líneas del historial", async () => {
  reiniciar();
  chatsAbiertos = [chatRespondido()];
  const config = CFG_DEFECTO();
  for (const hora of ["10:15", "10:30", "12:00"]) await vuelta(`${MARTES} ${hora}`, config);
  const filasAntes = filas().length;
  const lineasAntes = llamadas.actividad.length;
  const wasAntes = llamadas.whatsapp.length;
  for (const hora of ["12:00", "12:01", "12:02", "12:30"]) await vuelta(`${MARTES} ${hora}`, config);
  assert.equal(filas().length, filasAntes);
  assert.equal(llamadas.actividad.length, lineasAntes);
  assert.equal(llamadas.whatsapp.length, wasAntes);
  assert.equal(lineasAntes, 3, "una línea por decisión: no se reasignó, recordatorio y aviso al Supervisor");
  // Si el cliente vuelve a escribir (otro mensaje), es otro episodio: el reloj vuelve a contar.
  const segundo = chatRespondido({
    mensajes: [
      { direccion: "IN", tipo: "TEXT", origen: null, texto: "y entonces?", en: T0 },
      { direccion: "OUT", tipo: "TEXT", origen: "manual", texto: "ya casi", en: mas(T0, 200) },
      { direccion: "IN", tipo: "TEXT", origen: null, texto: "sigues ahí?", en: mas(T0, 240) },
    ],
    ultimoClienteEn: mas(T0, 240),
    ultimaRespuestaAsesoraEn: mas(T0, 200),
  });
  chatsAbiertos = [segundo];
  assert.equal((await vuelta(`${MARTES} 14:14`, config)).decisiones.length, 0, "el cliente volvió a escribir a las 14:00: los 15 min no se cumplen hasta las 14:15");
  assert.deepEqual((await vuelta(`${MARTES} 14:15`, config)).decisiones.map((d) => d.tipo), ["NO_REASIGNADO"]);
  assert.deepEqual((await vuelta(`${MARTES} 14:30`, config)).decisiones.map((d) => d.tipo), ["RECORDATORIO"]);
});

await prueba("regla nueva 8: con los interruptores apagados o a medias la regla también se respeta", async () => {
  reiniciar();
  chatsAbiertos = [chatRespondido()];
  // Solo reasignación prendida: a los 15 queda 'no se reasignó'; no hay recordatorio ni aviso al Supervisor.
  const soloReasignar = CFG_DEFECTO({ avisosActivos: false });
  assert.deepEqual((await vuelta(`${MARTES} 10:15`, soloReasignar)).decisiones.map((d) => d.tipo), ["NO_REASIGNADO"]);
  assert.equal((await vuelta(`${MARTES} 12:00`, soloReasignar)).decisiones.length, 0);
  assert.equal(llamadas.whatsapp.length, 0);
  // Solo avisos prendidos: sin reasignación no hay línea de 'no se reasignó', pero sí recordatorio.
  reiniciar();
  chatsAbiertos = [chatRespondido()];
  const soloAvisos = CFG_DEFECTO({ reasignacionActiva: false });
  assert.equal((await vuelta(`${MARTES} 10:15`, soloAvisos)).decisiones.length, 0);
  assert.deepEqual((await vuelta(`${MARTES} 10:30`, soloAvisos)).decisiones.map((d) => d.tipo), ["RECORDATORIO"]);
  // Normalización de los tiempos nuevos: el aviso al Supervisor siempre después del recordatorio.
  const c = r.normalizarConfigReasignacion({ recordatorioMin: 50, avisoSupervisorMin: 10, esperaHoras: 99 });
  assert.equal(c.avisoSupervisorMin, 51);
  assert.equal(c.esperaHoras, 24);
  assert.equal(r.normalizarConfigReasignacion({ esperaHoras: 0 }).esperaHoras, 1);
});


console.log(`\n${pruebas} pruebas ok`);
