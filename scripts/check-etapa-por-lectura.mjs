// Pruebas de la etapa por lo que dice el cliente (src/features/crm/services/etapa-por-lectura.ts y
// src/features/crm/domain/intencion-del-cliente.ts) con un prisma y una IA FALSOS.
// Correr: npm run test:etapa-por-lectura
//
// 1. Frases reales de cada etapa: Caliente, Tibio, Descartado y nada.
// 2. "voy a Bogotá en noviembre" → Tibio con recontacto en noviembre; "no gracias, ya compré" → Descartado.
// 3. Un Ganado nunca cambia; con el interruptor apagado no mueve nada; el descarte tiene su interruptor.
// 4. Respeta 24 h lo que movió una persona; nunca baja (Caliente + "lo pienso" solo deja la fecha).
// 5. La IA solo da Caliente o Tibio (nunca Descartado), no se le pregunta por un "ok" ni a un Caliente.
// 6. Nota en el chat, historial con el método, ningún seguimiento; los enganches existen.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { cargar, RAIZ } from "./supervisor-cargar.mjs";

const db = {
  settings: new Map(),
  contacto: null,
  canal: "SALES",
  manualReciente: false,
  historial: [],
  notas: [],
  oficial: [],
  seguimientos: 0,
  ia: [],
  respuestaIA: "NADA",
};

const prisma = {
  appSetting: { findUnique: async ({ where }) => (db.settings.has(where.key) ? { value: db.settings.get(where.key) } : null) },
  conversation: {
    findFirst: async () => ({ contactId: "ct", channelId: "ch", channel: { purpose: db.canal } }),
  },
  officialApiConversation: { findUnique: async () => ({ configId: "cfg", contact: { crmContactId: "ct" } }) },
  contact: {
    findFirst: async () => (db.contacto ? { ...db.contacto } : null),
    updateMany: async ({ where, data }) => {
      if (db.contacto.crmStage !== where.crmStage) return { count: 0 };
      Object.assign(db.contacto, data);
      return { count: 1 };
    },
  },
  historialEtapa: { findFirst: async () => (db.manualReciente ? { id: "h1" } : null) },
  $executeRaw: async (_s, ...valores) => {
    db.oficial.push(valores);
    return 1;
  },
};

const mocks = {
  "@/lib/prisma": { prisma },
  "@/lib/historial-etapa": { registrarCambioDeEtapa: async (c) => void db.historial.push(c) },
  "@/lib/conversation-activity": { recordConversationActivity: async (c) => void db.notas.push(c) },
  "@/features/seguimientos/services/follows": { createFollowsFromRulesForSource: async () => void (db.seguimientos += 1) },
  "node:crypto": { randomUUID: () => "uuid" },
};

process.env.OPENAI_API_KEY = "clave-falsa-de-prueba";
globalThis.fetch = async (_url, opciones) => {
  db.ia.push(JSON.parse(opciones.body).messages.at(-1).content);
  return { ok: true, json: async () => ({ choices: [{ message: { content: db.respuestaIA } }] }) };
};

const servicio = cargar("src/features/crm/services/etapa-por-lectura.ts", mocks);
const dominio = cargar("src/features/crm/domain/intencion-del-cliente.ts", mocks);
const CUANDO = new Date("2026-10-23T15:00:00Z"); // viernes 23-oct, 10 a. m. en Bogotá

let pruebas = 0;
async function prueba(nombre, fn) {
  reiniciar();
  const original = console.log;
  const info = console.info;
  console.log = () => {};
  console.info = () => {};
  try {
    await fn();
  } finally {
    console.log = original;
    console.info = info;
  }
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}
function reiniciar(etapa = "NUEVO") {
  db.settings.clear();
  db.contacto = { crmStage: etapa, excludedFromCrm: false, metadata: { otra: "cosa" }, lostReason: null };
  db.canal = "SALES";
  db.manualReciente = false;
  db.historial.length = 0;
  db.notas.length = 0;
  db.oficial.length = 0;
  db.seguimientos = 0;
  db.ia.length = 0;
  db.respuestaIA = "NADA";
}
const leer = (texto, extra = {}) =>
  servicio.etapaPorLectura({ workspaceId: "ws", source: "agent", conversationId: "cv", texto, cuando: CUANDO, ...extra });

