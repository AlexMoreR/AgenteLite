// Pruebas de SEGUIMIENTOS SIN DUPLICADOS Y SIN HABLAR DEL COMBO EN CHATS DE OTRO PRODUCTO (tarjeta yp8xzwvm,
// reporte de María Camila del 4-nov-2026, Ventas 1, chats del 3-nov). Base, WhatsApp e IA simulados: sin red.
//  - el candado del reloj V3: dos vueltas cruzadas mandan el recordatorio UNA vez; si el envío falla, no se reintenta;
//  - la revisión final: el mismo texto no sale dos veces al mismo chat; nada del combo en un chat de otro producto;
//  - el motor de Follow: un cancelado no sale ni queda "ejecutado"; uno que tomó otra vuelta no sale; un envío
//    que se cayó a mitad no se reenvía;
//  - la medición de la herramienta del MCP `seguimientos_repetidos`.
// Correr: npm run test:seguimientos-sin-duplicados
import assert from "node:assert/strict";
import fs from "node:fs";

import { cargar } from "./supervisor-cargar.mjs";

const dom = cargar("src/features/seguimientos/dominio/compuerta-de-envio.ts");

let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const MIN = 60_000;
const T0 = new Date("2026-11-03T17:00:00.000Z"); // 12:00 de Bogotá
const en = (minutos) => new Date(T0.getTime() + minutos * MIN);

// Los textos reales del reporte.
const ENVIO = "Así te confirmo el envío 🚚 ¿En qué ciudad lo recibirías?";
const FABRICACION = "Como es fabricación sobre pedido, te confirmo la fecha de entrega 😊 ¿Para cuándo lo necesitas?";
const GUSTO = "Espero que te haya gustado el combo 😊 ¿para cuándo lo necesitas?";
const GARANTIA = "Recuerda que el combo camillas tiene garantía de 1 año 💛 ¿Te lo separo?";
const PDF_MANICURA = "COMBO MESA Y SILLAS MANICURA.pdf";

/* ==============================================================================================
   1. Código puro: producto del chat, "habla del combo", la revisión final y la medición
============================================================================================== */

const IN = (min, texto, tipo = "TEXT") => ({ direccion: "IN", tipo, texto, en: en(min) });
const OUT = (min, texto, tipo = "TEXT", nombreDeArchivo = null) => ({ direccion: "OUT", tipo, texto, nombreDeArchivo, en: en(min) });

await prueba("producto del chat: el PDF 'COMBO MESA Y SILLAS MANICURA' y el audio 'necesito uno para una' (caso 302 718 8927)", () => {
  const charla = [IN(0, "Hola, info del combo"), OUT(1, "¡Hola! El combo de camilla vale $989.000"), IN(5, "necesito uno para una", "AUDIO")];
  // El audio mal transcrito ya cuenta como pedido de uñas.
  assert.equal(dom.productoVigenteDelChat(charla)?.familia, "mesa-manicure");
  // Y el PDF de la asesora, más nuevo, también.
  const conPdf = [...charla, OUT(311, null, "DOCUMENT", PDF_MANICURA)];
  const producto = dom.productoVigenteDelChat(conPdf);
  assert.equal(producto.familia, "mesa-manicure");
  assert.equal(producto.esElCombo, false);
  assert.match(producto.senal, /COMBO MESA Y SILLAS MANICURA/);
  // "combo para uñas" dicho por la clienta.
  assert.equal(dom.productoVigenteDelChat([IN(0, "Necesito un combo para uñas")])?.familia, "mesa-manicure");
});

await prueba("producto del chat: 'Uñas y pestañas' (respuesta a ¿qué servicios vas a ofrecer?) NO es cambio; gana la señal más nueva", () => {
  assert.equal(dom.productoVigenteDelChat([IN(0, "Hola, info del combo"), IN(3, "Uñas y pestañas")]), null);
  assert.equal(dom.productoVigenteDelChat([IN(0, "Manicure y pestañas")]), null);
  assert.equal(dom.productoVigenteDelChat([IN(0, "necesito uno para una amiga")]), null);
  // Un butaco o un carrito solos son parte de la charla del combo, no otro producto.
  assert.equal(dom.productoVigenteDelChat([IN(0, "¿el butaco es en cuerina?")]), null);
  // Los textos nuestros no cuentan (el bot nombra el combo en cada paso)...
  assert.equal(dom.productoVigenteDelChat([OUT(0, "La mesa de manicure también la tenemos")]), null);
  // ...pero un catálogo que mandamos sí; y si después pide el combo, vuelve el combo.
  const charla = [OUT(0, null, "DOCUMENT", PDF_MANICURA), IN(5, "mejor el combo de camilla")];
  assert.equal(dom.productoVigenteDelChat(charla)?.esElCombo, true);
});

