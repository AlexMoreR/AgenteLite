/**
 * Chequeos de P6 (el base64 fuera de la base) que no necesitan ninguna base real:
 *
 * 1. Lectura: chat-message-loader.ts ya no pide `rawPayload: true` en el select de mensajes (lo trae
 *    aparte, recortado en SQL) y conserva las consultas en paralelo; ultimo-mensaje-de-chats.ts usa el
 *    `CASE ... #-` y es IDENTICO al de payload-sin-archivos.ts; getMiDiaData.ts recorta la ruta de WAHA.
 * 2. El recorte en SQL corre en un Postgres embebido (PGlite): quita el base64 de las filas pesadas,
 *    deja igual todo lo demas y no toca las filas chicas.
 * 3. La red de prisma.ts esta ANTES del bucle de reintentos y solo para las escrituras de Message.
 * 4. /uploads: exporta GET y HEAD, ya no lee el archivo entero; next.config.ts con minimumCacheTTL y
 *    las reglas de cache por nombre (se prueban con el path-to-regexp de Next).
 *
 *   node scripts/check-payload-sin-archivos.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";

import { sqlPayloadSinArchivos, RUTAS_DE_ARCHIVO_CONOCIDAS } from "../src/lib/payload-sin-archivos.ts";
import { SQL_PAYLOAD_SIN_ARCHIVOS, sqlPayloadDeMensajes } from "../src/lib/ultimo-mensaje-de-chats.ts";

const require = createRequire(import.meta.url);
const leer = (ruta) => fs.readFileSync(ruta, "utf8");

let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

await prueba("cargador: sin rawPayload en el select de mensajes, recortado en SQL, en paralelo como antes", () => {
  const cargador = leer("src/lib/chat-message-loader.ts");
  const findMany = cargador.slice(cargador.indexOf("prisma.message.findMany({"), cargador.indexOf("conPayloadsSinArchivos)"));
  assert.ok(findMany.length > 0, "no encontre el findMany de mensajes");
  assert.doesNotMatch(findMany, /rawPayload:\s*true/);
  assert.match(cargador, /\.then\(conPayloadsSinArchivos\)/);
  assert.match(cargador, /sqlPayloadSinArchivos\('"rawPayload"'\)/);
  assert.match(cargador, /WHERE "id" = ANY\(/);
  assert.match(cargador, /rawPayload: stripHeavyBase64\(message\.rawPayload\)/, "la segunda red sigue");
  // Lo del otro trabajador (check-chat-sin-refresco): paralelo, cursor comprobado, sin channel.metadata.
  assert.match(cargador, /Promise\.all\(\[\s*prisma\.conversation\.findFirst\([\s\S]*?\),\s*messagesPromise,\s*\]\)/);
  assert.match(cargador, /cursorPromise\.then\(\(cursorMessage\) =>/);
  const canal = cargador.match(/channel:\s*\{\s*select:\s*\{([^}]*)\}/);
  assert.doesNotMatch(canal[1], /metadata/);
});

await prueba("ultimo mensaje: el CASE ... #- escrito a mano es identico al de payload-sin-archivos", () => {
  assert.equal(SQL_PAYLOAD_SIN_ARCHIVOS, sqlPayloadSinArchivos('m."rawPayload"'));
  const sql = sqlPayloadDeMensajes({ workspaceId: "ws", messageIds: ["a"] }).text;
  assert.ok(sql.includes(SQL_PAYLOAD_SIN_ARCHIVOS));
  assert.doesNotMatch(sql, /m\."rawPayload" AS "rawPayload"/);
});

await prueba("Mi Dia: recorta tambien la ruta de WAHA {evolution,data,base64}", () => {
  const miDia = leer("src/features/crm/services/getMiDiaData.ts");
  const consulta = miDia.slice(miDia.indexOf("SELECT DISTINCT ON"), miDia.indexOf("ORDER BY m.\"conversationId\""));
  for (const ruta of ["{evolution,data,Message,base64}", "{evolution,data,message,base64}", "{evolution,data,base64}"]) {
    assert.ok(consulta.includes(`#- '${ruta}'`), ruta);
  }
});

await prueba("el recorte en SQL (PGlite): sin base64 en las pesadas, todo lo demas igual, las chicas intactas", async () => {
  const db = new PGlite();
  await db.exec(`CREATE TABLE "Message" ("id" text PRIMARY KEY, "rawPayload" jsonb)`);
  const b64 = randomBytes(120_000).toString("base64");
  const filas = {
    waha: { source: "webhook", evolution: { data: { key: { id: "1" }, status: "READ", base64: b64, mimetype: "application/pdf", message: { documentMessage: { fileName: "a.pdf", jpegThumbnail: "mini" } } } } },
    evolution: { evolution: { data: { message: { audioMessage: { waveform: "onda" }, base64: b64 } } } },
    evogo: { evolution: { data: { Message: { ImageMessage: { JPEGThumbnail: "mini" }, base64: b64 } } } },
    historial: { source: "evolution-sync", evolution: { key: { id: "h" }, message: { base64: b64 } } },
    chica: { source: "webhook", evolution: { data: { base64: "aGVsbG8=", message: { conversation: "hola" } } } },
    nula: null,
  };
  for (const [id, payload] of Object.entries(filas)) {
    await db.query(`INSERT INTO "Message" VALUES ($1, $2::jsonb)`, [id, payload === null ? null : JSON.stringify(payload)]);
  }
  const { rows } = await db.query(`SELECT "id", ${sqlPayloadSinArchivos('"rawPayload"')} AS "rawPayload" FROM "Message"`);
  const porId = Object.fromEntries(rows.map((f) => [f.id, f.rawPayload]));
  for (const id of ["waha", "evolution", "evogo", "historial"]) {
    assert.equal(JSON.stringify(porId[id]).includes(b64), false, `${id} sin base64`);
  }
  const esperado = structuredClone(filas.waha);
  delete esperado.evolution.data.base64;
  assert.deepEqual(porId.waha, esperado, "ack, ids, mimetype, nombre y miniatura siguen");
  assert.deepEqual(porId.evolution, { evolution: { data: { message: { audioMessage: { waveform: "onda" } } } } });
  assert.deepEqual(porId.chica, filas.chica, "una fila chica sale tal cual");
  assert.equal(porId.nula, null);
  // Las del ultimo mensaje, con el alias m.
  const ultimo = await db.query(`SELECT m."id", ${SQL_PAYLOAD_SIN_ARCHIVOS} AS "rawPayload" FROM "Message" m WHERE m."id" = 'evogo'`);
  assert.deepEqual(ultimo.rows[0].rawPayload, { evolution: { data: { Message: { ImageMessage: { JPEGThumbnail: "mini" } } } } });
  assert.ok(RUTAS_DE_ARCHIVO_CONOCIDAS.length >= 3);
  await db.close();
});

await prueba("prisma.ts: la red va antes de los reintentos y solo para escrituras de Message", () => {
  const prismaTs = leer("src/lib/prisma.ts");
  assert.match(prismaTs, /import \{ operacionQueEscribeMensaje, sinArchivosEnMensaje \} from "@\/lib\/mensaje-sin-archivos"/);
  const red = prismaTs.indexOf("sinArchivosEnMensaje(operation, argsDelTablero)");
  const bucle = prismaTs.indexOf("for (let attempt = 0;");
  assert.ok(red > 0 && bucle > red, "la red tiene que correr una vez, antes del bucle");
  assert.match(prismaTs, /operacionQueEscribeMensaje\(model, operation\)\s*\?\s*await sinArchivosEnMensaje/);
  assert.match(prismaTs, /conDesarchivadoAlReabrir\(model, operation, argsPedidos\)/, "lo del Tablero IA sigue");
  assert.match(prismaTs, /const resultado = await query\(args\);/);
});

await prueba("/uploads: GET y HEAD, por partes (sin readFile), con la logica en archivos-subidos.ts", () => {
  const ruta = leer("src/app/uploads/[...path]/route.ts");
  assert.match(ruta, /export async function GET\(/);
  assert.match(ruta, /export async function HEAD\(/);
  assert.doesNotMatch(ruta, /readFile|getServerSession|auth\(\)/, "sin leer entero y sin pedir sesion");
  const logica = leer("src/lib/archivos-subidos.ts");
  assert.match(logica, /createReadStream\(\{ start: desde, end: hasta/);
  assert.match(logica, /candidata\.startsWith\(base \+ path\.sep\)/);
  assert.doesNotMatch(logica, /readFile/);
});

await prueba("next.config.ts: minimumCacheTTL y Cache-Control por nombre (path-to-regexp de Next)", async () => {
  const config = leer("next.config.ts");
  assert.match(config, /minimumCacheTTL: 2678400/);
  assert.doesNotMatch(config, /value: "private, max-age=31536000, immutable"/, "ya no va immutable para todo");

  // Las reglas tal cual: se sacan del archivo para probarlas con el compilador de rutas de Next.
  const reglas = [...config.matchAll(/source:\s*\n?\s*"(\/uploads[^"]*)",\s*\n\s*headers: \[\{ key: "Cache-Control", value: "([^"]+)" \}\]/g)].map(
    (m) => ({ source: m[1].replace(/\\\\/g, "\\"), valor: m[2] }),
  );
  assert.equal(reglas.length, 3, JSON.stringify(reglas));
  let pathToRegexp;
  try {
    pathToRegexp = require("next/dist/compiled/path-to-regexp").pathToRegexp;
  } catch {
    console.log("  (no encontre next/dist/compiled/path-to-regexp: se omite la prueba de las reglas)");
    return;
  }
  const valorPara = (ruta) => {
    let valor = null;
    for (const regla of reglas) if (pathToRegexp(regla.source, [], { strict: true }).test(ruta)) valor = regla.valor; // gana la ultima
    return valor;
  };
  const hash = "0123456789abcdef".repeat(4);
  assert.equal(valorPara(`/uploads/chat-media/${hash}.pdf`), "public, max-age=31536000, immutable");
  assert.equal(valorPara(`/uploads/${hash}.jpg`), "public, max-age=31536000, immutable");
  assert.equal(valorPara("/uploads/chat-media/1731234567890-0f8fad5b-d9cb-469f-a165-70867728950e.mp4"), "public, max-age=31536000, immutable");
  assert.equal(valorPara("/uploads/categories/tapetes.png"), "private, max-age=0, must-revalidate");
  assert.equal(valorPara(`/uploads/chat-media/${hash}.pdf.tmp-1-abc`), "private, max-age=0, must-revalidate");
  assert.equal(valorPara("/otra/cosa.png"), null);
});

console.log(`\n${pruebas} pruebas OK`);
