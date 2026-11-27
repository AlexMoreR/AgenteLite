// Pruebas del CHAT DE LA ASESORA (tarjeta 8yvjdvpw, parte 1, 27-11-2026): «el bot no debe escribir en
// chats que ya atiende una asesora».
//   npm run test:chat-de-la-asesora
//
// Contra un Postgres de pruebas (PGlite, o el de Docker con PRUEBAS_POSTGRES_URL) con TODAS las migraciones
// reales, sin tocar ninguna base real:
//  1. esChatDeLaAsesora (src/lib/chat-de-la-asesora.ts): pausado, asignado con mensaje del CRM o del celular,
//     sin asesora, y una base que falla.
//  2. El motor de seguimientos (executePendingFollows → executeFollowRecord): en un chat de la asesora, un
//     "Tras asesora" y un "Etapa" quedan CANCELADOS con `chat_de_la_asesora` y no se envía nada; uno que
//     agendó una persona a mano sí sale.
//  3. barrerTrasAsesora: devuelve 0 y no crea Follows.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

import { abrirBaseDePruebas } from "./lib/base-de-pruebas.mjs";
import { cargar, RAIZ } from "./supervisor-cargar.mjs";

const { Prisma } = createRequire(path.join(RAIZ, "package.json"))("@prisma/client");

/* ---- Base de pruebas con las migraciones reales ---- */
const CARPETA = path.join(RAIZ, "prisma", "migrations");
const migraciones = fs
  .readdirSync(CARPETA, { withFileTypes: true })
  .filter((entrada) => entrada.isDirectory() && fs.existsSync(path.join(CARPETA, entrada.name, "migration.sql")))
  .map((entrada) => entrada.name)
  .sort();
const pg = await abrirBaseDePruebas();
for (const nombre of migraciones) {
  try {
    await pg.exec(fs.readFileSync(path.join(CARPETA, nombre, "migration.sql"), "utf8"));
  } catch (fallo) {
    throw new Error(`La migración ${nombre} falló en la base de pruebas: ${fallo.message}`);
  }
}
// Solo se prueban estas tablas: sin las llaves foráneas no hace falta armar workspace, usuarios ni líneas.
await pg.exec(`
  ALTER TABLE "Conversation" DROP CONSTRAINT IF EXISTS "Conversation_workspaceId_fkey";
  ALTER TABLE "Conversation" DROP CONSTRAINT IF EXISTS "Conversation_contactId_fkey";
  ALTER TABLE "Conversation" DROP CONSTRAINT IF EXISTS "Conversation_channelId_fkey";
  ALTER TABLE "Conversation" DROP CONSTRAINT IF EXISTS "Conversation_assignedToUserId_fkey";
  ALTER TABLE "Message" DROP CONSTRAINT IF EXISTS "Message_workspaceId_fkey";
  ALTER TABLE "Message" DROP CONSTRAINT IF EXISTS "Message_contactId_fkey";
  ALTER TABLE "Message" DROP CONSTRAINT IF EXISTS "Message_channelId_fkey";
  ALTER TABLE "Message" DROP CONSTRAINT IF EXISTS "Message_conversationId_fkey";
  ALTER TABLE "Follow" DROP CONSTRAINT IF EXISTS "Follow_workspaceId_fkey";
  ALTER TABLE "Follow" DROP CONSTRAINT IF EXISTS "Follow_contactId_fkey";
  ALTER TABLE "Follow" DROP CONSTRAINT IF EXISTS "Follow_channelId_fkey";
  ALTER TABLE "Follow" DROP CONSTRAINT IF EXISTS "Follow_followRuleId_fkey";
`);

