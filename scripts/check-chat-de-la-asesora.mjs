/**
 * Prueba el freno "chat de la asesora" (tarjeta 8yvjdvpw, 27-nov-2026, parte 1): ningún seguimiento
 * automático le escribe a un chat que ya atiende una asesora.
 *   npm run test:chat-de-la-asesora
 *
 * 1. esChatDeLaAsesora / hayPersonaEnElChat (src/lib/chat-de-la-asesora.ts), con chats armados en un
 *    Postgres de pruebas (PGlite o el de Docker): pausado, asignado con mensaje del CRM o del celular,
 *    sin asesora, y una base que falla.
 * 2. executePendingFollows → executeFollowRecord (src/features/seguimientos/services/follows.ts): un
 *    "Tras asesora" y un "Etapa" en un chat de la asesora quedan CANCELADOS con "chat_de_la_asesora" y el
 *    envío (falso) no se llama; uno agendado a mano por una persona sí sale.
 * 3. barrerTrasAsesora (src/features/seguimiento-inteligente/servicios/tras-asesora.ts) devuelve 0 y no
 *    crea Follows, aunque la configuración lo tenga activo.
 *
 * No toca ninguna base real ni manda mensajes: el envío a WhatsApp es un falso que anota las llamadas.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { abrirBaseDePruebas } from "./lib/base-de-pruebas.mjs";
import { cargar, RAIZ } from "./supervisor-cargar.mjs";

const db = await abrirBaseDePruebas();
let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

await db.exec(`
  CREATE TABLE "Conversation" (
    "id" text PRIMARY KEY,
    "workspaceId" text NOT NULL,
    "contactId" text NOT NULL,
    "channelId" text,
    "assignedToUserId" text,
    "automationPaused" boolean NOT NULL DEFAULT false,
    "status" text NOT NULL DEFAULT 'OPEN',
    "startedAt" timestamp(3) NOT NULL,
    "lastMessageAt" timestamp(3)
  );
  CREATE TABLE "Message" (
    "id" text PRIMARY KEY,
    "workspaceId" text NOT NULL,
    "conversationId" text NOT NULL,
    "contactId" text,
    "channelId" text,
    "direction" text NOT NULL,
    "type" text NOT NULL DEFAULT 'TEXT',
    "status" text NOT NULL DEFAULT 'SENT',
    "readAt" timestamp(3),
    "rawPayload" jsonb,
    "createdAt" timestamp(3) NOT NULL,
    "deletedAt" timestamp(3)
  );
  CREATE TABLE "Follow" (
    "id" text PRIMARY KEY,
    "workspaceId" text NOT NULL,
    "contactId" text NOT NULL,
    "name" text,
    "followRuleId" text,
    "channelId" text,
    "timeType" text NOT NULL DEFAULT 'MINUTES',
    "timeValue" integer NOT NULL DEFAULT 0,
    "executeAt" timestamp(3) NOT NULL,
    "messageType" text NOT NULL DEFAULT 'TEXT',
    "content" text,
    "mediaUrl" text,
    "actions" jsonb,
    "status" text NOT NULL DEFAULT 'PENDING',
    "provider" text NOT NULL DEFAULT 'EVOLUTION',
    "cancelOnActivity" boolean NOT NULL DEFAULT true,
    "executionError" text,
    "executedAt" timestamp(3),
    "cancelledAt" timestamp(3),
    "lockedAt" timestamp(3),
    "lockedBy" text,
    "createdAt" timestamp(3) NOT NULL DEFAULT now(),
    "updatedAt" timestamp(3) NOT NULL DEFAULT now()
  );
`);

const envios = [];
/* Un cliente de Prisma falso: solo SQL ($queryRaw / $executeRaw), contra la base de pruebas. */
const consultas = [];
const aSql = (consulta) => {
  assert.ok(consulta && typeof consulta.text === "string", "se esperaba un Prisma.sql");
  consultas.push(consulta.text);
  return consulta;
};
const fallaLaApiDePrisma = (nombre) =>
  new Proxy({}, { get: (_, metodo) => () => Promise.reject(new Error(`prueba: ${nombre}.${String(metodo)} no está en la base falsa`)) });
