/**
 * Prueba la regla "Sin responder" en las DOS fuentes de la bandeja, con chats armados a mano:
 * - WhatsApp normal (tabla Message): sqlIdsSinResponder.
 * - Linea oficial (tabla OfficialApiMessage): sqlOficialQuedoSinResponder.
 * Los dos constructores viven en src/lib/ultimo-mensaje-de-chats.ts.
 *
 * Corre en un Postgres embebido (PGlite), sin tocar ninguna base real:
 *   node scripts/check-sin-responder.mjs
 *
 * Sale con codigo 1 si algun caso da distinto de lo esperado.
 */
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { Prisma } from "@prisma/client";

import { sqlIdsSinResponder, sqlOficialQuedoSinResponder } from "../src/lib/ultimo-mensaje-de-chats.ts";

const DIAS = 60;
const WS = "ws_magilus";

const db = new PGlite();
await db.exec(`
  CREATE TABLE "Message" (
    "id" text PRIMARY KEY,
    "workspaceId" text NOT NULL,
    "conversationId" text NOT NULL,
    "channelId" text,
    "direction" text NOT NULL,
    "type" text NOT NULL,
    "status" text NOT NULL,
    "rawPayload" jsonb,
    "isStatusBroadcast" boolean NOT NULL DEFAULT false,
    "createdAt" timestamp(3) NOT NULL
  );
  CREATE TABLE "OfficialApiConversation" ("id" text PRIMARY KEY);
  CREATE TABLE "OfficialApiMessage" (
    "id" text PRIMARY KEY,
    "conversationId" text NOT NULL,
    "direction" text NOT NULL,
    "type" text NOT NULL,
    "status" text NOT NULL,
    "rawPayload" jsonb,
    "createdAt" timestamp(3) NOT NULL
  );
`);

/*
  Cada caso: el nombre, los mensajes en orden (hace cuantos minutos) y si debe quedar sin responder.
  Se corren iguales en las dos tablas.
*/
const MIN = 1;
const DIA = 24 * 60;
const entrante = (haceMin, extra = {}) => ({ direction: "INBOUND", type: "TEXT", status: "RECEIVED", haceMin, ...extra });
const saliente = (haceMin, extra = {}) => ({ direction: "OUTBOUND", type: "TEXT", status: "SENT", haceMin, ...extra });

const CASOS = [
  { id: "solo_cliente", esperado: true, mensajes: [entrante(10 * MIN)] },
  { id: "respondio_asesora", esperado: false, mensajes: [entrante(10 * MIN), saliente(5 * MIN, { status: "READ" })] },
  {
    id: "respondio_bot",
    esperado: false,
    mensajes: [entrante(10 * MIN), saliente(9 * MIN, { status: "DELIVERED", rawPayload: { source: "bot" } })],
  },
  {
    id: "seguimiento_plantilla",
    esperado: false,
    mensajes: [entrante(10 * MIN), saliente(2 * MIN, { type: "TEMPLATE", rawPayload: { source: "seguimiento" } })],
  },
  {
    id: "nota_interna_no_responde",
    esperado: true,
    mensajes: [entrante(10 * MIN), saliente(5 * MIN, { type: "SYSTEM", rawPayload: { source: "nota" } })],
  },
  {
    id: "actividad_no_responde",
    esperado: true,
    mensajes: [entrante(10 * MIN), saliente(5 * MIN, { type: "SYSTEM", rawPayload: { source: "activity" } })],
  },
  {
    id: "llamada_saliente_no_responde",
    esperado: true,
    mensajes: [entrante(10 * MIN), saliente(5 * MIN, { type: "SYSTEM", rawPayload: { source: "llamada" } })],
  },
  {
    // Una llamada del cliente despues de la respuesta no vuelve a poner la marca.
    id: "llamada_entrante_no_marca",
    esperado: false,
    mensajes: [
      entrante(30 * MIN),
      saliente(20 * MIN),
      entrante(5 * MIN, { type: "SYSTEM", rawPayload: { source: "llamada" } }),
    ],
  },
  {
    id: "saliente_fallida_no_responde",
    esperado: true,
    mensajes: [entrante(10 * MIN), saliente(5 * MIN, { status: "FAILED" })],
  },
  {
    id: "cliente_vuelve_a_escribir",
    esperado: true,
    mensajes: [entrante(30 * MIN), saliente(20 * MIN), entrante(3 * MIN), entrante(1 * MIN)],
  },
  { id: "cliente_hace_61_dias", esperado: false, mensajes: [entrante(61 * DIA)] },
  {
    id: "cliente_hace_59_dias",
    esperado: true,
    mensajes: [saliente(70 * DIA), entrante(59 * DIA)],
  },
  { id: "solo_saliente", esperado: false, mensajes: [saliente(5 * MIN)] },
  { id: "solo_nota", esperado: false, mensajes: [saliente(5 * MIN, { type: "SYSTEM" })] },
];