await prueba("habla del combo: la camilla o 'combo' sin otro producto; 'el combo de mesa y sillas' es otro producto", () => {
  assert.equal(dom.hablaDelCombo(GARANTIA), true);
  assert.equal(dom.hablaDelCombo(GUSTO), true);
  assert.equal(dom.hablaDelCombo("¿Te muestro otros colores de la camilla?"), true);
  assert.equal(dom.hablaDelCombo("¿Te gustó el combo de mesa y sillas de manicure?"), false);
  assert.equal(dom.hablaDelCombo(ENVIO), false, "el genérico de la ciudad sí puede salir");
});

await prueba("revisión final: el mismo texto otra vez (con otros emojis o tildes) no sale; uno distinto sí", () => {
  const r = dom.decidirCompuerta({ textos: [ENVIO], previosAutomaticos: ["Asi te confirmo el envio ¿En que ciudad lo recibirias?"], producto: null });
  assert.equal(r?.motivo, "texto_repetido");
  assert.equal(dom.decidirCompuerta({ textos: [ENVIO], previosAutomaticos: [FABRICACION], producto: null }), null);
});

await prueba("revisión final: nada del combo en un chat de mesa de manicure; en un chat del combo sí sale", () => {
  const manicura = dom.productoVigenteDelChat([OUT(0, null, "DOCUMENT", PDF_MANICURA)]);
  assert.equal(dom.decidirCompuerta({ textos: [GARANTIA], previosAutomaticos: [], producto: manicura })?.motivo, "otro_producto");
  assert.equal(dom.decidirCompuerta({ textos: [ENVIO], previosAutomaticos: [], producto: manicura }), null);
  const combo = dom.productoVigenteDelChat([IN(0, "info del combo de camilla")]);
  assert.equal(dom.decidirCompuerta({ textos: [GARANTIA], previosAutomaticos: [], producto: combo }), null);
});

await prueba("medición: los 3 chats del reporte (dos veces el mismo minuto), el repetido tras la respuesta y el combo en manicura", () => {
  const auto = (min, texto) => ({ ...OUT(min, texto), automatico: true });
  const nada = (m) => ({ ...m, automatico: false });
  const desde = en(-60);
  // 302 718 8927: dos veces "¿En qué ciudad…?" a las 13:57 y, tras el PDF de manicura, el de la garantía del combo.
  const c1 = dom.medirChat([nada(IN(0, "hola")), auto(117, ENVIO), auto(117.2, ENVIO), nada(OUT(311, null, "DOCUMENT", PDF_MANICURA)), auto(373, GARANTIA)], desde);
  assert.equal(c1.seguidos.length, 1);
  assert.equal(c1.comboEnOtroProducto.length, 1);
  assert.equal(c1.comboEnOtroProducto[0].producto, "mesa de manicure");
  // 323 294 9961 y 318 888 1825: dos veces el mismo texto en el mismo minuto.
  assert.equal(dom.medirChat([nada(IN(0, "hola")), auto(200, FABRICACION), auto(200.1, FABRICACION)], desde).seguidos.length, 1);
  assert.equal(dom.medirChat([nada(IN(0, "hola")), auto(251, GUSTO), auto(251.1, GUSTO)], desde).seguidos.length, 1);
  // La clienta contesta, el contador se reinicia y sale otra vez el mismo texto (chats 7092 y 9101).
  const c4 = dom.medirChat([nada(IN(0, "hola")), auto(15, ENVIO), nada(IN(20, "ok")), auto(40, ENVIO)], desde);
  assert.deepEqual([c4.seguidos.length, c4.conRespuesta.length], [0, 1]);
  // Un texto que salió antes del periodo cuenta para comparar, pero no se cuenta él.
  assert.equal(dom.medirChat([auto(-100, ENVIO)], desde).seguidos.length, 0);
});

/* ==============================================================================================
   La base de mentira (una sola para el reloj del V3 y el motor de Follow)
============================================================================================== */

const db = {
  mensajes: [], // { id, conversationId, direction, type, content, transcripcion, rawPayload, createdAt, deletedAt }
  estados: new Map(), // AppSetting
  conversaciones: new Map(), // id -> { automationPaused }
  follows: new Map(),
  enviados: [], // lo que salió por WhatsApp
  frenados: [],
  falloAlGuardar: false,
  falloAlEnviar: false,
  ahora: en(0),
};
let secuencia = 0;
function reiniciarDb() {
  db.mensajes = [];
  db.estados = new Map();
  db.conversaciones = new Map();
  db.follows = new Map();
  db.enviados = [];
  db.frenados = [];
  db.falloAlGuardar = false;
  db.falloAlEnviar = false;
}
function agregarMensaje(conversationId, min, direction, content, extra = {}) {
  db.mensajes.push({
    id: `m${++secuencia}`,
    conversationId,
    direction,
    type: "TEXT",
    content,
    transcripcion: null,
    rawPayload: null,
    createdAt: en(min),
    deletedAt: null,
    ...extra,
  });
}
const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function filtrarMensajes(where = {}) {
  return db.mensajes.filter((m) => {
    if (where.conversationId && m.conversationId !== where.conversationId) return false;
    if (where.direction && m.direction !== where.direction) return false;
    if (where.type?.not && m.type === where.type.not) return false;
    if (where.createdAt?.gte && m.createdAt < where.createdAt.gte) return false;
    if (where.createdAt?.gt && m.createdAt <= where.createdAt.gt) return false;
    if (where.OR && !where.OR.some((o) => m.rawPayload?.source === o.rawPayload.equals)) return false;
    return true;
  });
}
const masNuevoPrimero = (lista) => [...lista].sort((a, b) => b.createdAt - a.createdAt);

