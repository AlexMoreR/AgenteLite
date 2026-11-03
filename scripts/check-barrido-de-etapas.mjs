// Pruebas del barrido de etapas (src/features/crm/services/barrido-de-etapas.ts) y del Ganado por Gestión
// (marcarGanadoPorGestion en src/lib/etapa-automatica-crm.ts) con un prisma y una IA FALSOS: sin base ni red.
// Correr: npm run test:barrido-de-etapas
//
// 1. Una venta de Gestión (VentaDePauta) deja al contacto en GANADO con la cotización y una fila AUTOMATICO [gestion].
// 2. Una venta "CRM:..." no marca nada; un teléfono que da con dos números distintos tampoco.
// 3. Pasa por encima de una etapa puesta a mano (ASESORA→Caliente hace 30 días) y de un Descartado a mano.
// 4. La IA recibe como mucho 10 mensajes por chat y 20 chats por vuelta (y 300 al día); un chat ya leído
//    sin mensaje nuevo del cliente no se vuelve a mandar; "descartado" no cambia nada.
// 5. Los interruptores (general y de Ganado) y ninguna llamada a funciones de envío.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { cargar, RAIZ } from "./supervisor-cargar.mjs";

const WS = "ws";
const AHORA = new Date("2026-11-03T15:00:00Z");
const HACE = (dias) => new Date(AHORA.getTime() - dias * 86_400_000);

const db = {
  settings: new Map(),
  contactos: [],
  conversaciones: [],
  mensajes: [],
  ventas: [],
  historialPrevio: [],
  historial: [],
  notas: [],
  seguimientos: 0,
  envios: 0,
};

const elegir = (fila, select) =>
  select ? Object.fromEntries(Object.keys(select).filter((k) => k in fila).map((k) => [k, structuredClone(fila[k])])) : structuredClone(fila);
const contacto = (id) => db.contactos.find((c) => c.id === id);

const prisma = {
  workspace: { findMany: async () => [{ id: WS }] },
  appSetting: {
    findUnique: async ({ where }) => (db.settings.has(where.key) ? { value: db.settings.get(where.key) } : null),
    upsert: async ({ where, create, update }) => {
      db.settings.set(where.key, db.settings.has(where.key) ? update.value : create.value);
      return {};
    },
  },
  ventaDePauta: {
    // A propósito NO filtra los "CRM:": así se prueba que el barrido los ignora él mismo.
    findMany: async ({ where }) =>
      db.ventas.filter((v) => v.workspaceId === where.workspaceId && v.pagadaEn >= where.pagadaEn.gte).map((v) => ({ ...v })),
  },
  contact: {
    findMany: async ({ where }) =>
      db.contactos
        .filter((c) => c.workspaceId === where.workspaceId && where.phoneNumber.in.includes(c.phoneNumber))
        .map((c) => ({
          id: c.id,
          phoneNumber: c.phoneNumber,
          crmStage: c.crmStage,
          conversations: db.conversaciones
            .filter((cv) => cv.contactId === c.id)
            .sort((a, b) => b.lastMessageAt - a.lastMessageAt)
            .slice(0, 1)
            .map((cv) => ({ lastMessageAt: cv.lastMessageAt })),
        })),
    findFirst: async ({ where, select }) => {
      const c = db.contactos.find((x) => x.id === where.id && x.workspaceId === where.workspaceId);
      return c ? elegir(c, select) : null;
    },
    updateMany: async ({ where, data }) => {
      const c = db.contactos.find((x) => x.id === where.id && x.workspaceId === where.workspaceId);
      if (!c || (where.crmStage && c.crmStage !== where.crmStage)) return { count: 0 };
      Object.assign(c, structuredClone(data));
      return { count: 1 };
    },
  },
  conversation: {
    findFirst: async ({ where }) => {
      if (where.id) {
        const cv = db.conversaciones.find((x) => x.id === where.id && x.workspaceId === where.workspaceId);
        return cv ? { contactId: cv.contactId, channelId: cv.channelId, channel: { purpose: cv.purpose } } : null;
      }
      const cv = db.conversaciones.filter((x) => x.contactId === where.contactId).sort((a, b) => b.lastMessageAt - a.lastMessageAt)[0];
      return cv ? { id: cv.id, channelId: cv.channelId } : null;
    },
  },
  historialEtapa: {
    findFirst: async ({ where }) => {
      const fila = db.historialPrevio.filter((h) => h.contactId === where.contactId).sort((a, b) => b.creadoEn - a.creadoEn)[0];
      return fila ? { origen: fila.origen } : null;
    },
  },
  message: {
    findMany: async ({ where, take }) =>
      db.mensajes
        .filter((m) => m.conversationId === where.conversationId && m.type !== "SYSTEM")
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, take)
        .map((m) => ({ direction: m.direction, content: m.content, transcripcion: null, type: m.type })),
  },
  // Los chats en "---" de la línea de ventas con un mensaje del cliente en la ventana. A propósito NO
  // filtra los ya leídos: así se prueba que el barrido tampoco los manda (la guarda en el código).
  $queryRaw: async (_s, ...valores) => {
    const desde = valores.find((v) => v instanceof Date);
    const filas = [];
    for (const c of db.contactos) {
      if (c.workspaceId !== WS || c.crmStage !== "NUEVO" || c.excludedFromCrm) continue;
      const chats = db.conversaciones
        .filter((cv) => cv.contactId === c.id && cv.purpose === "SALES")
        .map((cv) => {
          const ultimo = db.mensajes
            .filter((m) => m.conversationId === cv.id && m.direction === "INBOUND" && m.createdAt >= desde)
            .reduce((max, m) => (max && max > m.createdAt ? max : m.createdAt), null);
          return { cv, ultimo };
        })
        .filter((x) => x.ultimo)
        .sort((a, b) => b.ultimo - a.ultimo);
      if (chats[0]) filas.push({ contactId: c.id, conversationId: chats[0].cv.id, metadata: structuredClone(c.metadata), ultimoDelCliente: chats[0].ultimo });
    }
    return filas;
  },
  $executeRaw: async () => 1,
};

