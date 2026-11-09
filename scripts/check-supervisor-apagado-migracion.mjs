/**
 * Prueba de la migración "apagar el Supervisor accionable" (prisma/migrations/20261114120000_apagar_supervisor_accionable)
 * contra un Postgres embebido (PGlite), sin tocar ninguna base real:
 *   npm run test:supervisor-apagado-migracion
 *
 * 1. Aplica TODAS las migraciones reales en orden, hasta la anterior a esta, y crea interruptores y alertas como los de hoy.
 * 2. Aplica la nueva: el accionable queda con activo=false sin perder el resto de su configuración, el general en "false"
 *    y las alertas de atención abiertas de hoy quedan resueltas en las dos tablas. Lo demás no cambia.
 * 3. La vuelve a aplicar: no falla, no cambia nada y ninguna fila desaparece.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CARPETA = path.join(RAIZ, "prisma", "migrations");
const NUEVA = "20261114120000_apagar_supervisor_accionable";

const migraciones = fs
  .readdirSync(CARPETA, { withFileTypes: true })
  .filter((entrada) => entrada.isDirectory())
  .map((entrada) => entrada.name)
  .sort();
assert.ok(migraciones.includes(NUEVA), `falta la migración ${NUEVA}`);
assert.equal(migraciones.at(-1), NUEVA, "la migración nueva tiene que quedar de última");
const leer = (nombre) => fs.readFileSync(path.join(CARPETA, nombre, "migration.sql"), "utf8");

const db = new PGlite();
let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}
const filas = async (sql, valores = []) => (await db.query(sql, valores)).rows;

for (const nombre of migraciones) {
  if (nombre === NUEVA) break;
  try {
    await db.exec(leer(nombre));
  } catch (fallo) {
    throw new Error(`La migración ${nombre} falló en PGlite: ${fallo.message}`);
  }
}

const CONFIG_ACCIONABLE = {
  activo: true,
  plazos: { pago: 15, caliente: 20, asignado: 30, sin_duena: 10 },
  supervisoraId: "user_yair",
  segundaOportunidadMin: 10,
  fueraDeHorario: { activo: true, responsableId: "user_ingrid" },
};
const ESTADO = JSON.stringify({ abiertas: [{ id: "acc1", activo: true, venceEn: "2026-11-09T13:20:00.000Z" }] });
const ATENDIDAS = JSON.stringify({ activo: true, ids: ["acc0"] });
const TAREAS = JSON.stringify({ activo: true, vigentes: [] });
const VIEJO = "2026-11-01 12:00:00";

await db.exec(`
  INSERT INTO "AppSetting" ("key", "value", "createdAt", "updatedAt") VALUES
    ('supervisor:accionable:ws1', '${JSON.stringify(CONFIG_ACCIONABLE)}', '${VIEJO}', '${VIEJO}'),
    ('supervisor:accionable:estado:ws1', '${ESTADO}', '${VIEJO}', '${VIEJO}'),
    ('supervisor:accionable:atendidas:ws1', '${ATENDIDAS}', '${VIEJO}', '${VIEJO}'),
    ('supervisor:accionable:tareas:ws1', '${TAREAS}', '${VIEJO}', '${VIEJO}'),
    ('supervisor:accionable:ws2', '{ esto no es json', '${VIEJO}', '${VIEJO}'),
    ('supervisor:activo:ws1', 'true', '${VIEJO}', '${VIEJO}'),
    ('supervisor:activo:ws3', ' TRUE ', '${VIEJO}', '${VIEJO}'),
    ('supervisor:revalidacion:ws1', 'true', '${VIEJO}', '${VIEJO}'),
    ('supervisor:libro-visto:ws1', '318', '${VIEJO}', '${VIEJO}'),
    ('avisos:gravedad:ws1', '{"activo":true,"whatsapp":{"activo":true}}', '${VIEJO}', '${VIEJO}');

  INSERT INTO "SupervisorAlerta" ("id", "workspaceId", "clave", "claveAbierta", "familia", "severidad", "estado", "titulo",
    "desde", "primeraVezEn", "ultimaVezEn", "hallazgos", "texto", "createdAt", "updatedAt") VALUES
    ('s1', 'ws1', 'ATENCION:caliente-esperando:ana', 'ws1:ATENCION:caliente-esperando:ana', 'ATENCION', 'IMPORTANTE', 'ABIERTA', 'Hoy 8:05',
      '2026-11-09 13:00:00', '2026-11-09 13:05:00', '2026-11-09 13:05:00', '[]', 't', '2026-11-09 13:05:00', '2026-11-09 13:05:00'),
    ('s2', 'ws1', 'ATENCION:sin-duena', 'ws1:ATENCION:sin-duena', 'ATENCION', 'CRITICO', 'ABIERTA', 'Desde ayer, vista hoy',
      '2026-11-08 20:00:00', '2026-11-08 20:00:00', '2026-11-09 14:00:00', '[]', 't', '2026-11-08 20:00:00', '2026-11-09 14:00:00'),
    ('s3', 'ws1', 'ATENCION:viejo', 'ws1:ATENCION:viejo', 'ATENCION', 'IMPORTANTE', 'ABIERTA', 'Antes de hoy',
      '2026-11-08 20:00:00', '2026-11-08 20:00:00', '2026-11-09 04:59:59', '[]', 't', '2026-11-08 20:00:00', '2026-11-08 20:00:00'),
    ('s4', 'ws1', 'INC:libro-v318:combo', 'ws1:INC:libro-v318:combo', 'BOT', 'CRITICO', 'ABIERTA', 'Bot hoy',
      '2026-11-09 13:00:00', '2026-11-09 13:00:00', '2026-11-09 13:00:00', '[]', 't', '2026-11-09 13:00:00', '2026-11-09 13:00:00'),
    ('s5', 'ws1', 'CEREBRO:x', 'ws1:CEREBRO:x', 'CEREBRO', 'OBSERVACION', 'ABIERTA', 'Cerebro hoy',
      '2026-11-09 13:00:00', '2026-11-09 13:00:00', '2026-11-09 13:00:00', '[]', 't', '2026-11-09 13:00:00', '2026-11-09 13:00:00'),
    ('s6', 'ws1', 'ATENCION:ya-resuelta', NULL, 'ATENCION', 'IMPORTANTE', 'RESUELTA', 'Ya resuelta hoy',
      '2026-11-09 13:00:00', '2026-11-09 13:00:00', '2026-11-09 13:10:00', '[]', 't', '2026-11-09 13:00:00', '2026-11-09 13:20:00');

  INSERT INTO "AlertaInterna" ("id", "workspaceId", "clave", "prioridad", "titulo", "origen", "estado", "creadoEn", "ultimaVez", "vistaEn") VALUES
    ('a1', 'ws1', 'sup:ATENCION:caliente-esperando:ana', 'ALTA', 'Nueva hoy', 'Supervisor', 'NUEVA', '2026-11-09 13:05:00', '2026-11-09 13:05:00', NULL),
    ('a2', 'ws1', 'sup:ATENCION:sin-duena', 'URGENTE', 'Vista hoy', 'Supervisor', 'VISTA', '2026-11-08 20:00:00', '2026-11-09 14:00:00', '2026-11-09 13:30:00'),
    ('a3', 'ws1', 'sup:ATENCION:viejo', 'ALTA', 'Antes de hoy', 'Supervisor', 'NUEVA', '2026-11-08 20:00:00', '2026-11-09 04:59:59', NULL),
    ('a4', 'ws1', 'sup:INC:libro-v318:combo', 'URGENTE', 'Bot hoy', 'Supervisor', 'NUEVA', '2026-11-09 13:00:00', '2026-11-09 13:00:00', NULL),
    ('a5', 'ws1', 'demora-asesora:ana', 'ALTA', 'Demora de asesora hoy', 'Agente de Ventas', 'NUEVA', '2026-11-09 13:00:00', '2026-11-09 13:00:00', NULL),
    ('a6', 'ws1', 'linea-caida:l1', 'URGENTE', 'Línea caída hoy', 'Línea de WhatsApp', 'VISTA', '2026-11-09 13:00:00', '2026-11-09 13:00:00', '2026-11-09 13:01:00');
`);

const sql = leer(NUEVA);
const TABLAS = ["AppSetting", "SupervisorAlerta", "AlertaInterna"];
const foto = async () => {
  const resultado = {};
  for (const tabla of TABLAS) resultado[tabla] = await filas(`SELECT * FROM "${tabla}" ORDER BY 1`);
  return resultado;
};
const porId = (lista, campo) => Object.fromEntries(lista.map((fila) => [fila[campo], fila]));

await prueba("el archivo empieza con BEGIN;, termina con COMMIT; y no borra nada", async () => {
  assert.match(sql, /^BEGIN;/, "empieza con BEGIN;");
  assert.match(sql.trimEnd(), /COMMIT;$/, "termina con COMMIT;");
  assert.doesNotMatch(sql, /\bDROP\b|\bDELETE\b|\bTRUNCATE\b/i, "sin DROP ni borrado de filas");
});

const antes = await foto();
await db.exec(sql);
const despues = await foto();

const settingAntes = porId(antes.AppSetting, "key");
const setting = porId(despues.AppSetting, "key");
const alertaAntes = porId(antes.SupervisorAlerta, "id");
const alerta = porId(despues.SupervisorAlerta, "id");
const internaAntes = porId(antes.AlertaInterna, "id");
const interna = porId(despues.AlertaInterna, "id");

await prueba("el accionable queda con activo=false y conserva plazos, supervisora y fuera de horario", async () => {
  const fila = setting["supervisor:accionable:ws1"];
  const config = JSON.parse(fila.value);
  assert.equal(config.activo, false);
  assert.deepEqual({ ...config, activo: true }, CONFIG_ACCIONABLE, "el resto de la configuración no cambia");
  assert.equal(config.fueraDeHorario.activo, true);
  assert.equal(config.supervisoraId, "user_yair");
  assert.ok(new Date(fila.updatedAt) > new Date(`${VIEJO}Z`), "updatedAt a la hora actual");
});

await prueba("el interruptor general queda en false (también con mayúsculas o espacios)", async () => {
  assert.equal(setting["supervisor:activo:ws1"].value, "false");
  assert.equal(setting["supervisor:activo:ws3"].value, "false");
});

await prueba("estado, atendidas, tareas, un valor que no es JSON y los demás interruptores no cambian", async () => {
  for (const clave of [
    "supervisor:accionable:estado:ws1",
    "supervisor:accionable:atendidas:ws1",
    "supervisor:accionable:tareas:ws1",
    "supervisor:accionable:ws2",
    "supervisor:revalidacion:ws1",
    "supervisor:libro-visto:ws1",
    "avisos:gravedad:ws1",
  ]) {
    assert.deepEqual(setting[clave], settingAntes[clave], `${clave} no cambia`);
  }
});

await prueba("las alertas ATENCION abiertas de hoy quedan RESUELTA y con claveAbierta en null", async () => {
  for (const id of ["s1", "s2"]) {
    assert.equal(alerta[id].estado, "RESUELTA", id);
    assert.equal(alerta[id].claveAbierta, null, id);
    assert.ok(alerta[id].resueltaEn, `${id} con resueltaEn`);
    assert.equal(alerta[id].texto, alertaAntes[id].texto, `${id} conserva su historial`);
  }
  for (const id of ["a1", "a2"]) {
    assert.equal(interna[id].estado, "RESUELTA", id);
    assert.ok(interna[id].resueltaEn, `${id} con resueltaEn`);
    assert.ok(interna[id].vistaEn, `${id} con vistaEn`);
  }
  assert.equal(new Date(interna.a2.vistaEn).toISOString(), new Date(internaAntes.a2.vistaEn).toISOString(), "vistaEn que ya tenía no cambia");
});

await prueba("las de otra familia (BOT, CEREBRO), las de antes de hoy, las ya resueltas y las que no son sup:ATENCION: no cambian", async () => {
  for (const id of ["s3", "s4", "s5", "s6"]) assert.deepEqual(alerta[id], alertaAntes[id], id);
  for (const id of ["a3", "a4", "a5", "a6"]) assert.deepEqual(interna[id], internaAntes[id], id);
});

await prueba("ninguna fila desaparece", async () => {
  for (const tabla of TABLAS) assert.equal(despues[tabla].length, antes[tabla].length, tabla);
});

await prueba("aplicarla otra vez no falla ni cambia nada", async () => {
  await db.exec(sql);
  assert.deepEqual(await foto(), despues);
});

await prueba("se vuelve a poder crear una alerta abierta con la misma clave (prenderlo después funciona)", async () => {
  await db.exec(`
    INSERT INTO "SupervisorAlerta" ("id", "workspaceId", "clave", "claveAbierta", "familia", "severidad", "titulo",
      "desde", "primeraVezEn", "ultimaVezEn", "hallazgos", "texto", "updatedAt") VALUES
      ('s7', 'ws1', 'ATENCION:caliente-esperando:ana', 'ws1:ATENCION:caliente-esperando:ana', 'ATENCION', 'IMPORTANTE', 'Otra vez',
        now(), now(), now(), '[]', 't', now());
  `);
});

await db.close();
console.log(`\n${pruebas} pruebas de la migración "apagar el Supervisor accionable": todas pasaron.`);