/** La base de pruebas con la cara de Prisma que usa el código: $queryRaw / $executeRaw con Prisma.sql. */
const consultas = [];
const base = {
  $queryRaw: async (sql) => {
    consultas.push(sql.text);
    return (await pg.query(sql.text, sql.values)).rows;
  },
  $executeRaw: async (sql) => {
    consultas.push(sql.text);
    return (await pg.query(sql.text, sql.values)).affectedRows ?? 0;
  },
  // Lo de Prisma "de objetos" que toca el motor antes de llegar al freno: sin chat resuelto, sin mensajes.
  conversation: { findFirst: async () => null },
  message: { count: async () => 0 },
  contact: { findUnique: async () => ({ crmStage: "PROPUESTA", excludedFromCrm: false }) },
};
const baseQueFalla = {
  $queryRaw: async () => {
    throw new Error("la base no responde");
  },
};

/* ---- El motor de seguimientos con sus vecinos de mentira (sin red ni WhatsApp) ---- */
const envios = [];
const enviar = (tipo) => async (input) => {
  envios.push({ tipo, input });
  return { key: { id: `wa-${envios.length}` } };
};
const nada = async () => null;
const mocks = {
  "@/lib/prisma": { prisma: base },
  "@/lib/evolution": {
    sendEvolutionAudioMessage: enviar("audio"),
    sendEvolutionDocumentMessage: enviar("doc"),
    sendEvolutionImageMessage: enviar("imagen"),
    sendEvolutionTextMessageWithReconnect: enviar("texto"),
    sendEvolutionVideoMessage: enviar("video"),
  },
  "@/lib/freno-de-automaticos": { revisarFrenoDeAutomatico: async () => ({ enviar: true }) },
  "@/lib/anti-bloqueo/servicio": {
    anotarFrenado: () => {},
    leerConfigAntiBloqueo: async () => ({
      horario: { activo: false },
      textoVigente: { activo: false },
      unDueno: { activo: false },
      topeTotal: { activo: false },
      espaciado: { activo: false },
    }),
    marcarEnvioAutomatico: async () => {},
    revisarAntiBloqueo: async () => ({ enviar: true }),
  },
  "@/features/seguimiento-inteligente/servicios/dia-siguiente-al-enviar": { revisarDiaSiguienteAlEnviar: nada },
  "@/features/seguimiento-inteligente/servicios/convivencia": { PREFIJO_FOLLOW_INTELIGENTE: "Inteligente: ", revisarConvivencia: nada },
  "@/features/seguimientos/services/apagado": { revisarApagadoDelChat: nada, anotarSeguimientosApagados: nada },
  "@/features/seguimientos/services/motores-viejos": { seguimientoDelV2EnPausa: async () => false },
  "@/features/embudo/servicios/eventos": { registrarSeguimientoEnviado: nada, registrarEventos: nada },
};
const follows = cargar("src/features/seguimientos/services/follows.ts", mocks);
// Ya quedó en caché con la base de mentira (la cargó follows.ts): se usa la misma.
const chat = cargar("src/lib/chat-de-la-asesora.ts", mocks);

let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const INICIO = new Date("2026-11-27T14:00:00.000Z");
const minutos = (n) => new Date(INICIO.getTime() + n * 60_000);

async function crearChat(id, { pausado = false, asesora = null, contacto = `k-${id}`, linea = "l1" } = {}) {
  await pg.query(
    `INSERT INTO "Conversation" ("id", "workspaceId", "contactId", "channelId", "assignedToUserId", "automationPaused", "startedAt", "lastMessageAt", "updatedAt")
     VALUES ($1, 'ws1', $2, $3, $4, $5, $6, $6, $6)`,
    [id, contacto, linea, asesora, pausado, INICIO],
  );
}
let numeroDeMensaje = 0;
async function crearMensaje(conversationId, { fuente, minuto = 10, direccion = "OUTBOUND", tipo = "TEXT", contacto = `k-${conversationId}` }) {
  numeroDeMensaje += 1;
  await pg.query(
    `INSERT INTO "Message" ("id", "workspaceId", "conversationId", "contactId", "channelId", "direction", "type", "content", "rawPayload", "createdAt", "updatedAt")
     VALUES ($1, 'ws1', $2, $3, 'l1', $4, $5, 'hola', $6::jsonb, $7, $7)`,
    [`m${numeroDeMensaje}`, conversationId, contacto, direccion, tipo, JSON.stringify({ source: fuente }), minutos(minuto)],
  );
}