let n = 0;
for (const caso of CASOS) {
  await db.query(`INSERT INTO "OfficialApiConversation" VALUES ($1)`, [caso.id]);
  for (const m of caso.mensajes) {
    n += 1;
    const fecha = `now() - make_interval(mins => ${m.haceMin})`;
    const payload = m.rawPayload ? JSON.stringify(m.rawPayload) : null;
    await db.query(
      `INSERT INTO "Message" VALUES ($1, $2, $3, 'linea_1', $4, $5, $6, $7, false, ${fecha})`,
      [`m${n}`, WS, caso.id, m.direction, m.type, m.status, payload],
    );
    await db.query(
      `INSERT INTO "OfficialApiMessage" VALUES ($1, $2, $3, $4, $5, $6, ${fecha})`,
      [`o${n}`, caso.id, m.direction, m.type, m.status, payload],
    );
  }
}
// Ruido que no debe entrar: otro workspace, un estado de WhatsApp y otra linea.
await db.query(`INSERT INTO "Message" VALUES ('x1', 'otro_ws', 'ajeno', 'linea_1', 'INBOUND', 'TEXT', 'RECEIVED', null, false, now())`);
await db.query(`INSERT INTO "Message" VALUES ('x2', $1, 'estado', 'linea_1', 'INBOUND', 'TEXT', 'RECEIVED', null, true, now())`, [WS]);
await db.query(`INSERT INTO "Message" VALUES ('x3', $1, 'otra_linea', 'linea_2', 'INBOUND', 'TEXT', 'RECEIVED', null, false, now())`, [WS]);

const correr = async (sql) => (await db.query(sql.text, sql.values)).rows;
const esperados = CASOS.filter((c) => c.esperado).map((c) => c.id).sort();

let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

await prueba("Message: la regla en la linea elegida", async () => {
  const filas = await correr(sqlIdsSinResponder({ workspaceId: WS, canales: ["linea_1"], dias: DIAS }));
  assert.deepEqual(filas.map((f) => f.conversationId).sort(), esperados);
});

await prueba("Message: todas las lineas suma la otra linea y deja fuera estados y otro workspace", async () => {
  const filas = await correr(sqlIdsSinResponder({ workspaceId: WS, canales: null, dias: DIAS }));
  assert.deepEqual(filas.map((f) => f.conversationId).sort(), [...esperados, "otra_linea"].sort());
});

await prueba("Message: sin lineas visibles no sale nada", async () => {
  assert.deepEqual(await correr(sqlIdsSinResponder({ workspaceId: WS, canales: [], dias: DIAS })), []);
});

await prueba("Message: no abre el rawPayload", async () => {
  assert.ok(!sqlIdsSinResponder({ workspaceId: WS, canales: null, dias: DIAS }).text.includes("rawPayload"));
});

const fragmento = sqlOficialQuedoSinResponder(DIAS);
const consultaOficial = (condicion) => Prisma.sql`
  SELECT c."id" AS "id" FROM "OfficialApiConversation" c WHERE ${condicion} ORDER BY c."id"
`;

await prueba("OfficialApiMessage: la regla con \"Sin responder: sí\"", async () => {
  const filas = await correr(consultaOficial(fragmento));
  assert.deepEqual(filas.map((f) => f.id).sort(), esperados);
});

await prueba("OfficialApiMessage: \"Sin responder: no\" es exactamente el resto", async () => {
  const filas = await correr(consultaOficial(Prisma.sql`NOT COALESCE(${fragmento}, false)`));
  const resto = CASOS.filter((c) => !c.esperado).map((c) => c.id).sort();
  assert.deepEqual(filas.map((f) => f.id).sort(), resto);
});

await prueba("OfficialApiMessage: no abre el rawPayload", async () => {
  assert.ok(!fragmento.text.includes("rawPayload"));
});

await db.close();
console.log(`OK: ${pruebas} pruebas de "Sin responder" (${CASOS.length} chats en cada tabla).`);