// ── El clasificador por frases (puro) ─────────────────────────────────────────────────────────

await prueba("frases reales de Caliente", async () => {
  const casos = {
    "¿Cómo pago?": "el cliente preguntó cómo pagar",
    "Qué medios de pago manejan": "el cliente preguntó cómo pagar",
    "a qué cuenta consigno": "el cliente pidió los datos para consignar",
    "Me pasas los datos para consignar": "el cliente pidió los datos para consignar",
    "por nequi se puede?": "el cliente preguntó cómo consignar",
    "cuánto sería el total con envío": "el cliente pidió el total",
    "lo quiero en negro": "el cliente eligió color",
    "Soy de Medellín": "el cliente dijo su ciudad para el envío",
    "Laura Gómez\nCC 1020304050\nCalle 10 # 20-30\nMedellín": "el cliente mandó sus datos",
  };
  for (const [texto, porque] of Object.entries(casos)) {
    const r = dominio.leerIntencionPorFrase(texto, CUANDO);
    assert.equal(r?.intencion, "CALIENTE", texto);
    assert.equal(r.porque, porque, texto);
  }
});

await prueba("frases reales de Tibio, con fecha de recontacto", async () => {
  for (const texto of ["más adelante", "Lo pienso y te aviso", "me organizo y te confirmo", "te confirmo", "voy en noviembre", "por ahora no me interesa", "no gracias"]) {
    assert.equal(dominio.leerIntencionPorFrase(texto, CUANDO)?.intencion, "TIBIO", texto);
  }
  // La fecha que dijo el cliente, o 3 días (en horario laboral).
  const noviembre = dominio.fechaDeRecontacto("voy a Bogotá en noviembre", CUANDO);
  assert.equal(noviembre.fecha.getUTCMonth(), 10);
  assert.equal(dominio.fechaDeRecontacto("lo pienso", CUANDO).como, "3 días");
  assert.equal(dominio.fechaDeRecontacto("lo pienso", CUANDO).fecha.toISOString(), "2026-10-26T15:00:00.000Z");
  assert.equal(dominio.fechaDeRecontacto("el lunes te confirmo", CUANDO).como, "el lunes");
});

await prueba("Descartado solo con frase clara", async () => {
  const claras = {
    "No me interesa": "no_le_interesa",
    "ya no estoy interesada, gracias": "no_le_interesa",
    "no gracias, ya compré": "compro_en_otro_lado",
    "Ya lo compré en otro lado": "compro_en_otro_lado",
    "me equivoqué de número": "numero_equivocado",
    "no me escriban más": "no_quiere_que_le_escriban",
    "Dejen de escribirme por favor": "no_quiere_que_le_escriban",
  };
  for (const [texto, motivo] of Object.entries(claras)) {
    const r = dominio.leerIntencionPorFrase(texto, CUANDO);
    assert.equal(r?.intencion, "DESCARTADO", texto);
    assert.equal(r.descarte, motivo, texto);
    assert.ok(r.porque.includes(`«${texto}»`), texto);
  }
  // Con duda NO es descarte: va a Tibio (o a lo que corresponda), nunca a Descartado.
  for (const texto of [
    "voy a Bogotá en noviembre",
    "por ahora no me interesa",
    "no me escriban hoy",
    "no me interesa, ¿tienen otra?",
    "ya compré, ¿cuándo llega?",
    "no gracias",
    "todavía no",
  ]) {
    assert.notEqual(dominio.leerIntencionPorFrase(texto, CUANDO)?.intencion, "DESCARTADO", texto);
  }
  assert.equal(dominio.leerIntencionPorFrase("no me interesa el negro, quiero el blanco", CUANDO)?.intencion, "CALIENTE");
  assert.equal(dominio.leerIntencionPorFrase("ya compré con ustedes, cuándo llega", CUANDO), null);
});

await prueba("sin frase: nada; la IA nunca descarta; los cortos no van a la IA", async () => {
  assert.equal(dominio.leerIntencionPorFrase("hola buenas tardes quisiera información", CUANDO), null);
  assert.equal(dominio.interpretarRespuestaDeLaIA("CALIENTE"), "CALIENTE");
  assert.equal(dominio.interpretarRespuestaDeLaIA("Tibio."), "TIBIO");
  assert.equal(dominio.interpretarRespuestaDeLaIA("DESCARTADO"), "TIBIO");
  assert.equal(dominio.interpretarRespuestaDeLaIA("NADA"), null);
  for (const texto of ["ok", "gracias", "👍", "listo", "", "sí señora"]) assert.equal(dominio.vaALaIA(texto), false, texto);
  assert.equal(dominio.vaALaIA("quisiera saber más de la camilla"), true);
});