/* ---- 1. esChatDeLaAsesora ---- */
await prueba("chat pausado → es de la asesora (aunque no tenga asesora ni mensajes)", async () => {
  await crearChat("c-pausado", { pausado: true });
  assert.equal(await chat.esChatDeLaAsesora("c-pausado", base), true);
});

await prueba("asignado y con un mensaje de la asesora desde el CRM (manual) → sí", async () => {
  await crearChat("c-manual", { asesora: "u1" });
  await crearMensaje("c-manual", { fuente: "manual" });
  assert.equal(await chat.esChatDeLaAsesora("c-manual", base), true);
});

await prueba("asignado y con un mensaje desde el celular (instance) → sí", async () => {
  await crearChat("c-celular", { asesora: "u1" });
  await crearMensaje("c-celular", { fuente: "instance", minuto: 30 });
  assert.equal(await chat.esChatDeLaAsesora("c-celular", base), true);
});

await prueba("sin asesora y sin pausa → no (aunque haya mensajes del bot o del cliente)", async () => {
  await crearChat("c-libre");
  await crearMensaje("c-libre", { fuente: "agente-v3" });
  await crearMensaje("c-libre", { fuente: "webhook", direccion: "INBOUND" });
  assert.equal(await chat.esChatDeLaAsesora("c-libre", base), false);
});

await prueba("asignado pero solo con mensajes del bot, o el automático del primer minuto del celular → no", async () => {
  await crearChat("c-asignado-bot", { asesora: "u1" });
  await crearMensaje("c-asignado-bot", { fuente: "agente-v3" });
  await crearMensaje("c-asignado-bot", { fuente: "instance", minuto: 0.3 });
  assert.equal(await chat.esChatDeLaAsesora("c-asignado-bot", base), false);
  assert.equal(await chat.hayPersonaEnElChat("c-asignado-bot", base), false);
});

await prueba("hayPersonaEnElChat: una persona escribió alguna vez, sin importar la asignación", async () => {
  await crearChat("c-sin-asignar-manual");
  await crearMensaje("c-sin-asignar-manual", { fuente: "manual" });
  assert.equal(await chat.hayPersonaEnElChat("c-sin-asignar-manual", base), true);
  assert.equal(await chat.esChatDeLaAsesora("c-sin-asignar-manual", base), false, "sin asesora asignada ni pausa");
  assert.equal(await chat.hayPersonaEnElChat("c-libre", base), false);
});

await prueba("la base falla → sí (mejor perder un toque que pisar a la asesora)", async () => {
  assert.equal(await chat.esChatDeLaAsesora("c-libre", baseQueFalla), true);
  assert.equal(await chat.hayPersonaEnElChat("c-libre", baseQueFalla), true);
  assert.equal((await chat.esChatDeLaAsesoraDelContacto({ workspaceId: "ws1", contactId: "k-c-libre", channelId: "l1" }, baseQueFalla)).deLaAsesora, true);
});

/* ---- 2. El motor de seguimientos ---- */
async function crearFollow(id, nombre, contacto) {
  await pg.query(
    `INSERT INTO "Follow" ("id", "workspaceId", "contactId", "channelId", "name", "timeType", "timeValue", "executeAt", "messageType", "content", "status", "createdAt", "updatedAt")
     VALUES ($1, 'ws1', $2, 'l1', $3, 'MINUTES', 0, $4, 'TEXT', 'Hola, ¿pudiste ver?', 'PENDING', $4, $4)`,
    [id, contacto, nombre, new Date(Date.now() - 60_000)],
  );
}