// Una transacción a la vez: así se comporta el candado de Postgres sobre un mismo chat.
let cola = Promise.resolve();

const prisma = {
  $transaction: (fn) => {
    const resultado = cola.then(() => fn(prisma));
    cola = resultado.catch(() => {});
    return resultado;
  },
  // Con plantilla (`$executeRaw\`...\``) o con Prisma.sql.
  $executeRaw: async (sql, ...valores) => ejecutarSql(Array.isArray(sql) ? { text: sql.join("?"), values: valores } : sql),
  $queryRaw: async (sql) => consultarSql(sql),
  whatsAppChannel: {
    findMany: async () => [{ id: "canal-1", workspaceId: "ws-1", evolutionInstanceName: "ventas-1" }],
    findFirst: async () => ({ id: "canal-1", name: "Ventas 1", provider: "EVOLUTION", agentId: null, evolutionInstanceName: "ventas-1", isActive: true, status: "CONNECTED" }),
  },
  conversation: {
    findMany: async () =>
      [...db.conversaciones.keys()].map((id) => ({
        id,
        lastMessageAt: masNuevoPrimero(db.mensajes.filter((m) => m.conversationId === id))[0]?.createdAt ?? null,
        contactId: `contacto-${id}`,
        contact: { phoneNumber: "573027188927" },
      })),
    findUnique: async ({ where }) => db.conversaciones.get(where.id) ?? null,
    findFirst: async () => ({ id: [...db.conversaciones.keys()][0] ?? null }),
    update: async () => ({}),
    create: async () => ({ id: "conv-nueva" }),
  },
  contact: { findFirst: async () => ({ phoneNumber: "573027188927" }), findUnique: async () => ({ crmStage: "PROPUESTA", excludedFromCrm: false }) },
  message: {
    findFirst: async ({ where }) => masNuevoPrimero(filtrarMensajes(where))[0] ?? null,
    findMany: async ({ where, take }) => masNuevoPrimero(filtrarMensajes(where)).slice(0, take ?? 1_000),
    count: async ({ where }) => filtrarMensajes(where).length,
    create: async ({ data }) => {
      if (db.falloAlGuardar) throw new Error("base caída al guardar");
      db.mensajes.push({ id: `m${++secuencia}`, transcripcion: null, deletedAt: null, createdAt: new Date(db.ahora.getTime() + 1), ...data });
      return data;
    },
    upsert: async ({ create }) => prisma.message.create({ data: create }),
  },
  appSetting: {
    findUnique: async ({ where }) => (db.estados.has(where.key) ? { key: where.key, value: db.estados.get(where.key) } : null),
    update: async ({ where, data }) => db.estados.set(where.key, data.value),
    upsert: async ({ where, create, update }) => db.estados.set(where.key, db.estados.has(where.key) ? update.value : create.value),
  },
};

/* ---- El SQL a mano del motor de Follow ---- */

function textoSql(sql) {
  return sql.text ?? sql.sql ?? "";
}
function consultarSql(sql) {
  const texto = textoSql(sql);
  if (texto.includes("information_schema")) return [{ exists: true }];
  if (texto.includes("WITH candidates")) {
    const workerId = [...sql.values].reverse().find((valor) => typeof valor === "string");
    const ahora = sql.values[0];
    const vencido = sql.values[1];
    const tomados = [];
    for (const follow of db.follows.values()) {
      if (follow.status !== "PENDING" || follow.executeAt > ahora) continue;
      if (follow.lockedAt && follow.lockedAt >= vencido) continue;
      follow.lockedAt = ahora;
      follow.lockedBy = workerId;
      tomados.push({ ...follow });
    }
    return tomados;
  }
  throw new Error(`SQL no simulado: ${texto.slice(0, 80)}`);
}
function ejecutarSql(sql) {
  const texto = textoSql(sql);
  if (texto.includes("pg_advisory_xact_lock")) return 1;
  const valores = sql.values;
  const follow = valores.map((valor) => db.follows.get(valor)).find(Boolean);
  if (!follow) throw new Error(`SQL sin follow: ${texto.slice(0, 80)}`);
  const soloPendiente = /"status" = 'PENDING'/.test(texto.split("WHERE").pop());
  if (soloPendiente && follow.status !== "PENDING") return 0;
  if (/AND "lockedBy" = /.test(texto)) {
    if (follow.lockedBy !== valores[valores.length - 1]) return 0;
    follow.lockedAt = valores[0];
    return 1;
  }
  const acciones = valores.find((valor) => typeof valor === "string" && valor.startsWith("["));
  if (acciones) follow.actions = JSON.parse(acciones);
  if (texto.includes("'EXECUTED'")) {
    follow.status = "EXECUTED";
    follow.executionError = valores[2];
    follow.lockedBy = null;
  } else if (texto.includes("'CANCELLED'")) {
    follow.status = "CANCELLED";
    follow.executionError = valores[1];
    follow.lockedBy = null;
  } else if (texto.includes('"executeAt" =')) {
    follow.executeAt = valores[0];
    follow.lockedBy = null;
    follow.lockedAt = null;
  }
  return 1;
}