// ── El servicio: protecciones, nota, fecha, motivo ───────────────────────────────────────────

await prueba("Caliente: NUEVO pasa a Caliente con nota, historial [frase] y sin seguimientos", async () => {
  assert.equal(await leer("¿Cómo pago?"), "NEGOCIACION");
  assert.equal(db.contacto.crmStage, "NEGOCIACION");
  assert.equal(db.notas.length, 1);
  assert.equal(db.notas[0].text, "Etapa movida por el sistema: Caliente (el cliente preguntó cómo pagar)");
  assert.equal(db.historial[0].origen, "AUTOMATICO");
  assert.equal(db.historial[0].nota, "etapa automática: el cliente preguntó cómo pagar [frase]");
  assert.equal(db.seguimientos, 0);
  assert.equal(db.ia.length, 0);
});

await prueba("\"voy a Bogotá en noviembre\" → Tibio con recontacto en noviembre, nunca Descartado", async () => {
  reiniciar("CALIFICADO");
  assert.equal(await leer("voy a Bogotá en noviembre"), "PROPUESTA");
  assert.equal(db.contacto.lostReason, null);
  assert.ok(db.contacto.metadata.recontactarEl.startsWith("2026-11-"));
  assert.equal(db.contacto.metadata.otra, "cosa");
  assert.equal(db.notas[0].text, "Etapa movida por el sistema: Tibio (el cliente lo deja para noviembre)");
});

await prueba("\"no gracias, ya compré\" → Descartado con motivo y frase exacta", async () => {
  reiniciar("PROPUESTA");
  assert.equal(await leer("no gracias, ya compré"), "PERDIDO");
  assert.equal(db.contacto.lostReason, "compro_competencia");
  assert.equal(db.contacto.metadata.descartePorLectura.frase, "no gracias, ya compré");
  assert.equal(db.notas[0].text, "Etapa movida por el sistema: Descartado (el cliente dijo: «no gracias, ya compré»)");
  assert.equal(db.seguimientos, 0);
  reiniciar();
  assert.equal(await leer("me equivoqué de número"), "PERDIDO");
  assert.equal(db.contacto.lostReason, "otro: Número equivocado");
});

await prueba("un Ganado nunca cambia (ni un Perdido)", async () => {
  for (const etapa of ["GANADO", "PERDIDO"]) {
    for (const texto of ["¿Cómo pago?", "lo pienso", "no me interesa", "quisiera saber más de la camilla"]) {
      reiniciar(etapa);
      db.respuestaIA = "CALIENTE";
      assert.equal(await leer(texto), null, `${etapa}: ${texto}`);
      assert.equal(db.contacto.crmStage, etapa);
      assert.equal(db.contacto.metadata.recontactarEl, undefined);
      assert.equal(db.notas.length + db.historial.length + db.ia.length, 0);
    }
  }
});

await prueba("con el interruptor apagado no mueve nada (ni pregunta a la IA)", async () => {
  db.settings.set("crm:etapa-automatica:ws", "off");
  for (const texto of ["¿Cómo pago?", "lo pienso", "no me interesa", "quisiera saber más de la camilla"]) {
    assert.equal(await leer(texto), null);
  }
  assert.equal(db.contacto.crmStage, "NUEVO");
  assert.equal(db.ia.length, 0);
  assert.equal(db.notas.length, 0);
});

await prueba("con el interruptor del descarte apagado las frases de descarte no hacen nada", async () => {
  db.settings.set("crm:etapa-automatica:descarte:ws", "off");
  assert.equal(await leer("no me interesa"), null);
  assert.equal(db.contacto.crmStage, "NUEVO");
  // Lo demás sigue andando.
  assert.equal(await leer("¿Cómo pago?"), "NEGOCIACION");
});

await prueba("si una persona movió la etapa en las últimas 24 h no se cambia nada", async () => {
  db.manualReciente = true;
  assert.equal(await leer("¿Cómo pago?"), null);
  assert.equal(await leer("no me interesa"), null);
  assert.equal(await leer("lo pienso"), null);
  assert.equal(db.contacto.crmStage, "NUEVO");
  assert.equal(db.contacto.metadata.recontactarEl, undefined);
});

