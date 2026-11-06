/**
 * Prueba la regla "Sin responder" en las DOS fuentes de la bandeja, con chats armados a mano:
 * - WhatsApp normal (tabla Message): sqlIdsSinResponder.
 * - Linea oficial (tabla OfficialApiMessage): sqlOficialQuedoSinResponder.
 * Y la fecha "sin responder desde" de cada fila de la lista, que tiene que ir de la mano del filtro:
 * - WhatsApp normal: la columna `sinResponderDesde` de sqlUltimoMensajeDeChats (y el resumen de
 *   un chat, sqlSinResponderDesdeDeChat).
 * - Linea oficial: sqlOficialSinResponderDesde.
 * Todos viven en src/lib/ultimo-mensaje-de-chats.ts.
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
  sqlSinResponderDesdeDeChat,
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
  En los que quedan sin responder, el mensaje marcado con `desde: true` es desde donde cuenta el
  reloj: el PRIMERO del cliente despues de la ultima respuesta valida.
  Se corren iguales en las dos tablas.
*/
const MIN = 1;
const DIA = 24 * 60;
const entrante = (haceMin, extra = {}) => ({ direction: "INBOUND", type: "TEXT", status: "RECEIVED", haceMin, ...extra });
const saliente = (haceMin, extra = {}) => ({ direction: "OUTBOUND", type: "TEXT", status: "SENT", haceMin, ...extra });

