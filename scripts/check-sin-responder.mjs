/**
 * Prueba la regla "Sin responder" en las DOS fuentes de la bandeja, con chats armados a mano:
 * - WhatsApp normal (tabla Message): sqlIdsSinResponder.
 * - Linea oficial (tabla OfficialApiMessage): sqlOficialQuedoSinResponder.
 * Y el dato `sinResponderDesde` de cada fila (sqlUltimoMensajeDeChats, sqlSinResponderDesdeDeChats
 * y sqlOficialSinResponderDesde): no es null EXACTAMENTE en los chats que devuelve el filtro, y el
 * reloj cuenta desde el PRIMER mensaje del cliente sin respuesta.
 * Todos los constructores viven en src/lib/ultimo-mensaje-de-chats.ts.
 *
 * Corre en un Postgres embebido (PGlite), sin tocar ninguna base real:
 *   node scripts/check-sin-responder.mjs
 *
 * Sale con codigo 1 si algun caso da distinto de lo esperado.
 */
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { Prisma } from "@prisma/client";

import {
  sqlIdsSinResponder,
  sqlOficialQuedoSinResponder,
  sqlOficialSinResponderDesde,
  sqlSinResponderDesdeDeChats,
  sqlUltimoMensajeDeChats,
} from "../src/lib/ultimo-mensaje-de-chats.ts";

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
    "createdAt" timestamp(3) NOT NULL,
    -- Solo para la vista previa de sqlUltimoMensajeDeChats (van al final: los INSERT no las nombran).
    "content" text,
    "deletedAt" timestamp(3)
  );
  CREATE INDEX "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt");
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
  En los que quedan sin responder, `{ desde: true }` marca el mensaje desde el que corre el reloj.
  Se corren iguales en las dos tablas.
*/
const MIN = 1;
const DIA = 24 * 60;
const entrante = (haceMin, extra = {}) => ({ direction: "INBOUND", type: "TEXT", status: "RECEIVED", haceMin, ...extra });
const saliente = (haceMin, extra = {}) => ({ direction: "OUTBOUND", type: "TEXT", status: "SENT", haceMin, ...extra });

const CASOS = [
  { id: "solo_cliente", esperado: true, mensajes: [entrante(10 * MIN, { desde: true })] },
  {
    // Dos mensajes del cliente sin respuesta: el reloj cuenta desde el PRIMERO.
    id: "dos_del_cliente",
    esperado: true,
    mensajes: [saliente(60 * MIN), entrante(20 * MIN, { desde: true }), entrante(8 * MIN)],
  },
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
    mensajes: [entrante(10 * MIN, { desde: true }), saliente(5 * MIN, { type: "SYSTEM", rawPayload: { source: "nota" } })],
  },
  {
    id: "actividad_no_responde",
    esperado: true,
    mensajes: [entrante(10 * MIN, { desde: true }), saliente(5 * MIN, { type: "SYSTEM", rawPayload: { source: "activity" } })],
  },
  {
    id: "llamada_saliente_no_responde",
    esperado: true,
    mensajes: [entrante(10 * MIN, { desde: true }), saliente(5 * MIN, { type: "SYSTEM", rawPayload: { source: "llamada" } })],
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
    // El envio FAILED no cuenta: el reloj sigue desde el mensaje del cliente.
    mensajes: [entrante(10 * MIN, { desde: true }), saliente(5 * MIN, { status: "FAILED" })],
  },
  {
    id: "cliente_vuelve_a_escribir",
    esperado: true,
    mensajes: [entrante(30 * MIN), saliente(20 * MIN), entrante(3 * MIN, { desde: true }), entrante(1 * MIN)],
  },
  { id: "cliente_hace_61_dias", esperado: false, mensajes: [entrante(61 * DIA)] },
  {
    id: "cliente_hace_59_dias",
    esperado: true,
    mensajes: [saliente(70 * DIA), entrante(59 * DIA, { desde: true })],
  },
  { id: "solo_saliente", esperado: false, mensajes: [saliente(5 * MIN)] },
  { id: "solo_nota", esperado: false, mensajes: [saliente(5 * MIN, { type: "SYSTEM" })] },
];

