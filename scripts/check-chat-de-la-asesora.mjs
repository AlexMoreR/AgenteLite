/**
 * Prueba del freno "chat de la asesora" (tarjeta axybzjk7, parte 1, 27-nov-2026):
 *   npm run test:chat-de-la-asesora
 *
 * 1. esChatDeLaAsesora (src/lib/chat-de-la-asesora.ts) contra un Postgres de pruebas (PGlite o Docker) con
 *    TODAS las migraciones reales: pausado, asignado con mensaje del CRM o del celular, sin asesora, base caída.
 * 2. El motor de seguimientos (executePendingFollows → executeFollowRecord): en un chat pausado y asignado,
 *    un Follow "Tras asesora" y uno "Etapa" quedan CANCELADOS con chat_de_la_asesora y no se envía nada.
 * 3. barrerTrasAsesora devuelve 0 y no agenda Follows.
 *
 * Sin red ni base real: el envío a WhatsApp es un stub que anota si lo llamaron.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { abrirBaseDePruebas } from "./lib/base-de-pruebas.mjs";
import { cargar, RAIZ } from "./supervisor-cargar.mjs";

const CARPETA = path.join(RAIZ, "prisma", "migrations");
const migraciones = fs
  .readdirSync(CARPETA, { withFileTypes: true })
  .filter((entrada) => entrada.isDirectory())
  .map((entrada) => entrada.name)
  .sort();

const db = await abrirBaseDePruebas();
for (const nombre of migraciones) {
  try {
    await db.exec(fs.readFileSync(path.join(CARPETA, nombre, "migration.sql"), "utf8"));
  } catch (fallo) {
    throw new Error(`La migración ${nombre} falló en la base de pruebas: ${fallo.message}`);
  }
}

let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}
const filas = async (sql, valores = []) => (await db.query(sql, valores)).rows;

/* ---- Una "prisma" de mentira que corre el SQL en la base de pruebas ---- */
const enviados = [];
const prismaDePrueba = {
  $queryRaw: async (consulta) => (await db.query(consulta.text, consulta.values)).rows,
  $executeRaw: async (consulta) => (await db.query(consulta.text, consulta.values)).affectedRows ?? 0,
  conversation: {
    findMany: async ({ where, take }) =>
      filas(
        `SELECT "id" FROM "Conversation" WHERE "workspaceId" = $1 AND "contactId" = $2 AND ($3::text IS NULL OR "channelId" = $3)
          ORDER BY "lastMessageAt" DESC NULLS LAST LIMIT $4`,
        [where.workspaceId, where.contactId, where.channelId ?? null, take ?? 50],
      ),
    // El chequeo de "chat resuelto" del anti-bloqueo: ninguno está resuelto.
    findFirst: async () => null,
  },
  // Lo que lee el envío antes de llamar a WhatsApp (solo lo alcanza el Follow de una persona).
  contact: { findFirst: async () => ({ phoneNumber: "573000000000" }) },
  whatsAppChannel: {
    findFirst: async () => ({ id: "l1", name: "Ventas", provider: "EVOLUTION", agentId: null, evolutionInstanceName: "prueba", phoneNumber: null, isActive: true, status: "CONNECTED" }),
  },
};
// El envío a WhatsApp: anota que lo llamaron y falla (en la prueba nunca sale nada de verdad).
const enviar = (tipo) => async (...args) => {
  enviados.push({ tipo, args });
  throw new Error("envío de prueba: no sale nada");
};
const mocks = {
  "@/lib/prisma": { prisma: prismaDePrueba },
  "@/lib/evolution": {
    sendEvolutionAudioMessage: enviar("audio"),
    sendEvolutionDocumentMessage: enviar("doc"),
    sendEvolutionImageMessage: enviar("imagen"),
    sendEvolutionTextMessageWithReconnect: enviar("texto"),
    sendEvolutionVideoMessage: enviar("video"),
  },
  // Los demás frenos dejan pasar: así el que corta es el de la asesora.
  "@/lib/freno-de-automaticos": { revisarFrenoDeAutomatico: async () => ({ enviar: true }) },
  "@/features/seguimiento-inteligente/servicios/dia-siguiente-al-enviar": { revisarDiaSiguienteAlEnviar: async () => null },
  "@/features/seguimiento-inteligente/servicios/convivencia": {
    PREFIJO_FOLLOW_INTELIGENTE: "Inteligente: ",
    revisarConvivencia: async () => null,
  },
  "@/features/seguimientos/services/apagado": {
    revisarApagadoDelChat: async () => null,
    anotarSeguimientosApagados: async () => undefined,
  },
  "@/lib/anti-bloqueo/servicio": {
    anotarFrenado: () => undefined,
    leerConfigAntiBloqueo: async () => cargar("src/lib/anti-bloqueo/reglas.ts").CONFIG_POR_DEFECTO,
    marcarEnvioAutomatico: async () => undefined,
    revisarAntiBloqueo: async () => ({ enviar: true }),
  },
};