await prueba("nunca baja: un Caliente que dice \"lo pienso\" sigue Caliente y solo queda la fecha", async () => {
  reiniciar("NEGOCIACION");
  assert.equal(await leer("lo pienso"), null);
  assert.equal(db.contacto.crmStage, "NEGOCIACION");
  assert.ok(db.contacto.metadata.recontactarEl);
  assert.equal(db.notas.length, 0);
});

await prueba("fuera del CRM y línea administrativa no se mueven", async () => {
  db.contacto.excludedFromCrm = true;
  assert.equal(await leer("¿Cómo pago?"), null);
  reiniciar();
  db.canal = "ADMIN";
  assert.equal(await leer("no me interesa"), null);
  assert.equal(db.contacto.crmStage, "NUEVO");
});

await prueba("la IA decide cuando no hay frase, y nunca descarta", async () => {
  db.respuestaIA = "CALIENTE";
  assert.equal(await leer("quisiera saber más de la camilla doble para mi spa"), "NEGOCIACION");
  assert.equal(db.ia.length, 1);
  assert.equal(db.historial[0].nota, "etapa automática: el cliente mostró intención de compra [ia]");
  reiniciar();
  db.respuestaIA = "DESCARTADO";
  assert.equal(await leer("quisiera saber más de la camilla doble para mi spa"), "PROPUESTA");
  assert.notEqual(db.contacto.crmStage, "PERDIDO");
  reiniciar();
  db.respuestaIA = "NADA";
  assert.equal(await leer("quisiera saber más de la camilla doble para mi spa"), null);
  assert.equal(db.contacto.crmStage, "NUEVO");
});

await prueba("a la IA no se le pregunta por un \"ok\" ni por un lead ya Caliente", async () => {
  db.respuestaIA = "CALIENTE";
  assert.equal(await leer("ok"), null);
  assert.equal(await leer("gracias 🙏"), null);
  reiniciar("NEGOCIACION");
  assert.equal(await leer("quisiera saber más de la camilla doble para mi spa"), null);
  assert.equal(db.ia.length, 0);
});

await prueba("línea Admin, \"fuera del CRM\" o movido a mano en 24 h: el mensaje no sale a la IA", async () => {
  db.respuestaIA = "CALIENTE";
  const texto = "quisiera saber más de la camilla doble para mi spa";
  db.canal = "ADMIN";
  assert.equal(await leer(texto), null);
  reiniciar();
  db.contacto.excludedFromCrm = true;
  assert.equal(await leer(texto), null);
  reiniciar();
  db.manualReciente = true;
  assert.equal(await leer(texto), null);
  assert.equal(db.ia.length, 0);
  assert.equal(db.contacto.crmStage, "NUEVO");
});

await prueba("una IA caída o sin texto no rompe nada", async () => {
  const fetchBueno = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("sin red");
  };
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(await leer("quisiera saber más de la camilla doble para mi spa"), null);
    assert.equal(await leer(null), null);
  } finally {
    globalThis.fetch = fetchBueno;
    console.warn = warn;
  }
});

// 30-oct-2026: la subida se deshizo porque el registro dejaba `error: 'fetch failed'` y el mensaje de Prisma
// en varias líneas (`error: '\n' +`), que la vigilancia de 30 minutos cuenta como falla nueva.
const LINEA_DE_FALLA = /\b(error|fatal|unhandled|uncaught|exception|panic|ECONNREFUSED)\b/i;
async function registroDe(fn) {
  const lineas = [];
  const guardar = (...partes) => lineas.push(partes.map((p) => (typeof p === "string" ? p : JSON.stringify(p))).join(" "));
  const antes = { log: console.log, info: console.info, warn: console.warn, error: console.error };
  Object.assign(console, { log: guardar, info: guardar, warn: guardar, error: guardar });
  try {
    await fn();
  } finally {
    Object.assign(console, antes);
  }
  return lineas;
}