await prueba("chat pausado y asignado con mensaje manual: 'Tras asesora' y 'Etapa' quedan cancelados con chat_de_la_asesora y no se envía nada", async () => {
  await crearChat("c-follow", { pausado: true, asesora: "u1", contacto: "k-follow" });
  await crearMensaje("c-follow", { fuente: "manual", contacto: "k-follow" });
  await crearFollow("f-tras", "Tras asesora: 1 h", "k-follow");
  await crearFollow("f-etapa", "Etapa PRESENTACION · día siguiente", "k-follow");
  envios.length = 0;
  const resultado = await follows.executePendingFollows({ workspaceId: "ws1", limit: 10, workerId: "prueba" });
  assert.equal(resultado.claimed, 2);
  assert.equal(envios.length, 0, "no debía llamar al envío");
  const filas = (await pg.query(`SELECT "id", "status", "executionError" FROM "Follow" WHERE "id" IN ('f-tras', 'f-etapa') ORDER BY "id"`)).rows;
  assert.deepEqual(
    filas.map((fila) => [fila.id, fila.status, fila.executionError]),
    [
      ["f-etapa", "CANCELLED", "chat_de_la_asesora"],
      ["f-tras", "CANCELLED", "chat_de_la_asesora"],
    ],
  );
});

await prueba("un Follow que agendó una persona a mano sí sale en el chat de la asesora", async () => {
  await crearFollow("f-humano", "Llamar el lunes", "k-follow");
  envios.length = 0;
  const resultado = await follows.executePendingFollows({ workspaceId: "ws1", limit: 10, workerId: "prueba" });
  assert.equal(resultado.claimed, 1);
  const [fila] = (await pg.query(`SELECT "status", "executionError" FROM "Follow" WHERE "id" = 'f-humano'`)).rows;
  assert.notEqual(fila.executionError, "chat_de_la_asesora");
  assert.ok(envios.length > 0 || fila.status === "EXECUTED", `debía intentar salir (estado ${fila.status}, ${fila.executionError})`);
});

await prueba("un 'Etapa' en un chat sin asesora ni pausa no lo frena este freno", async () => {
  await crearChat("c-libre-follow", { contacto: "k-libre-follow" });
  await crearFollow("f-etapa-libre", "Etapa PRESENTACION · día siguiente", "k-libre-follow");
  await follows.executePendingFollows({ workspaceId: "ws1", limit: 10, workerId: "prueba" });
  const [fila] = (await pg.query(`SELECT "executionError" FROM "Follow" WHERE "id" = 'f-etapa-libre'`)).rows;
  assert.notEqual(fila.executionError, "chat_de_la_asesora");
});

/* ---- 3. barrerTrasAsesora ---- */
await prueba("barrerTrasAsesora: apagado, devuelve 0 y no crea Follows ni consulta la base", async () => {
  const creados = [];
  const ta = cargar("src/features/seguimiento-inteligente/servicios/tras-asesora.ts", {
    "@/lib/prisma": { prisma: baseQueFalla },
    "@/features/seguimientos/services/follows": { createFollow: async (input) => creados.push(input) },
    "@/features/embudo/servicios/eventos": { registrarEventos: nada },
  });
  const config = { trasAsesora: { modo: "activo", horas: [1, 24], horasDeGracia: 2, maxPorDia: 0 }, formulario: { desdeHora: 0, hastaHora: 24, dias: [0, 1, 2, 3, 4, 5, 6] } };
  const antes = Number((await pg.query(`SELECT COUNT(*)::int AS n FROM "Follow"`)).rows[0].n);
  assert.equal(await ta.barrerTrasAsesora("ws1", config, new Date()), 0);
  assert.equal(creados.length, 0);
  assert.equal(Number((await pg.query(`SELECT COUNT(*)::int AS n FROM "Follow"`)).rows[0].n), antes);
});