const ca = cargar("src/lib/chat-de-la-asesora.ts", mocks);
const follows = cargar("src/features/seguimientos/services/follows.ts", mocks);
const tras = cargar("src/features/seguimiento-inteligente/servicios/tras-asesora.ts", mocks);

/* ---- Datos ---- */
const WS = "ws1";
const INICIO = new Date("2026-11-20T15:00:00.000Z");
const mas = (minutos) => new Date(INICIO.getTime() + minutos * 60_000);

await db.exec(`
  INSERT INTO "User" ("id", "email", "password", "updatedAt") VALUES ('u1', 'asesora@prueba.local', 'x', now());
  INSERT INTO "Workspace" ("id", "name", "slug", "ownerId", "updatedAt") VALUES ('${WS}', 'Prueba', 'prueba', 'u1', now());
`);

let siguiente = 0;
async function chat({ pausado = false, asignado = false, mensajes = [] }) {
  siguiente += 1;
  const contacto = `k${siguiente}`;
  const id = `c${siguiente}`;
  await db.query(`INSERT INTO "Contact" ("id", "workspaceId", "phoneNumber", "updatedAt") VALUES ($1, $2, $3, now())`, [
    contacto,
    WS,
    `57300000${String(siguiente).padStart(4, "0")}`,
  ]);
  await db.query(
    `INSERT INTO "Conversation" ("id", "workspaceId", "contactId", "assignedToUserId", "automationPaused", "startedAt", "lastMessageAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, $6, $7, now())`,
    [id, WS, contacto, asignado ? "u1" : null, pausado, INICIO, mas(120)],
  );
  let n = 0;
  for (const m of mensajes) {
    n += 1;
    await db.query(
      `INSERT INTO "Message" ("id", "workspaceId", "conversationId", "direction", "type", "status", "content", "rawPayload", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4::"MessageDirection", $5::"MessageType", $6::"MessageStatus", 'hola', $7::jsonb, $8, now())`,
      [`${id}m${n}`, WS, id, m.direction, m.type ?? "TEXT", m.direction === "INBOUND" ? "RECEIVED" : "SENT", JSON.stringify({ source: m.source }), m.en],
    );
  }
  return { id, contacto };
}
const CLIENTE = (min) => ({ direction: "INBOUND", source: "webhook", en: mas(min) });
const BOT = (min) => ({ direction: "OUTBOUND", source: "agente-v3", en: mas(min) });
const CRM = (min) => ({ direction: "OUTBOUND", source: "manual", en: mas(min) });
const CELULAR = (min) => ({ direction: "OUTBOUND", source: "instance", en: mas(min) });

/* ---- 1. esChatDeLaAsesora ---- */
await prueba("chat pausado → es de la asesora (aunque no tenga asesora ni mensajes de persona)", async () => {
  const { id } = await chat({ pausado: true, mensajes: [CLIENTE(0), BOT(1)] });
  assert.equal(await ca.esChatDeLaAsesora(id, prismaDePrueba), true);
});

await prueba("asignado y con un mensaje del CRM (manual) → es de la asesora", async () => {
  const { id } = await chat({ asignado: true, mensajes: [CLIENTE(0), BOT(1), CRM(30)] });
  assert.equal(await ca.esChatDeLaAsesora(id, prismaDePrueba), true);
  assert.equal(await ca.hayPersonaEnElChat(id, prismaDePrueba), true);
});

await prueba("asignado y con un mensaje del celular (instance) → es de la asesora", async () => {
  const { id } = await chat({ asignado: true, mensajes: [CLIENTE(0), CELULAR(30)] });
  assert.equal(await ca.esChatDeLaAsesora(id, prismaDePrueba), true);
});

await prueba("asignado pero solo el automático del celular en el primer minuto → no es de la asesora", async () => {
  const { id } = await chat({ asignado: true, mensajes: [{ ...CELULAR(0), en: new Date(INICIO.getTime() + 20_000) }, CLIENTE(1), BOT(2)] });
  assert.equal(await ca.esChatDeLaAsesora(id, prismaDePrueba), false);
  assert.equal(await ca.hayPersonaEnElChat(id, prismaDePrueba), false);
});

await prueba("sin asesora y sin pausa → no es de la asesora (aunque una persona haya escrito)", async () => {
  const { id } = await chat({ mensajes: [CLIENTE(0), BOT(1), CRM(30)] });
  assert.equal(await ca.esChatDeLaAsesora(id, prismaDePrueba), false);
  assert.equal(await ca.hayPersonaEnElChat(id, prismaDePrueba), true, "hayPersonaEnElChat no mira la asignación");
});

await prueba("asignado pero solo habló el bot → no es de la asesora", async () => {
  const { id } = await chat({ asignado: true, mensajes: [CLIENTE(0), BOT(1)] });
  assert.equal(await ca.esChatDeLaAsesora(id, prismaDePrueba), false);
});

await prueba("chat que no existe → no es de la asesora", async () => {
  assert.equal(await ca.esChatDeLaAsesora("no-existe", prismaDePrueba), false);
});