/* ---- Lo que se simula alrededor (WhatsApp, el redactor, el anti-bloqueo) ---- */

const redactor = { demora: 0 };
const mocks = {
  "@/lib/prisma": { prisma },
  "@/lib/evolution": {
    sendEvolutionTextMessageWithReconnect: async (envio) => {
      if (db.falloAlEnviar) throw new Error("WhatsApp no respondió");
      db.enviados.push(envio.text);
      return { key: { id: `wa-${db.enviados.length}` } };
    },
    sendEvolutionAudioMessage: async () => ({}),
    sendEvolutionDocumentMessage: async () => ({}),
    sendEvolutionImageMessage: async () => ({}),
    sendEvolutionVideoMessage: async () => ({}),
  },
  "@/features/embudo/servicios/eventos": { registrarSeguimientoEnviado: () => {} },
  "@/lib/chat-resuelto-sql": { WHERE_CHAT_ABIERTO: {} },
  "@/lib/anti-bloqueo/servicio": {
    anotarFrenado: (fila) => db.frenados.push(fila.motivo),
    leerConfigAntiBloqueo: async () => ({ horario: { activo: false }, textoVigente: { activo: false }, unDueno: { activo: false } }),
    marcarEnvioAutomatico: async () => {},
    revisarAntiBloqueo: async () => ({ enviar: true }),
  },
  "@/lib/freno-de-automaticos": {
    revisarFrenoDeAutomatico: async () => ({ enviar: true }),
    ORIGENES_AUTOMATICOS: ["agente-v3-seguimiento", "agente-v3-seguimiento-ia", "follow", "automation_reactivation"],
  },
  "@/features/seguimientos/services/follows": { apagarSiCorresponde: async () => null },
  "@/features/seguimiento-inteligente/servicios/convivencia": {
    PREFIJO_FOLLOW_INTELIGENTE: "Inteligente: ",
    revisarConvivencia: async () => null,
  },
  "@/features/seguimientos/services/seguimiento-que-escucha": {
    marcaDelSeguimiento: () => null,
    // El redactor tarda (la IA): es lo que deja que dos vueltas del reloj se crucen.
    redactarSeguimientoQueEscucha: async ({ textoFijo }) => {
      await esperar(redactor.demora);
      return { enviar: true, texto: textoFijo, deIA: false, textoReemplazado: null, motivo: "texto fijo" };
    },
  },
  "@/features/seguimientos/services/apagado": { anotarSeguimientosApagados: async () => true, revisarApagadoDelChat: async () => null },
  "@/features/seguimiento-inteligente/servicios/dia-siguiente-al-enviar": { revisarDiaSiguienteAlEnviar: async () => null },
  "@/features/flows/services/getCreatedFlowItems": { getCreatedFlowItems: async () => [] },
  "@/lib/agent-product-flow": { getFlowReply: async () => null },
  "@/lib/agent-training": { parseAgentTrainingConfig: () => null },
};

const reglaV3 = (minutos, texto) => ({ id: `r${minutos}`, nombre: `Sin respuesta ${minutos} min`, activa: true, cuando: { tipo: "sin_respuesta", minutos }, entonces: [{ tipo: "mensaje", texto }] });
const libro = { reglas: [] };
const reloj = cargar("src/features/agente-v3/servicios/seguimientos.ts", { ...mocks, "./almacen": { leerLibro: async () => libro } });

const consola = { info: console.info, error: console.error };
console.info = () => {};
console.error = () => {};

