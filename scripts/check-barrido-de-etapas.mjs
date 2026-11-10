// Pruebas del barrido de etapas (src/features/crm/services/barrido-de-etapas.ts) y del Ganado desde
// Gestión (marcarGanadoPorGestion en src/lib/etapa-automatica-crm.ts), con un prisma y una IA FALSOS:
// sin base ni red. Correr: npm run test:barrido-de-etapas
//
// 1. Ganado: una venta de Gestión en VentaDePauta deja GANADO con wonQuoteRef, wonAt e historial [gestion];
//    "CRM:" no marca; dos contactos distintos con el mismo número no marcan; dos fichas de la misma persona:
//    gana la del chat más reciente; pasa por encima de Caliente puesto a mano y de Descartado a mano;
//    cada venta una sola vez; con su interruptor apagado no marca.
// 2. IA: máximo 10 mensajes por chat y 20 chats por vuelta (y 300 al día); un chat ya leído sin mensaje
//    nuevo del cliente no se vuelve a mandar; "descartado" no cambia nada; Caliente y Tibio quedan con [ia].
// 3. Con crm:etapa-automatica:<negocio> en off no cambia nada; ningún envío; nunca lanza.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { cargar, RAIZ } from "./supervisor-cargar.mjs";

const WS = "ws";
const AHORA = new Date("2026-11-03T15:00:00Z");
const hace = (dias, horas = 0) => new Date(AHORA.getTime() - dias * 86_400_000 - horas * 3_600_000);

const db = {
  settings: new Map(),
  contactos: [],
  conversaciones: [],
  mensajes: [],
  ventas: [],
  historial: [],
  notas: [],
  seguimientos: 0,
  envios: 0,
};

function reiniciar() {
  db.settings.clear();
  db.contactos = [];
  db.conversaciones = [];
  db.mensajes = [];
  db.ventas = [];
  db.historial = [];
  db.notas = [];
  db.seguimientos = 0;
  db.envios = 0;
}

const contacto = (id) => db.contactos.find((c) => c.id === id);

function coincide(fila, where = {}) {
  for (const [campo, cond] of Object.entries(where)) {
    if (campo === "NOT" || campo === "contact" || campo === "channel") continue;
    const valor = fila[campo];
    if (cond && typeof cond === "object" && !(cond instanceof Date)) {
      if ("in" in cond && !cond.in.includes(valor)) return false;
      if ("gte" in cond && !(valor && valor.getTime() >= cond.gte.getTime())) return false;
      if ("not" in cond && valor === cond.not) return false;
      if ("contains" in cond && !String(valor ?? "").includes(cond.contains)) return false;
    } else if (valor !== cond) return false;
  }
  return true;
}

const prisma = {
  appSetting: {
    findUnique: async ({ where }) => (db.settings.has(where.key) ? { value: db.settings.get(where.key) } : null),
    upsert: async ({ where, create, update }) => {
      db.settings.set(where.key, db.settings.has(where.key) ? update.value : create.value);
      return {};
    },
  },
  // El falso NO filtra "CRM:": así se prueba que el barrido lo ignora igual.
  ventaDePauta: {
    findMany: async ({ where }) => db.ventas.filter((v) => v.workspaceId === where.workspaceId && v.pagadaEn >= where.pagadaEn.gte),
  },
  contact: {
    findMany: async ({ where }) => db.contactos.filter((c) => coincide(c, where)).map((c) => ({ ...c })),
    findFirst: async ({ where }) => {
      const c = db.contactos.find((x) => coincide(x, where));
      return c ? { ...c } : null;
    },
    updateMany: async ({ where, data }) => {
      const c = db.contactos.find((x) => coincide(x, where));
      if (!c) return { count: 0 };
      Object.assign(c, data);
      return { count: 1 };
    },
  },
  conversation: {
    findMany: async ({ where, take }) => {
      let filas = db.conversaciones.filter((cv) => coincide(cv, where));
      if (where.channel) filas = filas.filter((cv) => cv.purpose === where.channel.purpose);
      if (where.contact) {
        filas = filas.filter((cv) => {
          const c = contacto(cv.contactId);
          return c && c.crmStage === where.contact.crmStage && c.excludedFromCrm === where.contact.excludedFromCrm;
        });
      }
      filas.sort((a, b) => (b.lastMessageAt?.getTime() ?? 0) - (a.lastMessageAt?.getTime() ?? 0));
      return filas.slice(0, take ?? filas.length).map((cv) => ({ ...cv, contact: { metadata: contacto(cv.contactId)?.metadata ?? null } }));
    },
    findFirst: async ({ where }) => {
      const filas = db.conversaciones
        .filter((cv) => coincide(cv, where))
        .sort((a, b) => (b.lastMessageAt?.getTime() ?? 0) - (a.lastMessageAt?.getTime() ?? 0));
      const cv = filas[0];
      return cv ? { ...cv, channel: { purpose: cv.purpose } } : null;
    },
  },
  officialApiConversation: { findFirst: async () => null, findUnique: async () => null },
  historialEtapa: {
    findFirst: async ({ where }) => {
      const filas = db.historial.filter((h) => coincide(h, where)).sort((a, b) => b.creadoEn - a.creadoEn);
      return filas[0] ? { ...filas[0] } : null;
    },
  },
  message: {
    findFirst: async ({ where }) => {
      const filas = db.mensajes.filter((m) => coincide(m, where)).sort((a, b) => b.createdAt - a.createdAt);
      return filas[0] ? { ...filas[0] } : null;
    },
    findMany: async ({ where, take }) =>
      db.mensajes
        .filter((m) => coincide(m, where))
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, take)
        .map((m) => ({ ...m })),
  },
  $executeRaw: async () => {
    db.envios += 1;
    return 1;
  },
};

