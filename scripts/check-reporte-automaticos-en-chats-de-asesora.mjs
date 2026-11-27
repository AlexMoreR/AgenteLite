// Pruebas del REPORTE de automáticos en chats de la asesora (tarjeta 8yvjdvpw, parte 3, 27-11-2026).
//   npm run test:reporte-automaticos-en-chats-de-asesora
//
// Contra un Postgres de pruebas (PGlite, o el de Docker con PRUEBAS_POSTGRES_URL) con TODAS las migraciones
// reales, sin tocar ninguna base real:
//  1. La consulta cuenta los automáticos en chats pausados o con asesora que ya escribió, y deja afuera los
//     de persona, el historial importado, los borrados, los fallidos, los de antes de que la asesora
//     escribiera y los que están fuera de la ventana.
//  2. Los tipos: seguimiento con su clase, aviso de pausa, recordatorio del V3, respuesta al exterior, otro.
//     El aviso de pausa solo cuenta si una persona ya había escrito (antes es el acuse esperado).
//  3. La regla de la clase es la misma que claseDeSeguimiento (src/features/recuperacion/dominio/semana.ts)
//     y los textos fijos son los mismos que usa el código que los manda.
//  4. `--ejemplo` imprime totales por día y por tipo; sin base imprime `no_se_pudo_leer` y sale con 0.
//  5. El script solo lee: transacción READ ONLY y nada de INSERT / UPDATE / DELETE.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { abrirBaseDePruebas } from "./lib/base-de-pruebas.mjs";
import { cargar, RAIZ } from "./supervisor-cargar.mjs";
import {
  armarInforme,
  claseDelFollow,
  leerDatos,
  TEXTO_AVISO_DE_PAUSA,
  TEXTO_EXTERIOR_POR_DEFECTO,
  tipoDelMensaje,
} from "./reporte-automaticos-en-chats-de-asesora.mjs";

let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

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
// Sin las llaves foráneas no hace falta armar workspace, contactos ni líneas.
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

const AHORA = Date.now();
const haceHoras = (horas) => new Date(AHORA - horas * 3_600_000);

await pg.query(
  `INSERT INTO "User" ("id", "name", "email", "password", "updatedAt") VALUES ('u-ingrid', 'Ingrid', 'ingrid@prueba.local', 'x', now())`,
);

async function crearChat(id, { pausado = false, pausadoHaceHoras = null, asesora = null, inicioHaceHoras = 100 } = {}) {
  await pg.query(
    `INSERT INTO "Conversation" ("id", "workspaceId", "contactId", "channelId", "assignedToUserId", "automationPaused", "automationPausedAt", "startedAt", "lastMessageAt", "updatedAt")
     VALUES ($1, 'ws1', $2, 'l1', $3, $4, $5, $6, $6, $6)`,
    [id, `k-${id}`, asesora, pausado, pausadoHaceHoras === null ? null : haceHoras(pausadoHaceHoras), haceHoras(inicioHaceHoras)],
  );
}
let numero = 0;
async function crearMensaje(conversationId, { fuente = null, horas, texto = "hola", estado = "SENT", borrado = false, tipo = "TEXT", direccion = "OUTBOUND" }) {
  numero += 1;
  const payload = fuente === null ? { key: { id: `wa-${numero}` } } : { source: fuente };
  await pg.query(
    `INSERT INTO "Message" ("id", "workspaceId", "conversationId", "contactId", "channelId", "direction", "type", "status", "content", "rawPayload", "deletedAt", "createdAt", "updatedAt")
     VALUES ($1, 'ws1', $2, $3, 'l1', $4, $5, $6, $7, $8::jsonb, $9, $10, $10)`,
    [`m${numero}`, conversationId, `k-${conversationId}`, direccion, tipo, estado, texto, JSON.stringify(payload), borrado ? haceHoras(horas) : null, haceHoras(horas)],
  );
}
async function crearFollow(conversationId, nombre, horas) {
  numero += 1;
  await pg.query(
    `INSERT INTO "Follow" ("id", "workspaceId", "contactId", "channelId", "name", "timeType", "timeValue", "executeAt", "executedAt", "messageType", "content", "status", "createdAt", "updatedAt")
     VALUES ($1, 'ws1', $2, 'l1', $3, 'MINUTES', 0, $4, $4, 'TEXT', 'Hola, ¿pudiste ver?', 'EXECUTED', $4, $4)`,
    [`f${numero}`, `k-${conversationId}`, nombre, haceHoras(horas)],
  );
}