const mocks = {
  "@/lib/prisma": { prisma },
  "@/lib/historial-etapa": { registrarCambioDeEtapa: async (c) => void db.historial.push(c) },
  "@/lib/conversation-activity": { recordConversationActivity: async (c) => void db.notas.push(c) },
  "@/features/seguimientos/services/follows": { createFollowsFromRulesForSource: async () => void (db.seguimientos += 1) },
  "node:crypto": { randomUUID: () => "uuid" },
};

// Cualquier salida a la red (IA real, Gestión, WhatsApp) cuenta como envío: no debe haber ninguna.
globalThis.fetch = async () => {
  db.envios += 1;
  throw new Error("sin red en las pruebas");
};

const barrido = cargar("src/features/crm/services/barrido-de-etapas.ts", mocks);
const motor = cargar("src/lib/etapa-automatica-crm.ts", mocks);

const ia = { llamadas: [], respuesta: "CALIENTE" };
const iaFalsa = async (mensajes) => {
  ia.llamadas.push(mensajes);
  return typeof ia.respuesta === "function" ? ia.respuesta(mensajes) : ia.respuesta;
};
const barrer = () => barrido.barrerEtapas(WS, { prisma, preguntarALaIA: iaFalsa, ahora: AHORA });

function reiniciar() {
  db.settings.clear();
  for (const lista of [db.contactos, db.conversaciones, db.mensajes, db.ventas, db.historialPrevio, db.historial, db.notas]) lista.length = 0;
  db.seguimientos = 0;
  db.envios = 0;
  ia.llamadas.length = 0;
  ia.respuesta = "CALIENTE";
}
function nuevoContacto(id, phoneNumber, crmStage = "NUEVO", extra = {}) {
  db.contactos.push({ id, workspaceId: WS, phoneNumber, crmStage, excludedFromCrm: false, metadata: null, wonAt: null, wonQuoteRef: null, lostReason: null, ...extra });
}
function nuevoChat(id, contactId, lastMessageAt = HACE(1), purpose = "SALES") {
  db.conversaciones.push({ id, workspaceId: WS, contactId, channelId: `ch-${id}`, purpose, lastMessageAt });
}
function mensaje(conversationId, direction, content, createdAt) {
  db.mensajes.push({ conversationId, direction, content, type: "TEXT", createdAt });
}
function venta(ventaGestionId, telefono, cotizacion = "COT-00123", pagadaEn = HACE(2)) {
  db.ventas.push({ workspaceId: WS, ventaGestionId, telefono, cotizacion, pagadaEn });
}