const CASOS = [
  { id: "solo_cliente", esperado: true, mensajes: [entrante(10 * MIN, { desde: true })] },
  {
    // Dos mensajes del cliente sin respuesta: el reloj cuenta desde el primero.
    id: "dos_del_cliente",
    esperado: true,
    mensajes: [entrante(12 * MIN, { desde: true }), entrante(4 * MIN)],
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
    mensajes: [entrante(10 * MIN, { desde: true }), saliente(5 * MIN, { status: "FAILED" })],
  },
  {
    // El envio FAILED no corta el reloj: sigue contando desde el primero del cliente.
    id: "fallida_y_cliente_insiste",
    esperado: true,
    mensajes: [
      entrante(40 * MIN),
      saliente(30 * MIN),
      entrante(10 * MIN, { desde: true }),
      saliente(5 * MIN, { status: "FAILED" }),
      entrante(1 * MIN),
    ],
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

// Cada caso sin responder tiene que marcar exactamente un mensaje como `desde`.
for (const caso of CASOS) {
  const marcados = caso.mensajes.filter((m) => m.desde).length;
  assert.equal(marcados, caso.esperado ? 1 : 0, `caso ${caso.id}: mensajes marcados como desde`);
}

let n = 0;
// conversacion -> id del mensaje desde donde cuenta el reloj (en cada tabla).
const desdeMessage = new Map();
const desdeOficial = new Map();
for (const caso of CASOS) {
  await db.query(`INSERT INTO "OfficialApiConversation" VALUES ($1)`, [caso.id]);
  for (const m of caso.mensajes) {
    n += 1;
    if (m.desde) {
      desdeMessage.set(caso.id, `m${n}`);
      desdeOficial.set(caso.id, `o${n}`);
    }
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

/* ---------- "Sin responder desde": la fecha de cada fila, de la mano del filtro ---------- */

const fechaDe = async (tabla, id) =>
  (await db.query(`SELECT "createdAt" FROM "${tabla}" WHERE "id" = $1`, [id])).rows[0].createdAt.getTime();
const todasLasConversaciones = [...CASOS.map((c) => c.id), "ajeno", "estado", "otra_linea"];
const filasDeLista = async (ocultarSistemaSalvoLlamadas) =>
  correr(
    sqlUltimoMensajeDeChats({
      workspaceId: WS,
      conversationIds: todasLasConversaciones,
      ocultarSistemaSalvoLlamadas,
      diasSinResponder: DIAS,
    }),
  );

await prueba("Message: sinResponderDesde no es null exactamente en los chats del filtro", async () => {
  const filas = await filasDeLista(true);
  const conFecha = filas.filter((f) => f.sinResponderDesde !== null).map((f) => f.conversationId).sort();
  const delFiltro = (await correr(sqlIdsSinResponder({ workspaceId: WS, canales: null, dias: DIAS })))
    .map((f) => f.conversationId)
    .sort();
  assert.deepEqual(conFecha, delFiltro);
  assert.ok(conFecha.includes("saliente_fallida_no_responde") && conFecha.includes("fallida_y_cliente_insiste"));
});

await prueba("Message: el reloj cuenta desde el primero del cliente sin respuesta", async () => {
  const filas = await filasDeLista(true);
  for (const caso of CASOS.filter((c) => c.esperado)) {
    const fila = filas.find((f) => f.conversationId === caso.id);
    assert.ok(fila?.sinResponderDesde, `caso ${caso.id}: sin fecha`);
    assert.equal(fila.sinResponderDesde.getTime(), await fechaDe("Message", desdeMessage.get(caso.id)), `caso ${caso.id}`);
  }
});

await prueba("Message: la columna no depende de ocultarSistemaSalvoLlamadas y no quita filas", async () => {
  const conFiltro = await filasDeLista(true);
  const sinFiltro = await filasDeLista(false);
  // Sin el filtro de sistema, cada conversacion del workspace con algun mensaje tiene su fila.
  assert.equal(sinFiltro.length, CASOS.length + 1);
  // Con el filtro, un chat con solo notas no tiene vista previa (ya era asi, no lo cambia la
  // columna); en los demas la fecha es la misma.
  const fechaSinFiltro = new Map(sinFiltro.map((f) => [f.conversationId, f.sinResponderDesde?.getTime() ?? null]));
  assert.deepEqual(
    conFiltro.map((f) => f.conversationId),
    sinFiltro.map((f) => f.conversationId).filter((id) => id !== "solo_nota"),
  );
  for (const fila of conFiltro) {
    assert.equal(fila.sinResponderDesde?.getTime() ?? null, fechaSinFiltro.get(fila.conversationId), fila.conversationId);
  }
});

await prueba("Message: el resumen de un chat da la misma fecha que la lista", async () => {
  // Sin el filtro de sistema: asi estan todos los chats (tambien el que solo tiene notas).
  const filas = await filasDeLista(false);
  for (const caso of CASOS) {
    const [resumen] = await correr(sqlSinResponderDesdeDeChat({ workspaceId: WS, conversationId: caso.id, dias: DIAS }));
    const fila = filas.find((f) => f.conversationId === caso.id);
    assert.equal(resumen.sinResponderDesde?.getTime() ?? null, fila.sinResponderDesde?.getTime() ?? null, `caso ${caso.id}`);
  }
  // Otro workspace: no ve el chat ajeno.
  const [ajeno] = await correr(sqlSinResponderDesdeDeChat({ workspaceId: WS, conversationId: "ajeno", dias: DIAS }));
  assert.equal(ajeno.sinResponderDesde, null);
});

await prueba("Message: sinResponderDesde no abre el rawPayload", async () => {
  assert.ok(!sqlSinResponderDesdeDeChat({ workspaceId: WS, conversationId: "x", dias: DIAS }).text.includes("rawPayload"));
});

const desdeOficialSql = sqlOficialSinResponderDesde(DIAS);
const filasOficiales = async () =>
  correr(Prisma.sql`
    SELECT c."id" AS "id", ${desdeOficialSql} AS "sinResponderDesde"
    FROM "OfficialApiConversation" c
    ORDER BY c."id"
  `);

await prueba("OfficialApiMessage: sinResponderDesde no es null exactamente en los chats del filtro", async () => {
  const filas = await filasOficiales();
  assert.equal(filas.length, CASOS.length);
  const conFecha = filas.filter((f) => f.sinResponderDesde !== null).map((f) => f.id).sort();
  const delFiltro = (await correr(consultaOficial(fragmento))).map((f) => f.id).sort();
  assert.deepEqual(conFecha, delFiltro);
  assert.ok(conFecha.includes("saliente_fallida_no_responde") && conFecha.includes("fallida_y_cliente_insiste"));
});

await prueba("OfficialApiMessage: el reloj cuenta desde el primero del cliente sin respuesta", async () => {
  const filas = await filasOficiales();
  for (const caso of CASOS.filter((c) => c.esperado)) {
    const fila = filas.find((f) => f.id === caso.id);
    assert.ok(fila?.sinResponderDesde, `caso ${caso.id}: sin fecha`);
    assert.equal(
      fila.sinResponderDesde.getTime(),
      await fechaDe("OfficialApiMessage", desdeOficial.get(caso.id)),
      `caso ${caso.id}`,
    );
  }
});

await prueba("OfficialApiMessage: sinResponderDesde no abre el rawPayload", async () => {
  assert.ok(!desdeOficialSql.text.includes("rawPayload"));
});

await db.close();
console.log(`OK: ${pruebas} pruebas de "Sin responder" (${CASOS.length} chats en cada tabla).`);