/* Chat A: con Ingrid, que escribió hace 50 h. Después salieron automáticos (cuentan) y antes uno (no). */
await crearChat("chat-a", { asesora: "u-ingrid" });
await crearMensaje("chat-a", { horas: 60, texto: "bienvenida del bot" }); // antes de la asesora: no cuenta
await crearMensaje("chat-a", { fuente: "manual", horas: 50 });
await crearFollow("chat-a", "Etapa Precio · día siguiente", 40);
await crearMensaje("chat-a", { fuente: "follow", horas: 40 });
await crearFollow("chat-a", "Tras asesora: 1 h", 30);
await crearMensaje("chat-a", { fuente: "follow", horas: 30 });
await crearMensaje("chat-a", { fuente: "agente-v3-seguimiento", horas: 20 });
await crearMensaje("chat-a", { fuente: "agente-v3-seguimiento-ia", horas: 19 });
await crearMensaje("chat-a", { horas: 18, texto: TEXTO_AVISO_DE_PAUSA });
await crearMensaje("chat-a", { horas: 17, texto: "fotos del combo" }); // otro
await crearMensaje("chat-a", { fuente: "manual", horas: 16 }); // de persona: no cuenta
await crearMensaje("chat-a", { fuente: "instance", horas: 15 }); // del celular: no cuenta
await crearMensaje("chat-a", { fuente: "automation_reactivation", horas: 14 }); // botón de la asesora
await crearMensaje("chat-a", { fuente: "evolution-sync", horas: 13 }); // historial importado
await crearMensaje("chat-a", { fuente: "evogo-history-sync", horas: 12 }); // historial importado
await crearMensaje("chat-a", { horas: 11, borrado: true }); // borrado
await crearMensaje("chat-a", { horas: 10, estado: "FAILED" }); // no salió
await crearMensaje("chat-a", { horas: 9, tipo: "SYSTEM" }); // nota
await crearMensaje("chat-a", { horas: 8, direccion: "INBOUND" }); // del cliente
await crearMensaje("chat-a", { horas: 24 * 9 }); // fuera de los 7 días

/* Chat B: pausado hace 5 h, sin asesora. Cuenta lo de después de la pausa. */
await crearChat("chat-b", { pausado: true, pausadoHaceHoras: 5 });
await crearMensaje("chat-b", { horas: 6, texto: "antes de la pausa" });
await crearMensaje("chat-b", { horas: 4, texto: TEXTO_EXTERIOR_POR_DEFECTO });

/* Chat C: asignado, pero lo único "de persona" es el celular en el primer minuto (automático de la línea). */
await crearChat("chat-c", { asesora: "u-ingrid", inicioHaceHoras: 30 });
await crearMensaje("chat-c", { fuente: "instance", horas: 30 - 0.5 / 60 }); // 30 s después del inicio
await crearMensaje("chat-c", { horas: 10, texto: "seguimiento del bot" });

/* Chat D: con un mensaje de persona pero SIN asesora asignada y sin pausa: no es de la asesora. */
await crearChat("chat-d");
await crearMensaje("chat-d", { fuente: "manual", horas: 50 });
await crearMensaje("chat-d", { horas: 10, texto: "seguimiento del bot" });

/* Chat E: asignado y el celular escribió pasado el primer minuto: sí cuenta. */
await crearChat("chat-e", { asesora: "u-ingrid", inicioHaceHoras: 30 });
await crearMensaje("chat-e", { fuente: "instance", horas: 29 });
await crearMensaje("chat-e", { horas: 10, texto: "seguimiento del bot" });

/* Chat F: pausado por el bot y nadie del equipo escribió: el aviso de pausa es lo esperado (no cuenta). */
await crearChat("chat-f", { pausado: true, pausadoHaceHoras: 6 });
await crearMensaje("chat-f", { horas: 5, texto: TEXTO_AVISO_DE_PAUSA });

/* Chat G: pausado y la asesora ya había escrito: el aviso de pausa SÍ cuenta (la parte 2 lo frena). */
await crearChat("chat-g", { pausado: true, pausadoHaceHoras: 6 });
await crearMensaje("chat-g", { fuente: "manual", horas: 7 });
await crearMensaje("chat-g", { horas: 5, texto: TEXTO_AVISO_DE_PAUSA });

const q = async (sql, params) => (await pg.query(sql, params)).rows;

await prueba("la consulta cuenta solo los automáticos en chats de la asesora y separa por tipo y por chat", async () => {
  const datos = await leerDatos(q, 7);
  const informe = armarInforme({ ...datos, dias: 7 });
  assert.equal(informe.total, 9, JSON.stringify(informe, null, 2));
  assert.equal(informe.por_tipo.seguimiento.total, 2);
  assert.equal(informe.por_tipo.seguimiento.por_clase.dia_siguiente, 1);
  assert.equal(informe.por_tipo.seguimiento.por_clase.tras_asesora, 1);
  assert.equal(informe.por_tipo.recordatorio_v3, 2);
  assert.equal(informe.por_tipo.aviso_de_pausa, 2);
  assert.equal(informe.por_tipo.respuesta_al_exterior, 1);
  assert.equal(informe.por_tipo.otro, 2);
  assert.deepEqual(informe.chats, [
    { conversationId: "chat-a", asesora: "Ingrid", cantidad: 6 },
    { conversationId: "chat-b", asesora: "(sin asesora)", cantidad: 1 },
    { conversationId: "chat-e", asesora: "Ingrid", cantidad: 1 },
    { conversationId: "chat-g", asesora: "(sin asesora)", cantidad: 1 },
  ]);
  const sumaPorDia = Object.values(informe.por_dia).reduce((a, b) => a + b, 0);
  assert.equal(sumaPorDia, 9);
  assert.equal(informe.no_se_pudo_leer, undefined);
});

