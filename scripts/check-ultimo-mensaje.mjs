/**
 * Compara la vista previa de la bandeja VIEJA (DISTINCT ON + barrido de rawPayload) con la NUEVA
 * (LATERAL ... LIMIT 1 por chat, src/lib/ultimo-mensaje-de-chats.ts) sobre datos simulados.
 *
 * Corre en un Postgres embebido (PGlite), sin tocar ninguna base real:
 *   node scripts/check-ultimo-mensaje.mjs
 *
 * Sale con codigo 1 si alguna fila difiere.
 */
import { PGlite } from "@electric-sql/pglite";
import { Prisma } from "@prisma/client";

import { sqlPayloadDeMensajes, sqlUltimoMensajeDeChats } from "../src/lib/ultimo-mensaje-de-chats.ts";

// Generador con semilla: la prueba da siempre lo mismo.
let semilla = 20261007;
function azar() {
  semilla = (semilla * 1103515245 + 12345) % 2147483648;
  return semilla / 2147483648;
}
const elegir = (lista) => lista[Math.floor(azar() * lista.length)];

const db = new PGlite();
await db.exec(`
  CREATE TABLE "Message" (
    "id" text PRIMARY KEY,
    "workspaceId" text NOT NULL,
    "conversationId" text NOT NULL,
    "direction" text NOT NULL,
    "type" text NOT NULL,
    "status" text NOT NULL,
    "content" text,
    "deletedAt" timestamp(3),
    "rawPayload" jsonb,
    "isStatusBroadcast" boolean NOT NULL DEFAULT false,
    "createdAt" timestamp(3) NOT NULL
  );
  CREATE INDEX "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt");
`);