function chatV3(id, { ultimoMin, texto, estado = {} }) {
  db.conversaciones.set(id, { automationPaused: false });
  db.estados.set(
    `agente-v3:estado:${id}`,
    JSON.stringify({ productoActivo: null, pasoActual: null, flujosEnviados: [], esPrimerMensaje: false, seguimientosEnviados: [], ...estado }),
  );
  agregarMensaje(id, 0, "INBOUND", "Hola, info del combo");
  agregarMensaje(id, ultimoMin, "OUTBOUND", texto, { rawPayload: { source: "agente-v3" } });
}
const vecesQueSalio = (texto) => db.enviados.filter((enviado) => enviado === texto).length;

/* ==============================================================================================
   2. El reloj del V3: el candado
============================================================================================== */

await prueba("caso 302 718 8927 (13:57): dos vueltas del reloj cruzadas mandan '¿En qué ciudad…?' UNA sola vez", async () => {
  reiniciarDb();
  libro.reglas = [reglaV3(15, ENVIO)];
  chatV3("c-8927", { ultimoMin: 100, texto: "Te comparto las fotos del combo" });
  db.ahora = en(117);
  redactor.demora = 30;
  const [a, b] = await Promise.all([reloj.ejecutarSeguimientosV3(en(117)), reloj.ejecutarSeguimientosV3(en(117))]);
  assert.equal(vecesQueSalio(ENVIO), 1, `salió ${vecesQueSalio(ENVIO)} veces; frenados: ${db.frenados.join(",")}`);
  assert.equal(a.enviados + b.enviados, 1);
  assert.equal(db.mensajes.filter((m) => m.content === ENVIO).length, 1, "se guardó una vez");
  // La otra vuelta la frenó el candado o la revisión final (lo que llegue primero).
  assert.ok(db.frenados.some((motivo) => motivo.startsWith("reserva_") || motivo === "texto_repetido"), db.frenados.join(","));
  // Quedó marcado: la vuelta siguiente tampoco lo manda.
  await reloj.ejecutarSeguimientosV3(en(118));
  assert.equal(vecesQueSalio(ENVIO), 1);
  redactor.demora = 0;
});

await prueba("el candado solo: dos reservas a la vez del mismo recordatorio → una 'reservado' y la otra 'ya_salio'", async () => {
  reiniciarDb();
  chatV3("c-candado", { ultimoMin: 100, texto: "Te comparto las fotos" });
  const estado = cargar("src/features/agente-v3/motor/estado.ts", mocks);
  const pedido = { conversationId: "c-candado", minutos: 15, marcar: [15], ultimoEn: en(100) };
  const resultados = await Promise.all([estado.reservarSeguimientoV3(pedido), estado.reservarSeguimientoV3(pedido)]);
  assert.deepEqual(resultados.sort(), ["reservado", "ya_salio"]);
  assert.deepEqual(JSON.parse(db.estados.get("agente-v3:estado:c-candado")).seguimientosEnviados, [15]);
  // Chat pausado o alguien escribió: no se reserva.
  db.conversaciones.set("c-candado", { automationPaused: true });
  assert.equal(await estado.reservarSeguimientoV3({ ...pedido, minutos: 60, marcar: [60] }), "chat_pausado");
  db.conversaciones.set("c-candado", { automationPaused: false });
  assert.equal(await estado.reservarSeguimientoV3({ ...pedido, minutos: 60, marcar: [60], ultimoEn: en(99) }), "alguien_escribio");
});

await prueba("caso 323 294 9961 (15:20): si se cae después de enviar, la vuelta siguiente NO lo reenvía", async () => {
  reiniciarDb();
  libro.reglas = [reglaV3(60, FABRICACION)];
  chatV3("c-9961", { ultimoMin: 140, texto: "El combo sale en 10 días hábiles" });
  db.ahora = en(200);
  db.falloAlGuardar = true; // WhatsApp lo mandó, pero no se pudo guardar en el chat
  await reloj.ejecutarSeguimientosV3(en(200));
  db.falloAlGuardar = false;
  await reloj.ejecutarSeguimientosV3(en(201));
  await reloj.ejecutarSeguimientosV3(en(202));
  assert.equal(vecesQueSalio(FABRICACION), 1);
  assert.ok(db.frenados.includes("envio_fallido"));
});

await prueba("reloj V3: si la clienta escribe mientras la IA redacta, la reserva lo ve y no sale", async () => {
  reiniciarDb();
  libro.reglas = [reglaV3(15, ENVIO)];
  chatV3("c-escribio", { ultimoMin: 100, texto: "Te comparto las fotos" });
  redactor.demora = 20;
  const vuelta = reloj.ejecutarSeguimientosV3(en(117));
  await esperar(5);
  agregarMensaje("c-escribio", 117, "INBOUND", "Para Cali");
  await vuelta;
  redactor.demora = 0;
  assert.equal(vecesQueSalio(ENVIO), 0);
  assert.ok(db.frenados.includes("reserva_alguien_escribio"), db.frenados.join(","));
});

/* ==============================================================================================
   3. El reloj del V3: la revisión final
============================================================================================== */