/* ---- 4. Parte 2 (tarjeta veotoze6): el aviso de pausa y el recordatorio del V3 ---- */
// El aviso «En un momento una de nuestras asesoras te contacta» pregunta `hayPersonaEnElChat` (route.ts):
// antes miraba solo las últimas 6 h y salió igual a una clienta con la que Ingrid había hablado hacía
// más de 24 h (26-11-2026, 15:45).
await prueba("aviso de pausa: hayPersonaEnElChat es sí con un mensaje manual de hace más de 6 h (no sale el aviso)", async () => {
  const haceUnDia = new Date(Date.now() - 30 * 3_600_000);
  await pg.query(
    `INSERT INTO "Conversation" ("id", "workspaceId", "contactId", "channelId", "automationPaused", "startedAt", "lastMessageAt", "updatedAt")
     VALUES ('c-ingrid', 'ws1', 'k-ingrid', 'l1', true, $1, $1, $1)`,
    [new Date(haceUnDia.getTime() - 3_600_000)],
  );
  await pg.query(
    `INSERT INTO "Message" ("id", "workspaceId", "conversationId", "contactId", "channelId", "direction", "type", "content", "rawPayload", "createdAt", "updatedAt")
     VALUES ('m-ingrid', 'ws1', 'c-ingrid', 'k-ingrid', 'l1', 'OUTBOUND', 'TEXT', 'hola', '{"source":"manual"}'::jsonb, $1, $1)`,
    [haceUnDia],
  );
  assert.equal(await chat.hayPersonaEnElChat("c-ingrid", base), true);
});

await prueba("aviso de pausa: hayPersonaEnElChat es no si ninguna persona escribió (el aviso sí sale)", async () => {
  await crearChat("c-sin-persona", { pausado: true });
  await crearMensaje("c-sin-persona", { fuente: "agente-v3" });
  await crearMensaje("c-sin-persona", { fuente: "webhook", direccion: "INBOUND" });
  assert.equal(await chat.hayPersonaEnElChat("c-sin-persona", base), false);
});

/**
 * El reloj del V3 con todo de mentira: una línea, un chat callado y una regla vencida. El cargador
 * guarda el módulo en caché, así que se carga una vez y cada prueba cambia `relojV3.deLaAsesora`.
 */