const prismaFalso = new Proxy(
  {
    // Lo primero que lee el envío (sendFollowMessage) es el teléfono del contacto: si se llega acá, se iba a enviar.
    contact: {
      findFirst: async () => {
        envios.push({ tipo: "inicio-del-envio" });
        throw new Error("prueba: aquí empezaba el envío");
      },
    },
    $queryRaw: async (consulta) => (await db.query(aSql(consulta).text, consulta.values)).rows,
    $executeRaw: async (consulta) => (await db.query(aSql(consulta).text, consulta.values)).affectedRows ?? 0,
  },
  { get: (objetivo, clave) => (clave in objetivo ? objetivo[clave] : typeof clave === "string" ? fallaLaApiDePrisma(clave) : undefined) },
);

/* El envío a WhatsApp: falso, anota cada llamada (en `envios`, igual que el inicio del envío). */
const enviar = (tipo) => async (entrada) => {
  envios.push({ tipo, entrada });
  throw new Error("prueba: envío falso");
};
const evolutionFalso = {
  sendEvolutionTextMessageWithReconnect: enviar("texto"),
  sendEvolutionAudioMessage: enviar("audio"),
  sendEvolutionDocumentMessage: enviar("documento"),
  sendEvolutionImageMessage: enviar("imagen"),
  sendEvolutionVideoMessage: enviar("video"),
};
const frenados = [];
const antiBloqueoFalso = {
  anotarFrenado: (entrada) => frenados.push(entrada),
  leerConfigAntiBloqueo: async () => cargar("src/lib/anti-bloqueo/reglas.ts").CONFIG_POR_DEFECTO,
  marcarEnvioAutomatico: async () => {},
  revisarAntiBloqueo: async () => ({ enviar: true }),
};

const mocks = {
  "@/lib/prisma": { prisma: prismaFalso },
  "@/lib/evolution": evolutionFalso,
  "@/lib/anti-bloqueo/servicio": antiBloqueoFalso,
};
const chat = cargar("src/lib/chat-de-la-asesora.ts", mocks);
const follows = cargar("src/features/seguimientos/services/follows.ts", mocks);
const trasAsesora = cargar("src/features/seguimiento-inteligente/servicios/tras-asesora.ts", mocks);
const configSI = cargar("src/features/seguimiento-inteligente/dominio/config.ts", mocks);

const WS = "ws_magilus";
const INICIO = new Date("2026-11-27T14:00:00.000Z");
const mas = (minutos) => new Date(INICIO.getTime() + minutos * 60_000);

async function armarChat({ id, asesora = null, pausado = false, mensajes = [], contacto = `ct_${id}`, linea = "linea_1" }) {
  await db.query(
    `INSERT INTO "Conversation" ("id", "workspaceId", "contactId", "channelId", "assignedToUserId", "automationPaused", "startedAt", "lastMessageAt")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [id, WS, contacto, linea, asesora, pausado, INICIO, mas(120)],
  );
  let n = 0;
  for (const mensaje of mensajes) {
    n += 1;
    await db.query(
      `INSERT INTO "Message" ("id", "workspaceId", "conversationId", "contactId", "channelId", "direction", "type", "rawPayload", "createdAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [`${id}_m${n}`, WS, id, contacto, linea, mensaje.direccion ?? "OUTBOUND", mensaje.tipo ?? "TEXT", JSON.stringify({ source: mensaje.origen }), mas(mensaje.minuto)],
    );
  }
}

await armarChat({ id: "pausado", pausado: true, mensajes: [{ direccion: "INBOUND", origen: "webhook", minuto: 0 }] });
await armarChat({ id: "crm", asesora: "u_maria", mensajes: [{ direccion: "INBOUND", origen: "webhook", minuto: 0 }, { origen: "manual", minuto: 30 }] });
await armarChat({ id: "celular", asesora: "u_maria", mensajes: [{ direccion: "INBOUND", origen: "webhook", minuto: 0 }, { origen: "instance", minuto: 30 }] });
await armarChat({
  id: "libre",
  mensajes: [{ direccion: "INBOUND", origen: "webhook", minuto: 0 }, { origen: "agente-v3", minuto: 1 }, { origen: "manual", minuto: 30 }],
});
await armarChat({ id: "asignado_solo_bot", asesora: "u_maria", mensajes: [{ direccion: "INBOUND", origen: "webhook", minuto: 0 }, { origen: "agente-v3", minuto: 1 }] });
await armarChat({ id: "celular_primer_minuto", asesora: "u_maria", mensajes: [{ origen: "instance", minuto: 0.2 }] });
await armarChat({ id: "nota_interna", asesora: "u_maria", mensajes: [{ origen: "manual", tipo: "SYSTEM", minuto: 30 }] });