await prueba("caso 318 888 1825: la clienta contesta, el contador se reinicia y el mismo texto NO sale otra vez", async () => {
  reiniciarDb();
  libro.reglas = [reglaV3(15, GUSTO)];
  db.conversaciones.set("c-1825", { automationPaused: false });
  db.estados.set("agente-v3:estado:c-1825", JSON.stringify({ seguimientosEnviados: [], flujosEnviados: [] }));
  agregarMensaje("c-1825", 0, "INBOUND", "Hola, info del combo");
  agregarMensaje("c-1825", 20, "OUTBOUND", GUSTO, { rawPayload: { source: "agente-v3-seguimiento" } });
  agregarMensaje("c-1825", 30, "INBOUND", "ok");
  agregarMensaje("c-1825", 31, "OUTBOUND", "¡Genial! El combo viene en 4 colores", { rawPayload: { source: "agente-v3" } });
  const r = await reloj.ejecutarSeguimientosV3(en(50));
  assert.equal(vecesQueSalio(GUSTO), 0);
  assert.equal(r.frenados, 1);
  assert.ok(db.frenados.includes("texto_repetido"));
  // Queda dado por visto: no se vuelve a mirar (ni a pedir a la IA) cada minuto.
  assert.deepEqual(JSON.parse(db.estados.get("agente-v3:estado:c-1825")).seguimientosEnviados, [15]);
});

await prueba("reloj V3: con el PDF de manicura en el chat no sale el recordatorio del combo; el genérico de la ciudad sí", async () => {
  reiniciarDb();
  libro.reglas = [reglaV3(15, GUSTO)];
  chatV3("c-manicura", { ultimoMin: 100, texto: "Te paso el catálogo" });
  agregarMensaje("c-manicura", 101, "OUTBOUND", null, { type: "DOCUMENT", rawPayload: { source: "manual", fileName: PDF_MANICURA } });
  await reloj.ejecutarSeguimientosV3(en(120));
  assert.equal(vecesQueSalio(GUSTO), 0);
  assert.ok(db.frenados.includes("otro_producto"), db.frenados.join(","));

  reiniciarDb();
  libro.reglas = [reglaV3(15, ENVIO)];
  chatV3("c-manicura", { ultimoMin: 100, texto: "Te paso el catálogo" });
  agregarMensaje("c-manicura", 101, "OUTBOUND", null, { type: "DOCUMENT", rawPayload: { source: "manual", fileName: PDF_MANICURA } });
  await reloj.ejecutarSeguimientosV3(en(120));
  assert.equal(vecesQueSalio(ENVIO), 1);
});

/* ==============================================================================================
   4. El motor de Follow
============================================================================================== */

const motor = cargar("src/features/seguimientos/services/follows.ts", mocks);

function follow(id, extra = {}) {
  const fila = {
    id,
    workspaceId: "ws-1",
    contactId: "contacto-1",
    name: "Tras asesora: 1 h",
    followRuleId: null,
    channelId: "canal-1",
    timeType: "HOURS",
    timeValue: 1,
    executeAt: en(0),
    messageType: "TEXT",
    content: GARANTIA,
    mediaUrl: null,
    actions: [{ order: 1, messageType: "TEXT", content: GARANTIA, mediaUrl: null, status: "PENDING", executedAt: null, executionError: null, lockedAt: null, lockedBy: null }],
    status: "PENDING",
    provider: "EVOLUTION",
    cancelOnActivity: false,
    executionError: null,
    executedAt: null,
    cancelledAt: null,
    lockedAt: null,
    lockedBy: null,
    createdAt: en(-60),
    updatedAt: en(-60),
    ...extra,
  };
  db.follows.set(id, fila);
  return fila;
}

await prueba("caso 302 718 8927 (18:13): el 'Tras asesora 1 h' del combo no sale tras el PDF de manicura y queda cancelado con el motivo", async () => {
  reiniciarDb();
  db.conversaciones.set("c-8927", { automationPaused: true });
  agregarMensaje("c-8927", -200, "INBOUND", "necesito uno para una", { type: "AUDIO", transcripcion: "necesito uno para una" });
  agregarMensaje("c-8927", -62, "OUTBOUND", null, { type: "DOCUMENT", rawPayload: { source: "manual", fileName: PDF_MANICURA } });
  follow("f-garantia");
  await motor.executePendingFollows({ workerId: "vuelta-1" });
  assert.deepEqual(db.enviados, []);
  const fila = db.follows.get("f-garantia");
  assert.equal(fila.status, "CANCELLED");
  assert.equal(fila.executionError, "otro_producto");
  assert.ok(db.frenados.includes("otro_producto"));
});