await prueba("si la IA o la base no contestan, el registro queda en una línea y sin palabras de falla", async () => {
  const fetchBueno = globalThis.fetch;
  const findFirst = prisma.contact.findFirst;
  try {
    globalThis.fetch = async () => {
      throw new TypeError("fetch failed");
    };
    const sinIA = await registroDe(() => leer("quisiera saber más de la camilla doble para mi spa"));
    assert.equal(sinIA.length, 1);
    assert.match(sinIA[0], /la IA no contestó .*causa=sin-conexion/);

    const fallaDePrisma = Object.assign(new Error("\nInvalid `prisma.contact.findFirst()` invocation:\n\nTimed out fetching a new connection"), { code: "P2024" });
    prisma.contact.findFirst = async () => {
      throw fallaDePrisma;
    };
    const sinBase = await registroDe(() => leer("¿Cómo pago?"));
    assert.ok(sinBase.length >= 1);
    assert.ok(sinBase.some((linea) => /causa=base-P2024/.test(linea)), sinBase.join(" | "));

    for (const linea of [...sinIA, ...sinBase]) {
      assert.ok(!LINEA_DE_FALLA.test(linea), linea);
      assert.ok(!linea.includes("\n"), linea);
    }
  } finally {
    globalThis.fetch = fetchBueno;
    prisma.contact.findFirst = findFirst;
  }
});

await prueba("la causa corta nunca trae una palabra de falla", async () => {
  const { causaCorta } = cargar("src/lib/etapa-automatica-crm.ts", mocks);
  const casos = [
    [{ code: "ECONNREFUSED" }, "sin-conexion"],
    [Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), { code: "ECONNREFUSED" }), "sin-conexion"],
    [new Error("connect ECONNREFUSED 127.0.0.1:5432"), "sin-conexion"],
    [new TypeError("fetch failed"), "sin-conexion"],
    [Object.assign(new Error("x"), { code: "P2024" }), "base-P2024"],
    [Object.assign(new Error("x"), { code: "57P03" }), "base-57P03"],
    [Object.assign(new Error("tardó"), { name: "TimeoutError" }), "tardo-demasiado"],
    [new Error("OpenAI respondió 500"), "http-500"],
    [new Error("Unhandled exception: fatal panic"), "otra"],
  ];
  for (const [falla, esperada] of casos) {
    const causa = causaCorta(falla);
    assert.equal(causa, esperada, String(falla?.message ?? falla?.code));
    assert.ok(!LINEA_DE_FALLA.test(`causa=${causa}`), causa);
  }
});

await prueba("un mensaje sin frase ni IA no consulta la base", async () => {
  let consultas = 0;
  const findUnique = prisma.appSetting.findUnique;
  prisma.appSetting.findUnique = async (args) => {
    consultas += 1;
    return findUnique(args);
  };
  try {
    assert.equal(await leer("ok"), null);
    assert.equal(await leer("gracias"), null);
    assert.equal(consultas, 0);
  } finally {
    prisma.appSetting.findUnique = findUnique;
  }
});

await prueba("API oficial: la nota queda en la tabla del canal oficial", async () => {
  assert.equal(await leer("¿Cómo pago?", { source: "official", conversationId: "ov" }), "NEGOCIACION");
  assert.equal(db.oficial.length, 1);
  assert.ok(db.oficial[0].includes("Etapa movida por el sistema: Caliente (el cliente preguntó cómo pagar)"));
  assert.equal(db.notas.length, 0);
});

await prueba("los enganches existen: las dos entradas de WhatsApp, el enfriamiento y la medición", async () => {
  const archivo = (a) => fs.readFileSync(path.join(RAIZ, a), "utf8");
  assert.ok(archivo("src/app/api/webhooks/evolution/route.ts").includes("etapaPorLectura("));
  assert.ok(archivo("src/lib/official-api-crm-stage.ts").includes("etapaPorLectura("));
  assert.ok(archivo("src/features/crm/services/bajada-por-inactividad.ts").includes("'recontactarEl'"));
  assert.ok(archivo("src/lib/mcp/que-es-esta-aplicacion.ts").includes("etapa_por_lectura: await estadoDeEtapaPorLectura("));
  // Leer un mensaje no le manda nada al cliente: el servicio no envía mensajes.
  const fuente = archivo("src/features/crm/services/etapa-por-lectura.ts");
  assert.ok(!/sendMessage|sendText|enviarMensaje|evolution|graph\.facebook/i.test(fuente));
});

console.log(`\n${pruebas} pruebas ok`);