/* ---- 1. La pregunta común ---- */
await prueba("chat pausado → es de la asesora", async () => {
  assert.equal(await chat.esChatDeLaAsesora("pausado", prismaFalso), true);
});

await prueba("asignado y con un mensaje del CRM (manual) → es de la asesora", async () => {
  assert.equal(await chat.esChatDeLaAsesora("crm", prismaFalso), true);
});

await prueba("asignado y con un mensaje del celular (instance) → es de la asesora", async () => {
  assert.equal(await chat.esChatDeLaAsesora("celular", prismaFalso), true);
});

await prueba("sin asesora y sin pausa → no es de la asesora (aunque alguien haya escrito)", async () => {
  assert.equal(await chat.esChatDeLaAsesora("libre", prismaFalso), false);
  assert.equal(await chat.hayPersonaEnElChat("libre", prismaFalso), true, "una persona sí escribió");
});

await prueba("asignado pero solo habló el bot, el automático del celular del primer minuto o una nota interna → no", async () => {
  assert.equal(await chat.esChatDeLaAsesora("asignado_solo_bot", prismaFalso), false);
  assert.equal(await chat.esChatDeLaAsesora("celular_primer_minuto", prismaFalso), false);
  assert.equal(await chat.esChatDeLaAsesora("nota_interna", prismaFalso), false);
  assert.equal(await chat.hayPersonaEnElChat("asignado_solo_bot", prismaFalso), false);
});

await prueba("hayPersonaEnElChat: el CRM y el celular cuentan, sin límite de tiempo", async () => {
  assert.equal(await chat.hayPersonaEnElChat("crm", prismaFalso), true);
  assert.equal(await chat.hayPersonaEnElChat("celular", prismaFalso), true);
  assert.equal(await chat.hayPersonaEnElChat("pausado", prismaFalso), false);
  assert.equal(await chat.hayPersonaEnElChat("no_existe", prismaFalso), false);
  assert.equal(await chat.esChatDeLaAsesora("no_existe", prismaFalso), false);
});

await prueba("la base falla → se toma como chat de la asesora (mejor perder un toque que pisarla)", async () => {
  const rota = { $queryRaw: async () => { throw new Error("la base no responde"); } };
  const avisos = console.warn;
  console.warn = () => {};
  try {
    assert.equal(await chat.esChatDeLaAsesora("crm", rota), true);
    assert.equal(await chat.hayPersonaEnElChat("crm", rota), true);
  } finally {
    console.warn = avisos;
  }
});

await prueba("solo lee: el archivo no envía nada", async () => {
  const codigo = fs.readFileSync(path.join(RAIZ, "src/lib/chat-de-la-asesora.ts"), "utf8");
  assert.doesNotMatch(codigo, /sendMessage|enviarMensaje/);
  assert.doesNotMatch(codigo, /\b(UPDATE|INSERT|DELETE)\b/);
});

/* ---- 2. El envío de los seguimientos ---- */
await armarChat({
  id: "de_maria",
  contacto: "ct_maria",
  asesora: "u_maria",
  pausado: true,
  mensajes: [{ direccion: "INBOUND", origen: "webhook", minuto: 0 }, { origen: "manual", minuto: 30 }],
});

async function agendar(id, nombre) {
  await db.query(
    `INSERT INTO "Follow" ("id", "workspaceId", "contactId", "name", "channelId", "executeAt", "content", "createdAt")
     VALUES ($1, $2, 'ct_maria', $3, 'linea_1', $4, 'Hola, ¿pudiste ver lo que te envié?', $4)`,
    [id, WS, nombre, new Date(Date.now() - 60_000)],
  );
}