let n = 0;
// conversationId -> [id en Message, id en OfficialApiMessage] del mensaje desde el que corre el reloj.
const idsDelDesde = new Map();
for (const caso of CASOS) {
  await db.query(`INSERT INTO "OfficialApiConversation" VALUES ($1)`, [caso.id]);
  for (const m of caso.mensajes) {
    n += 1;
    if (m.desde) idsDelDesde.set(caso.id, [`m${n}`, `o${n}`]);
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

/* ---- `sinResponderDesde` de cada fila ---- */

for (const caso of CASOS) {
  assert.equal(idsDelDesde.has(caso.id), caso.esperado, `caso ${caso.id}: marca { desde: true } solo si queda sin responder`);
}
const idsDeCasos = CASOS.map((c) => c.id);
const fechaDe = async (tabla, id) =>
  (await db.query(`SELECT "createdAt" FROM "${tabla}" WHERE "id" = $1`, [id])).rows[0].createdAt.getTime();

/** Compara las filas { conversationId, sinResponderDesde } con lo esperado de cada caso. */
async function comprobarDesde(filas, tabla) {
  const porChat = new Map(filas.map((f) => [f.conversationId, f.sinResponderDesde]));
  const conDato = filas.filter((f) => f.sinResponderDesde !== null).map((f) => f.conversationId).sort();
  assert.deepEqual(conDato, esperados, "no es null exactamente en los chats que devuelve el filtro");
  for (const caso of CASOS.filter((c) => c.esperado)) {
    const [idMessage, idOficial] = idsDelDesde.get(caso.id);
    const esperada = await fechaDe(tabla, tabla === "Message" ? idMessage : idOficial);
    assert.equal(porChat.get(caso.id).getTime(), esperada, `caso ${caso.id}: el reloj cuenta desde el primero`);
  }
}

const idsDelFiltroMessage = (await correr(sqlIdsSinResponder({ workspaceId: WS, canales: ["linea_1"], dias: DIAS })))
  .map((f) => f.conversationId)
  .sort();

for (const ocultar of [true, false]) {
  await prueba(`Message: sinResponderDesde de la lista (ocultarSistemaSalvoLlamadas=${ocultar})`, async () => {
    const sql = sqlUltimoMensajeDeChats({
      workspaceId: WS,
      conversationIds: idsDeCasos,
      ocultarSistemaSalvoLlamadas: ocultar,
      diasSinResponder: DIAS,
    });
    const filas = await correr(sql);
    // La columna nueva no quita filas: sale una por chat con vista previa (con el filtro de
    // sistema, el chat que solo tiene una nota no tiene vista previa, como antes).
    const conVistaPrevia = idsDeCasos.filter((id) => !ocultar || id !== "solo_nota").sort();
    assert.deepEqual(filas.map((f) => f.conversationId), conVistaPrevia);
    await comprobarDesde(filas, "Message");
    assert.deepEqual(
      filas.filter((f) => f.sinResponderDesde !== null).map((f) => f.conversationId).sort(),
      idsDelFiltroMessage,
    );
  });
}

await prueba("Message: sinResponderDesde no depende de ocultarSistemaSalvoLlamadas", async () => {
  const con = await correr(sqlUltimoMensajeDeChats({ workspaceId: WS, conversationIds: idsDeCasos, ocultarSistemaSalvoLlamadas: true, diasSinResponder: DIAS }));
  const sin = await correr(sqlUltimoMensajeDeChats({ workspaceId: WS, conversationIds: idsDeCasos, ocultarSistemaSalvoLlamadas: false, diasSinResponder: DIAS }));
  // Mismo dato en los chats que salen en las dos (con el filtro falta el que solo tiene una nota).
  const enLasDos = new Set(con.map((f) => f.conversationId));
  const soloDesde = (filas) =>
    filas.filter((f) => enLasDos.has(f.conversationId)).map((f) => [f.conversationId, f.sinResponderDesde?.getTime() ?? null]);
  assert.equal(enLasDos.size, CASOS.length - 1);
  assert.deepEqual(soloDesde(con), soloDesde(sin));
});

await prueba("Message: el resumen de una fila (sqlSinResponderDesdeDeChats) da lo mismo", async () => {
  const filas = await correr(sqlSinResponderDesdeDeChats({ workspaceId: WS, conversationIds: idsDeCasos, dias: DIAS }));
  await comprobarDesde(filas, "Message");
  // Otro workspace y los estados de WhatsApp no cuentan; un chat sin mensajes da null.
  const ruido = await correr(sqlSinResponderDesdeDeChats({ workspaceId: WS, conversationIds: ["ajeno", "estado", "vacio"], dias: DIAS }));
  assert.deepEqual(ruido.map((f) => [f.conversationId, f.sinResponderDesde]), [["ajeno", null], ["estado", null], ["vacio", null]]);
});

await prueba("Message: sinResponderDesde no abre el rawPayload", async () => {
  assert.ok(!sqlSinResponderDesdeDeChats({ workspaceId: WS, conversationIds: idsDeCasos, dias: DIAS }).text.includes("rawPayload"));
});

const fragmentoDesde = sqlOficialSinResponderDesde(DIAS);
await prueba("OfficialApiMessage: sinResponderDesde no es null exactamente en los chats del filtro", async () => {
  const filas = await correr(Prisma.sql`
    SELECT c."id" AS "conversationId", ${fragmentoDesde} AS "sinResponderDesde"
    FROM "OfficialApiConversation" c ORDER BY c."id"
  `);
  await comprobarDesde(filas, "OfficialApiMessage");
  const delFiltro = (await correr(consultaOficial(fragmento))).map((f) => f.id).sort();
  assert.deepEqual(filas.filter((f) => f.sinResponderDesde !== null).map((f) => f.conversationId).sort(), delFiltro);
});

await prueba("OfficialApiMessage: igual con otro alias (la consulta con CTE de getOfficialApiChatsData)", async () => {
  const filas = await correr(Prisma.sql`
    WITH filtered_conversations AS (SELECT x."id" FROM "OfficialApiConversation" x)
    SELECT fc."id" AS "conversationId",
      (SELECT ${fragmentoDesde} FROM (SELECT fc."id" AS "id") c) AS "sinResponderDesde"
    FROM filtered_conversations fc ORDER BY fc."id"
  `);
  await comprobarDesde(filas, "OfficialApiMessage");
});

await prueba("OfficialApiMessage: sinResponderDesde no abre el rawPayload", async () => {
  assert.ok(!fragmentoDesde.text.includes("rawPayload"));
});

await db.close();
console.log(`OK: ${pruebas} pruebas de "Sin responder" (${CASOS.length} chats en cada tabla).`);