await prueba("la ventana: con --dias 1 solo entra lo del último día", async () => {
  const informe = armarInforme({ ...(await leerDatos(q, 1)), dias: 1 });
  // chat-a: v3 (20 h, 19 h), aviso (18 h), otro (17 h); chat-b: exterior (4 h); chat-e (10 h); chat-g: aviso (5 h).
  assert.equal(informe.total, 7);
});

await prueba("la respuesta al exterior que el negocio cambió en su configuración también se reconoce", async () => {
  await pg.query(`INSERT INTO "AppSetting" ("key", "value", "updatedAt") VALUES ('seguimiento-inteligente:config:ws1', $1, now())`, [
    JSON.stringify({ exterior: { activo: true, texto: "Solo vendemos en Colombia 🇨🇴" } }),
  ]);
  await crearMensaje("chat-b", { horas: 3, texto: "Solo vendemos en Colombia 🇨🇴" });
  const informe = armarInforme({ ...(await leerDatos(q, 7)), dias: 7 });
  assert.equal(informe.por_tipo.respuesta_al_exterior, 2);
  assert.equal(informe.total, 10);
});

await prueba("la clase del seguimiento es la misma regla que claseDeSeguimiento del código", async () => {
  const { claseDeSeguimiento } = cargar("src/features/recuperacion/dominio/semana.ts");
  for (const nombre of ["Tras asesora: 1 h", "Etapa Precio · 2", "Inteligente: precio", "Campaña: Black Friday", "Otra cosa", "", null]) {
    assert.equal(claseDelFollow(nombre), claseDeSeguimiento("follow", nombre), String(nombre));
  }
  assert.deepEqual(tipoDelMensaje({ origen: "follow", follow: "Campaña: X" }), { tipo: "seguimiento", clase: "campana" });
});

await prueba("los textos fijos son los mismos que manda el código", async () => {
  const webhook = fs.readFileSync(path.join(RAIZ, "src/app/api/webhooks/evolution/route.ts"), "utf8");
  assert.ok(webhook.includes(JSON.stringify(TEXTO_AVISO_DE_PAUSA)), "el aviso de pausa cambió en el webhook");
  const { TEXTO_EXTERIOR_POR_DEFECTO: delCodigo } = cargar("src/features/seguimiento-inteligente/dominio/config.ts");
  assert.equal(TEXTO_EXTERIOR_POR_DEFECTO, delCodigo);
});

const SCRIPT = path.join(RAIZ, "scripts/reporte-automaticos-en-chats-de-asesora.mjs");

await prueba("--ejemplo imprime totales por día y por tipo, sin base", async () => {
  const salida = spawnSync(process.execPath, [SCRIPT, "--ejemplo"], {
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: "postgresql://nadie:nada@127.0.0.1:1/nada" },
  });
  assert.equal(salida.status, 0, salida.stderr);
  const informe = JSON.parse(salida.stdout);
  assert.ok(informe.total > 0);
  assert.ok(Object.keys(informe.por_dia).length > 0);
  for (const tipo of ["seguimiento", "aviso_de_pausa", "recordatorio_v3", "respuesta_al_exterior", "otro"]) {
    assert.ok(tipo in informe.por_tipo, tipo);
  }
  assert.ok(Array.isArray(informe.chats) && informe.chats.length > 0);
});

await prueba("sin base: --dias 7 imprime no_se_pudo_leer y sale con 0 (sin mostrar la clave)", async () => {
  const salida = spawnSync(process.execPath, [SCRIPT, "--dias", "7"], {
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: "postgresql://nadie:clave-secreta@127.0.0.1:1/nada" },
    timeout: 60_000,
  });
  assert.equal(salida.status, 0, salida.stderr);
  const informe = JSON.parse(salida.stdout);
  assert.ok(Array.isArray(informe.no_se_pudo_leer) && informe.no_se_pudo_leer.length > 0);
  assert.equal(informe.total, undefined);
  assert.doesNotMatch(salida.stdout, /clave-secreta/);
});

await prueba("el script solo lee: transacción READ ONLY y nada de INSERT, UPDATE, DELETE ni envíos", async () => {
  const fuente = fs.readFileSync(SCRIPT, "utf8");
  assert.match(fuente, /BEGIN READ ONLY/);
  assert.doesNotMatch(fuente, /\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP)\b/);
  assert.doesNotMatch(fuente, /sendMessage|enviarMensaje|sendEvolution/);
});

await pg.close();
console.log(`\n${pruebas} pruebas del reporte de automáticos en chats de la asesora: todas bien`);