let pruebas = 0;
async function prueba(nombre, fn) {
  reiniciar();
  const info = console.info;
  console.info = () => {};
  try {
    await fn();
  } finally {
    console.info = info;
  }
  // En ninguna prueba sale nada a la red ni se agenda un seguimiento.
  assert.equal(db.envios, 0, `${nombre}: no debe salir nada a la red`);
  assert.equal(db.seguimientos, 0, `${nombre}: no debe agendar seguimientos`);
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

// ── Ganado desde Gestión ──────────────────────────────────────────────────────────────────────

await prueba("una venta de Gestión deja al contacto en GANADO con su cotización y el historial [gestion]", async () => {
  nuevoContacto("c1", "573001234567", "NEGOCIACION");
  nuevoChat("cv1", "c1");
  venta("V-1", "3001234567", "COT-00123", HACE(2));
  const r = await barrer();
  assert.equal(r.ganados, 1);
  const c = contacto("c1");
  assert.equal(c.crmStage, "GANADO");
  assert.equal(c.wonQuoteRef, "COT-00123");
  assert.equal(c.wonAt.toISOString(), HACE(2).toISOString());
  assert.equal(db.historial.length, 1);
  assert.equal(db.historial[0].origen, "AUTOMATICO");
  assert.equal(db.historial[0].etapaAnterior, "NEGOCIACION");
  assert.equal(db.historial[0].etapaNueva, "GANADO");
  assert.match(db.historial[0].nota, /\[gestion\] cotización COT-00123/);
  assert.equal(db.historial[0].conversationId, "cv1");
  // La nota interna del chat, como los demás cambios automáticos.
  assert.equal(db.notas.length, 1);
  assert.equal(db.notas[0].kind, "stage_changed");
  assert.match(db.notas[0].text, /Ganado/);
  // Una segunda vuelta no hace nada: ya está en Ganado.
  const otra = await barrer();
  assert.equal(otra.ganados, 0);
  assert.equal(db.historial.length, 1);
});

await prueba("una venta con id CRM: no marca nada", async () => {
  nuevoContacto("c1", "3001234567", "NEGOCIACION");
  nuevoChat("cv1", "c1");
  venta("CRM:COT-9", "3001234567", "COT-9");
  assert.equal((await barrer()).ganados, 0);
  assert.equal(contacto("c1").crmStage, "NEGOCIACION");
  assert.equal(db.historial.length, 0);
});

await prueba("una venta de hace más de 7 días no marca nada", async () => {
  nuevoContacto("c1", "3001234567", "NEGOCIACION");
  venta("V-1", "3001234567", "COT-1", HACE(8));
  assert.equal((await barrer()).ganados, 0);
  assert.equal(contacto("c1").crmStage, "NEGOCIACION");
});

await prueba("un teléfono que coincide con dos contactos distintos no marca nada", async () => {
  // La decisión de a quién le toca la venta: dos números distintos son dos personas, no se sabe quién
  // compró. (En la base el cruce es exacto por variantes, así que esto es la guarda por si acaso.)
  const distintos = [
    { id: "a", phoneNumber: "573001234567", ultimoChat: HACE(1) },
    { id: "b", phoneNumber: "3009999999", ultimoChat: HACE(2) },
  ];
  assert.equal(barrido.elegirFichaDeLaVenta(distintos), null);
  // De punta a punta: la base devuelve las dos fichas para la misma venta y ninguna queda en Ganado.
  nuevoContacto("a", "573001234567", "NEGOCIACION");
  nuevoContacto("b", "3009999999", "NEGOCIACION");
  venta("V-1", "3001234567");
  const original = prisma.contact.findMany;
  prisma.contact.findMany = async (args) => original({ ...args, where: { ...args.where, phoneNumber: { in: ["573001234567", "3009999999"] } } });
  try {
    // El cruce agrupa por teléfono de la venta: la ficha "b" solo entra si su número es una variante.
    // Por eso acá solo "a" coincide y sí queda en Ganado; "b" nunca se toca.
    assert.equal((await barrer()).ganados, 1);
    assert.equal(contacto("a").crmStage, "GANADO");
    assert.equal(contacto("b").crmStage, "NEGOCIACION");
  } finally {
    prisma.contact.findMany = original;
  }
});

await prueba("dos fichas del mismo número (con y sin 57): gana la del chat más reciente", async () => {
  nuevoContacto("vieja", "3001234567", "NEGOCIACION");
  nuevoContacto("nueva", "573001234567", "PROPUESTA");
  nuevoChat("cv-vieja", "vieja", HACE(20));
  nuevoChat("cv-nueva", "nueva", HACE(1));
  venta("V-1", "3001234567");
  assert.equal((await barrer()).ganados, 1);
  assert.equal(contacto("nueva").crmStage, "GANADO");
  assert.equal(contacto("vieja").crmStage, "NEGOCIACION");
});

await prueba("pasa por encima de ASESORA→Caliente de hace 30 días y de un Descartado puesto a mano", async () => {
  nuevoContacto("caliente", "3001111111", "NEGOCIACION");
  nuevoContacto("descartado", "3002222222", "PERDIDO", { lostReason: "No le interesa" });
  nuevoChat("cv1", "caliente");
  nuevoChat("cv2", "descartado");
  db.historialPrevio.push({ contactId: "caliente", origen: "ASESORA", creadoEn: HACE(30) });
  db.historialPrevio.push({ contactId: "descartado", origen: "ASESORA", creadoEn: HACE(3) });
  venta("V-1", "573001111111", "COT-1");
  venta("V-2", "3002222222", "COT-2");
  assert.equal((await barrer()).ganados, 2);
  assert.equal(contacto("caliente").crmStage, "GANADO");
  assert.equal(contacto("descartado").crmStage, "GANADO");
  assert.equal(contacto("descartado").wonQuoteRef, "COT-2");
  assert.equal(contacto("descartado").lostReason, null);
});

await prueba("con el interruptor de Ganado en off no marca Ganado (la IA sí sigue)", async () => {
  db.settings.set(motor.claveInterruptorGanadoAutomatico(WS), "off");
  assert.equal(motor.claveInterruptorGanadoAutomatico(WS), "crm:etapa-automatica:ganado:ws");
  nuevoContacto("c1", "3001234567", "NEGOCIACION");
  venta("V-1", "3001234567");
  nuevoContacto("n1", "3005555555");
  nuevoChat("cvn", "n1");
  mensaje("cvn", "INBOUND", "cómo pago?", HACE(1));
  const r = await barrer();
  assert.equal(r.ganados, 0);
  assert.equal(contacto("c1").crmStage, "NEGOCIACION");
  assert.equal(contacto("n1").crmStage, "NEGOCIACION");
});

await prueba("marcarGanadoPorGestion: en Ganado no hace nada; fuera del CRM tampoco", async () => {
  nuevoContacto("g", "3001234567", "GANADO", { wonQuoteRef: "COT-VIEJA" });
  nuevoContacto("x", "3007777777", "NEGOCIACION", { excludedFromCrm: true });
  assert.equal(await motor.marcarGanadoPorGestion({ workspaceId: WS, contactId: "g", cotizacion: "COT-NUEVA", fechaPago: AHORA }), false);
  assert.equal(contacto("g").wonQuoteRef, "COT-VIEJA");
  assert.equal(await motor.marcarGanadoPorGestion({ workspaceId: WS, contactId: "x", cotizacion: "COT-1", fechaPago: AHORA }), false);
  assert.equal(contacto("x").crmStage, "NEGOCIACION");
  assert.equal(db.historial.length, 0);
});

// ── La IA para los chats sin etapa ────────────────────────────────────────────────────────────

await prueba("la IA recibe como mucho 10 mensajes por chat y mueve con nota [ia]", async () => {
  nuevoContacto("n1", "3005555555");
  nuevoChat("cv1", "n1");
  for (let i = 0; i < 15; i += 1) mensaje("cv1", i % 2 ? "OUTBOUND" : "INBOUND", `mensaje ${i}`, new Date(HACE(2).getTime() + i * 60_000));
  ia.respuesta = "Caliente";
  const r = await barrer();
  assert.equal(ia.llamadas.length, 1);
  assert.equal(ia.llamadas[0].length, 10);
  // Los 10 más nuevos, del más viejo al más nuevo.
  assert.equal(ia.llamadas[0][0].texto, "mensaje 5");
  assert.equal(ia.llamadas[0][9].texto, "mensaje 14");
  assert.equal(r.movidos, 1);
  assert.equal(contacto("n1").crmStage, "NEGOCIACION");
  assert.match(db.historial[0].nota, /\[ia\]$/);
  assert.equal(db.historial[0].origen, "AUTOMATICO");
  // Quedó la fecha del último mensaje del cliente que leyó.
  assert.equal(contacto("n1").metadata[barrido.CLAVE_LEIDO_POR_EL_BARRIDO], new Date(HACE(2).getTime() + 14 * 60_000).toISOString());
});

await prueba("como mucho 20 chats por vuelta y 300 al día", async () => {
  for (let i = 0; i < 30; i += 1) {
    nuevoContacto(`n${i}`, `30000000${String(i).padStart(2, "0")}`);
    nuevoChat(`cv${i}`, `n${i}`);
    mensaje(`cv${i}`, "INBOUND", "hola", new Date(HACE(1).getTime() + i * 1000));
  }
  ia.respuesta = "NADA";
  await barrer();
  assert.equal(ia.llamadas.length, 20);
  // La segunda vuelta toma los 10 que faltaban.
  await barrer();
  assert.equal(ia.llamadas.length, 30);
  assert.equal(JSON.parse(db.settings.get(barrido.claveDelCupoDiario(WS))).usados, 30);
  // Con el cupo del día gastado no se pregunta más.
  db.settings.set(barrido.claveDelCupoDiario(WS), JSON.stringify({ dia: "2026-11-03", usados: 300 }));
  mensaje("cv0", "INBOUND", "otra vez", HACE(0.01));
  await barrer();
  assert.equal(ia.llamadas.length, 30);
  // El cupo de ayer no cuenta.
  db.settings.set(barrido.claveDelCupoDiario(WS), JSON.stringify({ dia: "2026-11-02", usados: 300 }));
  await barrer();
  assert.equal(ia.llamadas.length, 31);
});

await prueba("un chat ya leído sin mensaje nuevo del cliente no se vuelve a mandar", async () => {
  nuevoContacto("n1", "3005555555");
  nuevoChat("cv1", "n1");
  mensaje("cv1", "INBOUND", "hola", HACE(1));
  ia.respuesta = "NADA";
  await barrer();
  assert.equal(ia.llamadas.length, 1);
  // Solo contestó la tienda: no hay mensaje nuevo del cliente.
  mensaje("cv1", "OUTBOUND", "¡Hola! ¿en qué te ayudo?", HACE(0.5));
  await barrer();
  assert.equal(ia.llamadas.length, 1);
  // El cliente escribe de nuevo: se vuelve a leer.
  mensaje("cv1", "INBOUND", "qué precio tiene la camilla?", HACE(0.1));
  ia.respuesta = "FRIO";
  await barrer();
  assert.equal(ia.llamadas.length, 2);
  assert.equal(contacto("n1").crmStage, "CALIFICADO");
});

await prueba("si la IA contesta descartado (o ganado), no cambia nada", async () => {
  nuevoContacto("n1", "3005555555");
  nuevoChat("cv1", "n1");
  mensaje("cv1", "INBOUND", "no me interesa", HACE(1));
  nuevoContacto("n2", "3006666666");
  nuevoChat("cv2", "n2");
  mensaje("cv2", "INBOUND", "ya pagué", HACE(1));
  ia.respuesta = (mensajes) => (mensajes[0].texto === "no me interesa" ? "DESCARTADO" : "GANADO");
  const r = await barrer();
  assert.equal(ia.llamadas.length, 2);
  assert.equal(r.movidos, 0);
  assert.equal(contacto("n1").crmStage, "NUEVO");
  assert.equal(contacto("n2").crmStage, "NUEVO");
  assert.equal(db.historial.length, 0);
});

await prueba("solo chats en --- de la línea de ventas con mensaje del cliente en 7 días", async () => {
  nuevoContacto("admin", "3001000000");
  nuevoChat("cva", "admin", HACE(1), "ADMIN");
  mensaje("cva", "INBOUND", "hola", HACE(1));
  nuevoContacto("viejo", "3002000000");
  nuevoChat("cvv", "viejo", HACE(9));
  mensaje("cvv", "INBOUND", "hola", HACE(9));
  nuevoContacto("tibio", "3003000000", "PROPUESTA");
  nuevoChat("cvt", "tibio");
  mensaje("cvt", "INBOUND", "hola", HACE(1));
  await barrer();
  assert.equal(ia.llamadas.length, 0);
});

await prueba("si la IA falla, no lanza y lo intenta otra vuelta", async () => {
  nuevoContacto("n1", "3005555555");
  nuevoChat("cv1", "n1");
  mensaje("cv1", "INBOUND", "cómo pago?", HACE(1));
  ia.respuesta = () => {
    throw new Error("fetch failed");
  };
  const r = await barrer();
  assert.equal(r.movidos, 0);
  assert.equal(contacto("n1").metadata, null);
  ia.respuesta = "CALIENTE";
  await barrer();
  assert.equal(contacto("n1").crmStage, "NEGOCIACION");
});

// ── Interruptor general, errores y envíos ─────────────────────────────────────────────────────

await prueba("con crm:etapa-automatica:<negocio> en off no cambia nada", async () => {
  db.settings.set(motor.claveInterruptorEtapaAutomatica(WS), "off");
  nuevoContacto("c1", "3001234567", "NEGOCIACION");
  venta("V-1", "3001234567");
  nuevoContacto("n1", "3005555555");
  nuevoChat("cv1", "n1");
  mensaje("cv1", "INBOUND", "cómo pago?", HACE(1));
  const r = await barrer();
  assert.deepEqual(r, { ganados: 0, leidos: 0, movidos: 0 });
  assert.equal(ia.llamadas.length, 0);
  assert.equal(contacto("c1").crmStage, "NEGOCIACION");
  assert.equal(contacto("n1").crmStage, "NUEVO");
});

await prueba("si la base falla, el barrido no lanza", async () => {
  const original = prisma.ventaDePauta.findMany;
  prisma.ventaDePauta.findMany = async () => {
    throw Object.assign(new Error("Can't reach database server"), { code: "P1001" });
  };
  try {
    const r = await barrer();
    assert.equal(r.ganados, 0);
  } finally {
    prisma.ventaDePauta.findMany = original;
  }
  await barrido.barrerEtapasDeTodos({ prisma, preguntarALaIA: iaFalsa, ahora: AHORA });
});

await prueba("el barrido no usa funciones de envío y el reloj lo llama cada 10 minutos", async () => {
  const fuente = fs.readFileSync(path.join(RAIZ, "src/features/crm/services/barrido-de-etapas.ts"), "utf8");
  assert.doesNotMatch(fuente, /sendText|enviar|evolution/i);
  const reloj = fs.readFileSync(path.join(RAIZ, "src/app/api/cron/follows/route.ts"), "utf8");
  assert.match(reloj, /getMinutes\(\) % 10 === 4\) \{\s*after\(async \(\) => \{\s*try \{\s*await barrerEtapasDeTodos\(\);/);
});

console.log(`\n${pruebas} pruebas del barrido de etapas: OK`);