await prueba("Follow: el mismo texto que el chat ya recibió no sale otra vez", async () => {
  reiniciarDb();
  db.conversaciones.set("c-1", { automationPaused: false });
  agregarMensaje("c-1", -300, "OUTBOUND", ENVIO, { rawPayload: { source: "follow" } });
  agregarMensaje("c-1", -200, "INBOUND", "Bogotá");
  follow("f-envio", { content: ENVIO, actions: [{ order: 1, messageType: "TEXT", content: ENVIO, mediaUrl: null, status: "PENDING" }] });
  await motor.executePendingFollows({ workerId: "vuelta-1" });
  assert.deepEqual(db.enviados, []);
  assert.equal(db.follows.get("f-envio").executionError, "texto_repetido");
});

await prueba("Follow: si lo cancelaron mientras la vuelta trabajaba, no sale ni queda como 'ejecutado'", async () => {
  reiniciarDb();
  db.conversaciones.set("c-1", { automationPaused: false });
  follow("f-cancelado", { content: ENVIO, actions: [{ order: 1, messageType: "TEXT", content: ENVIO, mediaUrl: null, status: "PENDING" }] });
  // El redactor tarda; mientras tanto la asesora pausa el chat y se cancelan los automáticos.
  redactor.demora = 20;
  const vuelta = motor.executePendingFollows({ workerId: "vuelta-1" });
  await esperar(5);
  db.follows.get("f-cancelado").status = "CANCELLED";
  db.follows.get("f-cancelado").executionError = "seguimientos_apagados";
  await vuelta;
  redactor.demora = 0;
  assert.deepEqual(db.enviados, []);
  assert.equal(db.follows.get("f-cancelado").status, "CANCELLED");
  assert.equal(db.follows.get("f-cancelado").executionError, "seguimientos_apagados");
});

await prueba("Follow: una vuelta lenta pierde el candado (10 min) y otra lo toma: sale UNA vez", async () => {
  reiniciarDb();
  db.conversaciones.set("c-1", { automationPaused: false });
  follow("f-lento", { content: FABRICACION, actions: [{ order: 1, messageType: "TEXT", content: FABRICACION, mediaUrl: null, status: "PENDING" }] });
  // La vuelta 1 lo tomó hace 11 minutos y sigue trabajando; la vuelta 2 lo ve vencido y lo toma.
  const fila = db.follows.get("f-lento");
  fila.lockedBy = "vuelta-1";
  fila.lockedAt = new Date(Date.now() - 11 * MIN);
  await motor.executePendingFollows({ workerId: "vuelta-2" });
  assert.equal(vecesQueSalio(FABRICACION), 1);
  // La vuelta 1, al volver, ya no es dueña: no lo manda.
  const r = await motor.executePendingFollows({ workerId: "vuelta-1" });
  assert.equal(r.claimed, 0);
  assert.equal(vecesQueSalio(FABRICACION), 1);
});

await prueba("Follow: una acción que una vuelta caída dejó a mitad de enviar no se reenvía: queda fallida con el motivo", async () => {
  reiniciarDb();
  db.conversaciones.set("c-1", { automationPaused: false });
  follow("f-caido", {
    content: GUSTO,
    actions: [{ order: 1, messageType: "TEXT", content: FABRICACION, mediaUrl: null, status: "PENDING", lockedAt: en(-20).toISOString(), lockedBy: "vuelta-caida" }],
    lockedBy: "vuelta-caida",
    lockedAt: new Date(Date.now() - 11 * MIN),
  });
  await motor.executePendingFollows({ workerId: "vuelta-nueva" });
  assert.deepEqual(db.enviados, []);
  const fila = db.follows.get("f-caido");
  assert.equal(fila.actions[0].status, "FAILED");
  assert.equal(fila.actions[0].executionError, motor.MOTIVO_ENVIO_INTERRUMPIDO);
});

await prueba("Follow: un seguimiento de siempre (sin repetir, del combo en chat del combo) sigue saliendo", async () => {
  reiniciarDb();
  db.conversaciones.set("c-1", { automationPaused: false });
  agregarMensaje("c-1", -100, "INBOUND", "Hola, info del combo de camilla");
  follow("f-normal");
  await motor.executePendingFollows({ workerId: "vuelta-1" });
  assert.deepEqual(db.enviados, [GARANTIA]);
  assert.equal(db.follows.get("f-normal").status, "EXECUTED");
});

/* ==============================================================================================
   5. La herramienta del MCP `seguimientos_repetidos`
============================================================================================== */