const mocks = {
  "@/lib/prisma": { prisma },
  "@/lib/historial-etapa": {
    registrarCambioDeEtapa: async (c) => void db.historial.push({ ...c, creadoEn: new Date() }),
  },
  "@/lib/conversation-activity": { recordConversationActivity: async (c) => void db.notas.push(c) },
  "@/features/seguimientos/services/follows": { createFollowsFromRulesForSource: async () => void (db.seguimientos += 1) },
  "node:crypto": { randomUUID: () => "uuid" },
};

// Ninguna llamada de red: ni la IA de verdad ni un envío.
globalThis.fetch = async () => {
  db.envios += 1;
  throw new Error("sin red en las pruebas");
};

const barrido = cargar("src/features/crm/services/barrido-de-etapas.ts", mocks);
const motor = cargar("src/lib/etapa-automatica-crm.ts", mocks);

let preguntas = [];
let respuestaIA = "NADA";
const ia = async (chat) => {
  preguntas.push(chat);
  return respuestaIA;
};
const barrer = () => barrido.barrerEtapas(WS, { prisma, ia, ahora: AHORA });

let pruebas = 0;
async function prueba(nombre, fn) {
  reiniciar();
  preguntas = [];
  respuestaIA = "NADA";
  const info = console.info;
  const log = console.log;
  console.info = () => {};
  try {
    await fn();
  } finally {
    console.info = info;
    console.log = log;
  }
  assert.equal(db.envios, 0, `${nombre}: no debe haber envíos ni llamadas de red`);
  assert.equal(db.seguimientos, 0, `${nombre}: no debe disparar seguimientos`);
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

function nuevoContacto(id, extra = {}) {
  const c = { id, workspaceId: WS, name: null, phoneNumber: `57300000${id.padStart(4, "0")}`, crmStage: "NUEVO", excludedFromCrm: false, metadata: null, wonAt: null, wonQuoteRef: null, lostReason: null, ...extra };
  db.contactos.push(c);
  return c;
}
function nuevoChat(id, contactId, ultimo = hace(0, 1), purpose = "SALES") {
  db.conversaciones.push({ id, workspaceId: WS, contactId, channelId: "ch", purpose, lastMessageAt: ultimo, createdAt: hace(20) });
}
function nuevaVenta(id, telefono, cotizacion = "COT-1001", pagadaEn = hace(1)) {
  db.ventas.push({ workspaceId: WS, ventaGestionId: id, cotizacion, telefono, pagadaEn });
}
function mensaje(conversationId, direction, content, createdAt) {
  db.mensajes.push({ id: `${conversationId}-${db.mensajes.length}`, conversationId, direction, type: "TEXT", content, transcripcion: null, isStatusBroadcast: false, createdAt });
}

// ── 1. GANADO DESDE GESTIÓN ──────────────────────────────────────────────────────────────────────

await prueba("una venta de Gestión deja GANADO con la cotización, la fecha del pago y el historial [gestion]", async () => {
  const c = nuevoContacto("1", { phoneNumber: "573001112233", crmStage: "PROPUESTA" });
  nuevoChat("cv1", "1");
  const pago = hace(2);
  nuevaVenta("G-1", "3001112233", "COT-4455", pago);
  const r = await barrer();
  assert.equal(r.ganados, 1);
  assert.equal(c.crmStage, "GANADO");
  assert.equal(c.wonQuoteRef, "COT-4455");
  assert.equal(c.wonAt.getTime(), pago.getTime());
  assert.equal(db.historial.length, 1);
  assert.equal(db.historial[0].origen, "AUTOMATICO");
  assert.equal(db.historial[0].etapaAnterior, "PROPUESTA");
  assert.equal(db.historial[0].etapaNueva, "GANADO");
  assert.match(db.historial[0].nota, /\[gestion\] cotización COT-4455/);
  assert.equal(db.notas.length, 1);
  assert.match(db.notas[0].text, /Ganado/);
  assert.equal(db.notas[0].conversationId, "cv1");
  // La segunda vuelta no hace nada más.
  await barrer();
  assert.equal(db.historial.length, 1);
});

await prueba("una venta con id CRM: no marca nada", async () => {
  const c = nuevoContacto("2", { phoneNumber: "573002223344" });
  nuevoChat("cv2", "2");
  nuevaVenta("CRM:COT-9", "3002223344", "COT-9");
  const r = await barrer();
  assert.equal(r.ganados, 0);
  assert.equal(c.crmStage, "NUEVO");
  assert.equal(db.historial.length, 0);
});

await prueba("un teléfono que coincide con dos contactos distintos no marca nada", async () => {
  const a = nuevoContacto("3", { phoneNumber: "573003334455", name: "Laura Gómez", crmStage: "NEGOCIACION" });
  const b = nuevoContacto("4", { phoneNumber: "3003334455", name: "Carlos Ruiz", crmStage: "PROPUESTA" });
  nuevoChat("cv3", "3");
  nuevoChat("cv4", "4");
  nuevaVenta("G-3", "3003334455");
  const r = await barrer();
  assert.equal(r.ganados, 0);
  assert.equal(a.crmStage, "NEGOCIACION");
  assert.equal(b.crmStage, "PROPUESTA");
});

await prueba("dos fichas del mismo número (misma persona): gana la del chat más reciente", async () => {
  const vieja = nuevoContacto("5", { phoneNumber: "573005556677", name: "Laura" });
  const nueva = nuevoContacto("6", { phoneNumber: "3005556677", name: "Laura Gómez" });
  nuevoChat("cv5", "5", hace(5));
  nuevoChat("cv6", "6", hace(0, 2));
  nuevaVenta("G-5", "573005556677", "COT-55");
  await barrer();
  assert.equal(nueva.crmStage, "GANADO");
  assert.equal(vieja.crmStage, "NUEVO");
});

await prueba("Caliente puesto a mano hace 30 días y Descartado a mano: los dos suben a Ganado", async () => {
  const caliente = nuevoContacto("7", { phoneNumber: "573007778899", crmStage: "NEGOCIACION" });
  const descartado = nuevoContacto("8", { phoneNumber: "573008889900", crmStage: "PERDIDO", lostReason: "precio" });
  db.historial.push({ workspaceId: WS, contactId: "7", origen: "ASESORA", etapaAnterior: "PROPUESTA", etapaNueva: "NEGOCIACION", nota: null, creadoEn: hace(30) });
  db.historial.push({ workspaceId: WS, contactId: "8", origen: "ASESORA", etapaAnterior: "NEGOCIACION", etapaNueva: "PERDIDO", nota: null, creadoEn: hace(3) });
  nuevoChat("cv7", "7");
  nuevoChat("cv8", "8");
  nuevaVenta("G-7", "3007778899", "COT-77");
  nuevaVenta("G-8", "3008889900", "COT-88");
  const r = await barrer();
  assert.equal(r.ganados, 2);
  assert.equal(caliente.crmStage, "GANADO");
  assert.equal(descartado.crmStage, "GANADO");
  assert.equal(descartado.lostReason, null);
  assert.equal(descartado.wonQuoteRef, "COT-88");
});

await prueba("si una persona lo saca de Ganado después, la misma venta no lo vuelve a poner", async () => {
  const c = nuevoContacto("9", { phoneNumber: "573009990011", crmStage: "NEGOCIACION" });
  nuevoChat("cv9", "9");
  nuevaVenta("G-9", "3009990011", "COT-99");
  await barrer();
  assert.equal(c.crmStage, "GANADO");
  c.crmStage = "NEGOCIACION";
  await barrer();
  assert.equal(c.crmStage, "NEGOCIACION");
});

await prueba("con el interruptor de Ganado en off no marca Ganado", async () => {
  db.settings.set(`crm:etapa-automatica:ganado:${WS}`, "off");
  const c = nuevoContacto("10", { phoneNumber: "573001010101", crmStage: "NEGOCIACION" });
  nuevoChat("cv10", "10");
  nuevaVenta("G-10", "3001010101");
  const r = await barrer();
  assert.equal(r.ganados, 0);
  assert.equal(c.crmStage, "NEGOCIACION");
});

await prueba("marcarGanadoPorGestion: un Ganado no se toca", async () => {
  const c = nuevoContacto("11", { crmStage: "GANADO", wonQuoteRef: "COT-OLD" });
  const movido = await motor.marcarGanadoPorGestion({ workspaceId: WS, contactId: "11", cotizacion: "COT-NEW", fechaPago: hace(1) });
  assert.equal(movido, false);
  assert.equal(c.wonQuoteRef, "COT-OLD");
  assert.equal(motor.claveInterruptorGanadoAutomatico(WS), `crm:etapa-automatica:ganado:${WS}`);
});

// ── 2. LA IA PARA LOS CHATS SIN ETAPA ─────────────────────────────────────────────────────────────

function chatSinEtapa(n, mensajes = 3, ultimo = hace(0, 1)) {
  const id = `ia${n}`;
  nuevoContacto(id);
  nuevoChat(`cv-${id}`, id, ultimo);
  for (let i = 0; i < mensajes; i += 1) {
    const cuando = new Date(ultimo.getTime() - (mensajes - i) * 60_000);
    mensaje(`cv-${id}`, i % 2 === 0 ? "INBOUND" : "OUTBOUND", `mensaje ${i}`, cuando);
  }
  mensaje(`cv-${id}`, "INBOUND", "cómo hago el pago?", ultimo);
  return contacto(id);
}

await prueba("la IA recibe como mucho 10 mensajes por chat y como mucho 20 chats por vuelta", async () => {
  for (let n = 0; n < 25; n += 1) chatSinEtapa(n, 15);
  const r = await barrer();
  assert.equal(preguntas.length, 20);
  assert.equal(r.leidosPorIA, 20);
  for (const p of preguntas) assert.ok(p.split("\n").length <= 10, "máximo 10 mensajes");
  assert.equal(preguntas[0].split("\n").length, 10);
  assert.match(preguntas[0].split("\n").at(-1), /^Cliente: cómo hago el pago\?/);
  // El contador del día quedó en 20.
  assert.equal(JSON.parse(db.settings.get(`crm:barrido-de-etapas:ia-del-dia:${WS}`)).usados, 20);
});

await prueba("tope de 300 al día por negocio", async () => {
  db.settings.set(`crm:barrido-de-etapas:ia-del-dia:${WS}`, JSON.stringify({ dia: "2026-11-03", usados: 295 }));
  for (let n = 0; n < 10; n += 1) chatSinEtapa(n);
  await barrer();
  assert.equal(preguntas.length, 5);
  db.settings.set(`crm:barrido-de-etapas:ia-del-dia:${WS}`, JSON.stringify({ dia: "2026-11-03", usados: 300 }));
  preguntas = [];
  await barrer();
  assert.equal(preguntas.length, 0);
});

await prueba("un chat ya leído sin mensaje nuevo del cliente no se vuelve a mandar", async () => {
  const c = chatSinEtapa(1);
  await barrer();
  assert.equal(preguntas.length, 1);
  assert.ok(c.metadata[barrido.CLAVE_LEIDO_POR_IA]);
  await barrer();
  assert.equal(preguntas.length, 1, "sin mensaje nuevo no se pregunta otra vez");
  // Nuestro mensaje no cuenta; uno nuevo del cliente sí.
  mensaje("cv-ia1", "OUTBOUND", "¿le ayudo con algo más?", hace(0, 0.5));
  await barrer();
  assert.equal(preguntas.length, 1);
  mensaje("cv-ia1", "INBOUND", "sí, quiero el negro", hace(0, 0.2));
  await barrer();
  assert.equal(preguntas.length, 2);
});

await prueba("si la IA contesta descartado (o ganado), no cambia nada", async () => {
  for (const respuesta of ["descartado", "DESCARTADO", "ganado"]) {
    reiniciar();
    respuestaIA = respuesta;
    const c = chatSinEtapa(1);
    await barrer();
    assert.equal(c.crmStage, "NUEVO", respuesta);
    assert.equal(db.historial.length, 0, respuesta);
  }
});

await prueba("Caliente, Tibio y Frío de la IA quedan con nota [ia]", async () => {
  respuestaIA = "CALIENTE";
  const c = chatSinEtapa(1);
  await barrer();
  assert.equal(c.crmStage, "NEGOCIACION");
  assert.equal(db.historial.length, 1);
  assert.equal(db.historial[0].origen, "AUTOMATICO");
  assert.match(db.historial[0].nota, /\[ia\]$/);
  // La marca de leído sobrevive al cambio de etapa.
  assert.ok(c.metadata[barrido.CLAVE_LEIDO_POR_IA]);

  reiniciar();
  respuestaIA = "Tibio";
  const t = chatSinEtapa(2);
  await barrer();
  assert.equal(t.crmStage, "PROPUESTA");
  assert.ok(t.metadata.recontactarEl);

  reiniciar();
  respuestaIA = "frio";
  const f = chatSinEtapa(3);
  await barrer();
  assert.equal(f.crmStage, "CALIFICADO");
  assert.match(db.historial[0].nota, /\[ia\]$/);
});

await prueba("solo línea de ventas, solo '---' y solo con mensaje del cliente en 7 días", async () => {
  nuevoContacto("adm");
  nuevoChat("cv-adm", "adm", hace(0, 1), "ADMIN");
  mensaje("cv-adm", "INBOUND", "factura del proveedor", hace(0, 1));
  nuevoContacto("tib", { crmStage: "PROPUESTA" });
  nuevoChat("cv-tib", "tib");
  mensaje("cv-tib", "INBOUND", "hola", hace(0, 1));
  nuevoContacto("vie");
  nuevoChat("cv-vie", "vie", hace(0, 1));
  mensaje("cv-vie", "INBOUND", "hola", hace(9));
  mensaje("cv-vie", "OUTBOUND", "¿sigue interesada?", hace(0, 1));
  await barrer();
  assert.equal(preguntas.length, 0);
});

await prueba("si la IA falla no se marca como leído y nunca lanza", async () => {
  const c = chatSinEtapa(1);
  const r = await barrido.barrerEtapas(WS, {
    prisma,
    ahora: AHORA,
    ia: async () => {
      throw Object.assign(new Error("fetch failed"), { code: "ECONNREFUSED" });
    },
  });
  assert.equal(c.crmStage, "NUEVO");
  assert.equal(c.metadata, null);
  assert.equal(r.movidosPorIA, 0);
  // Una base que se cae tampoco lanza.
  const rota = { ...prisma, ventaDePauta: { findMany: async () => { throw new Error("prisma caída"); } } };
  const r2 = await barrido.barrerEtapas(WS, { prisma: rota, ia, ahora: AHORA });
  assert.equal(r2.ganados, 0);
});

// ── 3. INTERRUPTOR GENERAL Y ENVÍOS ───────────────────────────────────────────────────────────────

await prueba("con crm:etapa-automatica:<negocio> en off no cambia nada", async () => {
  db.settings.set(`crm:etapa-automatica:${WS}`, "off");
  respuestaIA = "CALIENTE";
  const venta = nuevoContacto("v", { phoneNumber: "573004445566", crmStage: "NEGOCIACION" });
  nuevoChat("cv-v", "v");
  nuevaVenta("G-v", "3004445566");
  const c = chatSinEtapa(1);
  const r = await barrer();
  assert.deepEqual(r, { ganados: 0, leidosPorIA: 0, movidosPorIA: 0 });
  assert.equal(venta.crmStage, "NEGOCIACION");
  assert.equal(c.crmStage, "NUEVO");
  assert.equal(preguntas.length, 0);
  assert.equal(db.historial.length, 0);
});

await prueba("el barrido no usa funciones de envío y el reloj lo llama cada 30 minutos en segundo plano", async () => {
  const fuente = fs.readFileSync(path.join(RAIZ, "src/features/crm/services/barrido-de-etapas.ts"), "utf8");
  assert.doesNotMatch(fuente, /sendText|enviar|evolution/i);
  const reloj = fs.readFileSync(path.join(RAIZ, "src/app/api/cron/follows/route.ts"), "utf8");
  assert.match(reloj, /if \(minuto % 30 === 6\) \{\s*after\(async \(\) => \{\s*try \{\s*await barrerEtapasDeTodos\(\);/);
});

console.log(`\n${pruebas} pruebas del barrido de etapas: OK`);