const WS = "ws_magilus";
const conversaciones = Array.from({ length: 80 }, (_, i) => `conv_${String(i).padStart(3, "0")}`);
const filas = [];
let n = 0;
for (const conversationId of conversaciones) {
  const cuantos = Math.floor(azar() * 60); // algunos chats quedan sin mensajes
  for (let i = 0; i < cuantos; i += 1) {
    n += 1;
    // Pocas fechas posibles: fuerza empates de createdAt para probar el desempate por id.
    const minuto = Math.floor(azar() * 25);
    filas.push({
      id: `m${String(Math.floor(azar() * 1e9)).padStart(9, "0")}_${n}`,
      workspaceId: azar() < 0.05 ? "otro_ws" : WS,
      conversationId,
      direction: elegir(["INBOUND", "OUTBOUND"]),
      type: elegir(["TEXT", "TEXT", "TEXT", "IMAGE", "AUDIO", "SYSTEM", "SYSTEM", "CONTACTS"]),
      status: elegir(["RECEIVED", "SENT", "DELIVERED", "READ"]),
      content: elegir(["hola", "precio?", "", "  ", null, "envio a Cali"]),
      deletedAt: azar() < 0.05 ? "2026-10-01 10:00:00" : null,
      rawPayload: elegir([
        null,
        { source: "activity" },
        { source: "activity" },
        { source: "llamada" },
        { source: "waha", pushName: "Cliente" },
        { message: { conversation: "texto en payload" }, pushName: "Ana" },
        { otro: 1 },
      ]),
      isStatusBroadcast: azar() < 0.05,
      createdAt: `2026-10-07 08:${String(minuto).padStart(2, "0")}:00`,
    });
  }
}
for (const f of filas) {
  await db.query(
    `INSERT INTO "Message" VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [f.id, f.workspaceId, f.conversationId, f.direction, f.type, f.status, f.content, f.deletedAt,
      f.rawPayload === null ? null : JSON.stringify(f.rawPayload), f.isStatusBroadcast, f.createdAt],
  );
}

// Las consultas VIEJAS, copiadas tal cual de list/route.ts y cliente/chats/page.tsx (a0c749a5).
function sqlViejaVistaPrevia(ids, conFiltroDeSistema) {
  return Prisma.sql`
    SELECT DISTINCT ON (m."conversationId")
      m."conversationId" AS "conversationId",
      m."content" AS "content",
      m."direction" AS "direction",
      m."createdAt" AS "createdAt",
      m."deletedAt" AS "deletedAt",
      m."type" AS "type",
      m."status" AS "status"
    FROM "Message" m
    WHERE m."workspaceId" = ${WS}
      AND m."conversationId" IN (${Prisma.join(ids)})
      AND m."isStatusBroadcast" = false
      AND (m."rawPayload"->>'source') IS DISTINCT FROM 'activity'
      ${conFiltroDeSistema ? Prisma.sql`AND (m."type" IS DISTINCT FROM 'SYSTEM' OR (m."rawPayload"->>'source') = 'llamada')` : Prisma.empty}
    ORDER BY m."conversationId", m."createdAt" DESC, m."id" DESC
  `;
}
function sqlViejoPayload(ids, conFiltroDeSistema) {
  return Prisma.sql`
    SELECT DISTINCT ON (m."conversationId")
      m."conversationId" AS "conversationId",
      m."rawPayload" AS "rawPayload"
    FROM "Message" m
    WHERE m."workspaceId" = ${WS}
      AND m."conversationId" IN (${Prisma.join(ids)})
      AND m."isStatusBroadcast" = false
      AND (m."rawPayload"->>'source') IS DISTINCT FROM 'activity'
      ${conFiltroDeSistema ? Prisma.sql`AND (m."type" IS DISTINCT FROM 'SYSTEM' OR (m."rawPayload"->>'source') = 'llamada')` : Prisma.empty}
    ORDER BY m."conversationId", m."createdAt" DESC, m."id" DESC
  `;
}

const correr = async (sql) => (await db.query(sql.text, sql.values)).rows;
const ordenar = (rows) => [...rows].sort((a, b) => (a.conversationId < b.conversationId ? -1 : 1));

let fallas = 0;
for (const conFiltro of [true, false]) {
  for (const ids of [conversaciones, conversaciones.slice(0, 40), conversaciones.slice(40, 43), [conversaciones[5]]]) {
    const vieja = await correr(sqlViejaVistaPrevia(ids, conFiltro));
    const nuevaConId = await correr(
      sqlUltimoMensajeDeChats({ workspaceId: WS, conversationIds: ids, ocultarSistemaSalvoLlamadas: conFiltro }),
    );
    const nueva = nuevaConId.map((fila) => {
      const resto = { ...fila };
      delete resto.messageId;
      return resto;
    });
    if (JSON.stringify(vieja) !== JSON.stringify(nueva)) {
      fallas += 1;
      console.error(`DIFIERE vista previa (filtro=${conFiltro}, ${ids.length} chats)`);
    }

    // Respaldo con rawPayload: viejo (otro barrido) vs nuevo (por id del mensaje elegido).
    const payloadViejo = ordenar(await correr(sqlViejoPayload(ids, conFiltro)));
    const payloadNuevo = nuevaConId.length
      ? ordenar(await correr(sqlPayloadDeMensajes({ workspaceId: WS, messageIds: nuevaConId.map((f) => f.messageId) })))
      : [];
    if (JSON.stringify(payloadViejo) !== JSON.stringify(payloadNuevo)) {
      fallas += 1;
      console.error(`DIFIERE payload (filtro=${conFiltro}, ${ids.length} chats)`);
    }
    console.log(`ok? filtro=${conFiltro} chats=${ids.length} filas=${vieja.length} iguales=${fallas === 0}`);
  }
}

// El plan nuevo: debe usar el indice (conversationId, createdAt) con LIMIT por chat.
const plan = await db.query(
  `EXPLAIN ${sqlUltimoMensajeDeChats({ workspaceId: WS, conversationIds: conversaciones.slice(0, 40), ocultarSistemaSalvoLlamadas: true }).text}`,
  sqlUltimoMensajeDeChats({ workspaceId: WS, conversationIds: conversaciones.slice(0, 40), ocultarSistemaSalvoLlamadas: true }).values,
);
console.log(`mensajes simulados: ${filas.length}`);
console.log(plan.rows.map((r) => r["QUERY PLAN"]).join("\n"));

await db.close();
if (fallas > 0) {
  console.error(`FALLO: ${fallas} diferencias`);
  process.exit(1);
}
console.log("OK: la consulta nueva devuelve exactamente lo mismo que la vieja.");