await prueba("MCP seguimientos_repetidos: cuenta los 3 chats del reporte, el repetido con respuesta y el combo en manicura, con los ids", async () => {
  reiniciarDb();
  const ahora = Date.now();
  const hace = (horas) => new Date(ahora - horas * 3_600_000);
  const auto = (id, horas, texto) => db.mensajes.push({ id: `m${++secuencia}`, conversationId: id, direction: "OUTBOUND", type: "TEXT", content: texto, transcripcion: null, rawPayload: { source: "agente-v3-seguimiento" }, createdAt: hace(horas), deletedAt: null });
  const cliente = (id, horas, texto) => db.mensajes.push({ id: `m${++secuencia}`, conversationId: id, direction: "INBOUND", type: "TEXT", content: texto, transcripcion: null, rawPayload: null, createdAt: hace(horas), deletedAt: null });
  cliente("c-8927", 30, "hola");
  auto("c-8927", 29, ENVIO);
  auto("c-8927", 28.999, ENVIO);
  db.mensajes.push({ id: `m${++secuencia}`, conversationId: "c-8927", direction: "OUTBOUND", type: "DOCUMENT", content: null, transcripcion: null, rawPayload: { source: "manual", fileName: PDF_MANICURA }, createdAt: hace(26), deletedAt: null });
  auto("c-8927", 25, GARANTIA);
  cliente("c-9961", 30, "hola");
  auto("c-9961", 27, FABRICACION);
  auto("c-9961", 26.999, FABRICACION);
  cliente("c-1825", 30, "hola");
  auto("c-1825", 26, GUSTO);
  auto("c-1825", 25.999, GUSTO);
  cliente("c-7092", 30, "hola");
  auto("c-7092", 20, ENVIO);
  cliente("c-7092", 19, "ok");
  auto("c-7092", 18, ENVIO);
  // Hace 10 días: no entra en los 7.
  auto("c-viejo", 240, ENVIO);
  auto("c-viejo", 239.999, ENVIO);

  const mcp = cargar("src/lib/mcp/seguimientos-repetidos.ts", { ...mocks, "@/lib/mcp/supervisor": { puedeVerElSupervisor: async () => true } });
  assert.equal(mcp.esHerramientaDeSeguimientosRepetidos("seguimientos_repetidos"), true);
  const r = await mcp.ejecutarHerramientaMcpSeguimientosRepetidos("seguimientos_repetidos", {}, { workspaceId: "ws-1", userId: "u-1" });
  assert.equal(r.dias, 7);
  assert.equal(r.repetidos_seguidos.veces, 3);
  assert.deepEqual([...r.repetidos_seguidos.ids_de_los_chats].sort(), ["c-1825", "c-8927", "c-9961"]);
  assert.equal(r.repetidos_con_respuesta.veces, 1);
  assert.deepEqual(r.repetidos_con_respuesta.ids_de_los_chats, ["c-7092"]);
  assert.equal(r.combo_en_chat_de_otro_producto.veces, 1);
  assert.equal(r.combo_en_chat_de_otro_producto.ejemplos[0].producto_del_chat, "mesa de manicure");
  assert.match(r.resumen_para_decir, /3 seguimientos repetidos seguidos/);
  // Días fuera de rango.
  await assert.rejects(mcp.ejecutarHerramientaMcpSeguimientosRepetidos("seguimientos_repetidos", { dias: 31 }, { workspaceId: "ws-1", userId: "u-1" }), /de 1 a 30/);
  // Pide el mismo permiso que el embudo por paso (dueño, administradores y supervisora).
  assert.match(fs.readFileSync("src/lib/mcp/seguimientos-repetidos.ts", "utf8"), /if \(!\(await puedeVerElSupervisor\(contexto\)\)\) \{\s*throw/);
});

/* ==============================================================================================
   6. Cableado
============================================================================================== */

await prueba("cableado: herramienta del MCP registrada, la reserva antes del envío y la revisión final en los dos motores", () => {
  const leer = (ruta) => fs.readFileSync(ruta, "utf8");
  const herramientas = leer("src/lib/mcp/herramientas.ts");
  assert.match(herramientas, /\.\.\.HERRAMIENTAS_MCP_SEGUIMIENTOS_REPETIDOS/);
  assert.match(herramientas, /esHerramientaDeSeguimientosRepetidos\(nombre\)/);
  assert.match(leer("src/lib/mcp/seguimientos-repetidos.ts"), /name: "seguimientos_repetidos"[\s\S]*annotations: SOLO_LECTURA/);
  const v3 = leer("src/features/agente-v3/servicios/seguimientos.ts");
  assert.ok(v3.indexOf("const reserva = await reservar()") < v3.indexOf("sendEvolutionTextMessageWithReconnect({"));
  assert.ok(v3.indexOf("revisarCompuertaDeEnvio({") < v3.indexOf("const reserva = await reservar()"));
  assert.match(leer("src/features/agente-v3/motor/estado.ts"), /pg_advisory_xact_lock/);
  const follows = leer("src/features/seguimientos/services/follows.ts");
  assert.match(follows, /revisarCompuertaDeEnvio\(\{/);
  assert.match(follows, /WHERE "id" = \$\{followId\} AND "status" = 'PENDING' AND "lockedBy" = \$\{workerId\}/);
});

console.info = consola.info;
console.error = consola.error;
console.log(`\n${pruebas} pruebas de seguimientos sin duplicados: todas pasaron.`);