await prueba("chat de la asesora: 'Tras asesora' y 'Etapa' quedan cancelados con chat_de_la_asesora y no se envía nada", async () => {
  await agendar("f_tras", "Tras asesora: 1 h");
  await agendar("f_etapa", "Etapa Bienvenida · 1 h");
  envios.length = 0;
  const resultado = await follows.executePendingFollows({ workspaceId: WS, workerId: "prueba" });
  assert.equal(resultado.claimed, 2);
  assert.equal(envios.length, 0, "el envío no se llamó");
  const filas = (await db.query(`SELECT "id", "status", "executionError", "cancelledAt", "lockedAt" FROM "Follow" WHERE "id" IN ('f_tras', 'f_etapa') ORDER BY "id"`)).rows;
  for (const fila of filas) {
    assert.equal(fila.status, "CANCELLED", fila.id);
    assert.equal(fila.executionError, "chat_de_la_asesora", fila.id);
    assert.ok(fila.cancelledAt, fila.id);
    assert.equal(fila.lockedAt, null, fila.id);
  }
  assert.deepEqual(frenados.map((f) => f.motivo).sort(), ["chat_de_la_asesora", "chat_de_la_asesora"]);
  assert.ok(frenados.every((f) => f.conversationId === "de_maria"));
});

await prueba("los de campañas, automatizaciones y reactivación también se frenan", async () => {
  await agendar("f_campana", "Campaña: Black Friday");
  await agendar("f_auto", "Automatización: Recuperación 72 h");
  await agendar("f_reac", "Mensaje de reactivación");
  await agendar("f_inteligente", "Inteligente: dia_3");
  envios.length = 0;
  await follows.executePendingFollows({ workspaceId: WS, workerId: "prueba" });
  assert.equal(envios.length, 0);
  const filas = (await db.query(`SELECT "status", "executionError" FROM "Follow" WHERE "id" IN ('f_campana', 'f_auto', 'f_reac', 'f_inteligente')`)).rows;
  assert.equal(filas.length, 4);
  for (const fila of filas) assert.deepEqual(fila, { status: "CANCELLED", executionError: "chat_de_la_asesora" });
});

await prueba("uno que agendó una persona a mano NO lo frena este freno: sigue al envío", async () => {
  await agendar("f_mano", "Recordarle el pago");
  envios.length = 0;
  const errores = console.error;
  console.error = () => {};
  try {
    await follows.executePendingFollows({ workspaceId: WS, workerId: "prueba" });
  } finally {
    console.error = errores;
  }
  const [fila] = (await db.query(`SELECT "status", "executionError" FROM "Follow" WHERE "id" = 'f_mano'`)).rows;
  assert.notEqual(fila.status, "CANCELLED");
  assert.notEqual(fila.executionError, "chat_de_la_asesora");
  assert.deepEqual(envios, [{ tipo: "inicio-del-envio" }], "el de la persona llegó al envío");
});

await prueba("follows.ts: el freno va antes de los demás y se salta solo la clase 'humano'", async () => {
  const codigo = fs.readFileSync(path.join(RAIZ, "src/features/seguimientos/services/follows.ts"), "utf8");
  const cuerpo = codigo.slice(codigo.indexOf("async function executeFollowRecord("));
  const freno = cuerpo.indexOf("chatDeLaAsesoraDelFollow(follow)");
  assert.ok(freno > 0);
  assert.ok(freno < cuerpo.indexOf("revisarDiaSiguienteAlEnviar(follow)"));
  assert.ok(freno < cuerpo.indexOf("sendFollowMessage("));
  assert.match(cuerpo.slice(0, freno), /if \(clase !== "humano"\)/);
});

/* ---- 3. Tras asesora ya no agenda ---- */
await prueba("barrerTrasAsesora devuelve 0 y no crea Follows, aunque esté activo", async () => {
  const config = configSI.leerConfigDeTexto(JSON.stringify({ trasAsesora: { modo: "activo" } }));
  assert.equal(config.trasAsesora.modo, "activo");
  const [antes] = (await db.query(`SELECT count(*)::int AS n FROM "Follow"`)).rows;
  consultas.length = 0;
  assert.equal(await trasAsesora.barrerTrasAsesora(WS, config, mas(180)), 0);
  assert.equal(await trasAsesora.barrerTrasAsesora(WS, config, mas(24 * 60)), 0);
  const [despues] = (await db.query(`SELECT count(*)::int AS n FROM "Follow"`)).rows;
  assert.equal(despues.n, antes.n);
  assert.equal(consultas.length, 0, "ni siquiera mira la base");
});

await db.close();
console.log(`\n${pruebas} pruebas del chat de la asesora pasaron.`);