await prueba("la base falla → se toma como de la asesora (mejor perder un toque que pisarla)", async () => {
  const caida = { $queryRaw: async () => { throw new Error("base caída"); } };
  const errorDeConsola = console.error;
  console.error = () => undefined;
  try {
    assert.equal(await ca.esChatDeLaAsesora("c1", caida), true);
    assert.equal(await ca.hayPersonaEnElChat("c1", caida), true);
  } finally {
    console.error = errorDeConsola;
  }
});

await prueba("el archivo solo lee: no envía nada", async () => {
  const codigo = fs.readFileSync(path.join(RAIZ, "src/lib/chat-de-la-asesora.ts"), "utf8");
  assert.doesNotMatch(codigo, /sendMessage|enviarMensaje/);
  assert.doesNotMatch(codigo, /\b(UPDATE|INSERT|DELETE)\b/);
});

/* ---- 2. El motor de seguimientos ---- */
await prueba("chat pausado y asignado con mensaje del CRM: 'Tras asesora' y 'Etapa' quedan cancelados y no sale nada", async () => {
  const { contacto } = await chat({ pausado: true, asignado: true, mensajes: [CLIENTE(0), BOT(1), CRM(30)] });
  const antes = new Date(Date.now() - 60_000).toISOString();
  for (const [id, nombre] of [["f_tras", "Tras asesora: 1 h"], ["f_etapa", "Etapa Presentación · día siguiente"]]) {
    await db.query(
      `INSERT INTO "Follow" ("id", "workspaceId", "contactId", "name", "timeType", "timeValue", "executeAt", "messageType", "content", "updatedAt")
       VALUES ($1, $2, $3, $4, 'HOURS', 1, $5, 'TEXT', '¿Pudiste ver lo que te envié?', now())`,
      [id, WS, contacto, nombre, antes],
    );
  }
  const resultado = await follows.executePendingFollows({ workspaceId: WS, limit: 10 });
  assert.equal(resultado.claimed, 2);
  const estado = await filas(`SELECT "id", "status"::text AS "status", "executionError" FROM "Follow" WHERE "id" IN ('f_tras', 'f_etapa') ORDER BY "id"`);
  assert.deepEqual(
    estado.map((f) => [f.id, f.status, f.executionError]),
    [
      ["f_etapa", "CANCELLED", "chat_de_la_asesora"],
      ["f_tras", "CANCELLED", "chat_de_la_asesora"],
    ],
  );
  assert.equal(enviados.length, 0, "no se debía llamar al envío");
});

await prueba("en el código: el freno corre en executeFollowRecord antes del envío y no aplica a los 'humano'", async () => {
  const codigo = fs.readFileSync(path.join(RAIZ, "src/features/seguimientos/services/follows.ts"), "utf8");
  const cuerpo = codigo.slice(codigo.indexOf("async function executeFollowRecord"));
  const freno = cuerpo.indexOf('cancelarFollowFrenado(follow, "chat_de_la_asesora")');
  assert.ok(freno > 0, "falta el freno");
  assert.ok(freno < cuerpo.indexOf("sendFollowMessage("), "el freno va antes del envío");
  assert.ok(freno < cuerpo.indexOf("enviarFlujoDelSeguimiento("), "el freno va antes del flujo");
  assert.match(cuerpo, /if \(clase !== "humano"\) \{\s*const charlaDeLaAsesora = await chatDeLaAsesoraDelFollow/);
});

await prueba("en el mismo chat, un Follow que agendó una persona a mano sí intenta salir", async () => {
  const [{ contactId }] = await filas(`SELECT "contactId" FROM "Follow" WHERE "id" = 'f_tras'`);
  await db.query(
    `INSERT INTO "Follow" ("id", "workspaceId", "contactId", "name", "timeType", "timeValue", "executeAt", "messageType", "content", "updatedAt")
     VALUES ('f_humano', $1, $2, 'Llamar mañana', 'HOURS', 1, $3, 'TEXT', 'Hola, te escribo como quedamos', now())`,
    [WS, contactId, new Date(Date.now() - 60_000).toISOString()],
  );
  const errorDeConsola = console.error;
  console.error = () => undefined;
  try {
    await follows.executePendingFollows({ workspaceId: WS, limit: 10 });
  } finally {
    console.error = errorDeConsola;
  }
  assert.equal(enviados.length, 1, "el de la persona llega al envío");
  const [fila] = await filas(`SELECT "executionError" FROM "Follow" WHERE "id" = 'f_humano'`);
  assert.notEqual(fila.executionError, "chat_de_la_asesora");
});

/* ---- 3. Tras asesora apagado ---- */
await prueba("barrerTrasAsesora devuelve 0 y no agenda Follows", async () => {
  const antes = (await filas(`SELECT COUNT(*)::int AS n FROM "Follow"`))[0].n;
  const config = { trasAsesora: { modo: "activo", horas: [1, 24], horasDeGracia: 2, maxPorDia: 50 } };
  assert.equal(await tras.barrerTrasAsesora(WS, config, new Date()), 0);
  const despues = (await filas(`SELECT COUNT(*)::int AS n FROM "Follow"`))[0].n;
  assert.equal(despues, antes);
});

await db.close();
console.log(`\n${pruebas} pruebas del chat de la asesora: todas bien`);