const relojV3 = { deLaAsesora: true, envios: [], frenos: [], estados: [] };
function relojDelV3(deLaAsesora) {
  relojV3.deLaAsesora = deLaAsesora;
  relojV3.envios.length = 0;
  relojV3.frenos.length = 0;
  relojV3.estados.length = 0;
  const { envios: enviosDelReloj, frenos, estados } = relojV3;
  const regla = { id: "r15", nombre: "15 min", activa: true, cuando: { tipo: "sin_respuesta", minutos: 15 }, entonces: [{ tipo: "mensaje", texto: "¿Pudiste ver las fotos?" }] };
  const reloj = cargar(`src/features/agente-v3/servicios/seguimientos.ts`, {
    "@/lib/prisma": {
      prisma: {
        whatsAppChannel: { findMany: async () => [{ id: "l1", workspaceId: "ws1", evolutionInstanceName: "inst" }] },
        conversation: {
          findMany: async () => [{ id: "c-v3", lastMessageAt: new Date(Date.now() - 20 * 60_000), contactId: "k-v3", contact: { phoneNumber: "573000000000" } }],
        },
        message: {
          findFirst: async () => ({ direction: "OUTBOUND", createdAt: new Date(Date.now() - 20 * 60_000) }),
          create: async () => ({}),
          upsert: async () => ({}),
        },
      },
    },
    "@/lib/chat-de-la-asesora": { esChatDeLaAsesora: async () => relojV3.deLaAsesora },
    "@/lib/evolution": {
      sendEvolutionTextMessageWithReconnect: async (input) => {
        relojV3.envios.push(input);
        return { externalId: "" };
      },
    },
    "@/lib/chat-resuelto-sql": { WHERE_CHAT_ABIERTO: {} },
    "@/lib/anti-bloqueo/reglas": { dentroDelHorario: () => true, inicioDeVentanaHabil: () => new Date(0) },
    "@/lib/anti-bloqueo/servicio": {
      anotarFrenado: (input) => relojV3.frenos.push(input.motivo),
      leerConfigAntiBloqueo: async () => ({ horario: { activo: false } }),
      marcarEnvioAutomatico: async () => {},
      revisarAntiBloqueo: async () => ({ enviar: true }),
    },
    "@/lib/freno-de-automaticos": { revisarFrenoDeAutomatico: async () => ({ enviar: true }) },
    "@/features/seguimientos/services/follows": { apagarSiCorresponde: async () => false },
    "@/features/seguimiento-inteligente/servicios/convivencia": { revisarConvivencia: async () => null },
    "@/lib/reglas-de-redaccion": { limpiarFrasesProhibidas: (texto) => texto },
    "@/features/seguimientos/services/seguimiento-que-escucha": {
      marcaDelSeguimiento: () => ({ seguimientoQueEscucha: true }),
      MOTIVO_PROMESA_DE_ENVIO: "promesa_de_envio",
      redactarSeguimientoQueEscucha: async () => ({ enviar: true, texto: "Hola, ¿pudiste ver las fotos del tocador?", deIA: true, textoReemplazado: null, motivo: "" }),
    },
    "@/features/seguimientos/dominio/seguimiento-que-escucha": { revisarAntesDeEnviar: () => [] },
    "@/features/seguimientos/services/sin-respuesta-a-la-bienvenida": { elClienteRespondioLaBienvenida: async () => true },
    "@/features/embudo/servicios/eventos": { registrarSeguimientoEnviado: () => {} },
    "../motor/decidir": { cumpleLasCondiciones: () => true },
    "../motor/estado": {
      elV3AtendioLaCharla: async () => true,
      leerEstado: async () => ({ seguimientosEnviados: [], pasoActual: "presentacion" }),
      guardarEstado: async (id, estado) => relojV3.estados.push(estado.seguimientosEnviados),
    },
    "./almacen": { leerLibro: async () => ({ reglas: [regla] }) },
  });
  return { reloj, enviosDelReloj, frenos, estados };
}

await prueba("recordatorio del V3 en el chat de la asesora: la IA redacta, pero no sale; queda chat_de_la_asesora y se da por visto", async () => {
  const { reloj, enviosDelReloj, frenos, estados } = relojDelV3(true);
  const resultado = await reloj.ejecutarSeguimientosV3();
  assert.equal(enviosDelReloj.length, 0, "no debía llamar al envío");
  assert.deepEqual(frenos, ["chat_de_la_asesora"]);
  assert.equal(resultado.enviados, 0);
  assert.equal(resultado.frenados, 1);
  assert.deepEqual(estados, [[15]], "se da por visto: no se le vuelve a pedir a la IA cada minuto");
});

await prueba("recordatorio del V3 en un chat libre: sale como siempre (el freno no lo toca)", async () => {
  const { reloj, enviosDelReloj, frenos } = relojDelV3(false);
  const resultado = await reloj.ejecutarSeguimientosV3();
  assert.equal(enviosDelReloj.length, 1);
  assert.deepEqual(frenos, []);
  assert.equal(resultado.enviados, 1);
});

/* ---- 5. Sin envíos nuevos en el archivo nuevo ---- */
await prueba("chat-de-la-asesora.ts solo lee: no nombra sendMessage ni enviarMensaje", async () => {
  const fuente = fs.readFileSync(path.join(RAIZ, "src/lib/chat-de-la-asesora.ts"), "utf8");
  assert.doesNotMatch(fuente, /sendMessage|enviarMensaje/);
});

assert.ok(Prisma.sql, "Prisma.sql disponible");
await pg.close();
console.log(`\n${pruebas} pruebas del chat de la asesora: todas bien`);
