/**
 * Prueba de la migración del trabajador del Tablero IA (fase 2)
 * (prisma/migrations/20261020120000_tablero_trabajador) contra un Postgres embebido (PGlite), sin
 * tocar ninguna base real:
 *   npm run test:tablero-trabajador-migracion
 *
 * 1. Aplica TODAS las migraciones reales en orden sobre una base vacía, hasta la anterior a esta.
 * 2. Inserta datos como los de hoy: un negocio, su dueño y una asesora, un tablero con sus tipos y
 *    tarjetas en todos los estados de la fase 1, flechas e historial.
 * 3. Aplica la migración nueva y comprueba: el enum tiene los 6 valores nuevos (y FALLIDO sigue), las
 *    columnas nuevas con sus defaults, las dos tablas nuevas con sus restricciones, y nada perdido.
 * 4. Revisa que la migración no USE los valores nuevos del enum (no se puede en la misma transacción).
 * 5. La vuelve a aplicar (no debe fallar ni duplicar nada).
 * 6. Corre las consultas reales del trabajador (services/sql-trabajador.ts): tomar es atómico, respeta
 *    el candado del negocio, el repo, el tipo y la zona protegida, y las vencidas pasan a ERROR.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { cargar } from "./supervisor-cargar.mjs";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CARPETA = path.join(RAIZ, "prisma", "migrations");
const NUEVA = "20261020120000_tablero_trabajador";
const NUEVOS = ["PLANEANDO", "PLAN_LISTO", "PLAN_APROBADO", "POR_REVISAR", "SUBIENDO", "ERROR"];

const sql = cargar("src/features/tableros-inteligentes/services/sql-trabajador.ts");

const migraciones = fs
  .readdirSync(CARPETA, { withFileTypes: true })
  .filter((entrada) => entrada.isDirectory())
  .map((entrada) => entrada.name)
  .sort();
assert.ok(migraciones.includes(NUEVA), `falta la migración ${NUEVA}`);
// Ya no es la última (después vino la de tableros por cuenta, 20261020180000): se aplica hasta ella, en orden.

const leer = (nombre) => fs.readFileSync(path.join(CARPETA, nombre, "migration.sql"), "utf8");

const db = new PGlite();
let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}
const filas = async (texto, valores = []) => (await db.query(texto, valores)).rows;

for (const nombre of migraciones) {
  if (nombre === NUEVA) break;
  try {
    await db.exec(leer(nombre));
  } catch (fallo) {
    throw new Error(`La migración ${nombre} falló en PGlite: ${fallo.message}`);
  }
}
console.log(`aplicadas ${migraciones.length - 1} migraciones anteriores`);

// ── Datos de antes de la migración ─────────────────────────────────────────────────────────
await db.exec(`
  INSERT INTO "User" ("id", "email", "password", "updatedAt") VALUES
    ('u-dueno', 'dueno@x.co', 'x', now()), ('u-asesora', 'asesora@x.co', 'x', now());
  INSERT INTO "Workspace" ("id", "name", "slug", "updatedAt", "ownerId") VALUES
    ('ws1', 'Magilus', 'magilus', now(), 'u-dueno'), ('ws2', 'Otro', 'otro', now(), NULL);
  INSERT INTO "TableroInteligente" ("id", "workspaceId", "nombre") VALUES
    ('tab1', 'ws1', 'Ventas'), ('tab2', 'ws2', 'Otro negocio');
  INSERT INTO "TipoTarjeta" ("id", "tableroId", "nombre", "requiereAprobacion", "usaEstados", "orden") VALUES
    ('area', 'tab1', 'Área', false, false, 0),
    ('idea', 'tab1', 'Idea', false, true, 1),
    ('tarea', 'tab1', 'Tarea', true, true, 2),
    ('tarea2', 'tab2', 'Tarea', true, true, 0);
  INSERT INTO "TarjetaTablero" ("id", "tableroId", "titulo", "estado", "creadoPor", "actualizadoEn", "tipoId") VALUES
    ('c1', 'tab1', 'Responder en 15 min', 'IDEA', 'u-dueno', now(), 'tarea'),
    ('c2', 'tab1', 'Seguimiento a 24 h', 'POR_APROBAR', 'u-dueno', now(), 'tarea'),
    ('c3', 'tab1', 'Guion de envío', 'APROBADO', 'u-dueno', now(), 'tarea'),
    ('c4', 'tab1', 'Tabla de fletes', 'EN_CURSO', 'u-dueno', now(), 'tarea'),
    ('c5', 'tab1', 'Moldes nuevos', 'HECHO', 'u-dueno', now(), 'tarea'),
    ('c6', 'tab1', 'Proveedor de espuma', 'FALLIDO', 'u-dueno', now(), 'tarea'),
    ('c7', 'tab1', 'Ventas', 'IDEA', 'u-dueno', now(), 'area');
  INSERT INTO "ConexionTarjeta" ("id", "tableroId", "origenId", "destinoId") VALUES ('f1', 'tab1', 'c1', 'c2');
  INSERT INTO "HistorialTarjeta" ("id", "tarjetaId", "quien", "origen", "accion", "despues") VALUES
    ('h1', 'c3', 'u-dueno', 'PANTALLA', 'aprobar', '{"estado":"APROBADO"}');
`);
const antes = await filas(`SELECT "id", "estado", "titulo", "tipoId" FROM "TarjetaTablero" ORDER BY "id"`);

await prueba("la migración no usa los valores nuevos del enum fuera de su ADD VALUE", async () => {
  const texto = leer(NUEVA)
    .split("\n")
    .filter((linea) => !linea.trim().startsWith("--"))
    .filter((linea) => !/ALTER TYPE "EstadoTarjeta" ADD VALUE IF NOT EXISTS/.test(linea))
    .join("\n");
  for (const valor of NUEVOS) assert.ok(!texto.includes(`'${valor}'`), `usa '${valor}' dentro de la migración`);
  assert.match(leer(NUEVA), /^BEGIN;$/m);
  assert.match(leer(NUEVA), /^COMMIT;$/m);
});

// ── La migración nueva ─────────────────────────────────────────────────────────────────────
await db.exec(leer(NUEVA));

await prueba("el enum tiene los 6 estados nuevos y conserva los 6 de antes (FALLIDO incluido), en orden", async () => {
  const valores = (await filas(`SELECT unnest(enum_range(NULL::"EstadoTarjeta"))::text AS v`)).map((f) => f.v);
  assert.deepEqual(valores, ["IDEA", "POR_APROBAR", "APROBADO", "EN_CURSO", "HECHO", "FALLIDO", ...NUEVOS]);
});

await prueba("las tarjetas de antes siguen iguales y reciben los defaults (sin repo, sin plan, sin zona, 0 intentos)", async () => {
  const despues = await filas(`
    SELECT "id", "estado", "titulo", "tipoId", "repo", "plan", "resultado", "zonaProtegida", "intentos",
           "trabajoIniciadoEn", "trabajoVenceEn"
    FROM "TarjetaTablero" ORDER BY "id"`);
  assert.deepEqual(
    despues.map((f) => [f.id, f.estado, f.titulo, f.tipoId]),
    antes.map((f) => [f.id, f.estado, f.titulo, f.tipoId]),
  );
  for (const f of despues) {
    assert.equal(f.repo, null);
    assert.equal(f.plan, null);
    assert.equal(f.resultado, null);
    assert.deepEqual(f.zonaProtegida, []);
    assert.equal(f.intentos, 0);
    assert.equal(f.trabajoIniciadoEn, null);
    assert.equal(f.trabajoVenceEn, null);
  }
  const [{ n }] = await filas(`SELECT count(*)::int AS n FROM "ConexionTarjeta"`);
  const [{ h }] = await filas(`SELECT count(*)::int AS h FROM "HistorialTarjeta"`);
  assert.equal(n, 1);
  assert.equal(h, 1);
});

await prueba("columnas nuevas: tipos y nulos correctos", async () => {
  const columnas = await filas(`
    SELECT column_name, is_nullable, data_type, udt_name, column_default FROM information_schema.columns
    WHERE table_name = 'TarjetaTablero'
      AND column_name IN ('repo', 'plan', 'resultado', 'zonaProtegida', 'intentos', 'trabajoIniciadoEn', 'trabajoVenceEn')`);
  const mapa = Object.fromEntries(columnas.map((c) => [c.column_name, c]));
  assert.equal(Object.keys(mapa).length, 7);
  assert.equal(mapa.repo.data_type, "text");
  assert.equal(mapa.plan.data_type, "text");
  assert.equal(mapa.resultado.data_type, "jsonb");
  assert.equal(mapa.zonaProtegida.udt_name, "_text");
  assert.equal(mapa.zonaProtegida.is_nullable, "NO");
  assert.equal(mapa.intentos.is_nullable, "NO");
  assert.equal(mapa.intentos.column_default, "0");
  for (const c of ["repo", "plan", "resultado", "trabajoIniciadoEn", "trabajoVenceEn"]) assert.equal(mapa[c].is_nullable, "YES", c);
  assert.match(mapa.trabajoVenceEn.data_type, /timestamp without time zone/);
});

await prueba("después de la migración los estados nuevos se pueden usar", async () => {
  await db.exec(`UPDATE "TarjetaTablero" SET "estado" = 'PLAN_LISTO', "plan" = 'Paso 1' WHERE "id" = 'c1'`);
  const [fila] = await filas(`SELECT "estado" FROM "TarjetaTablero" WHERE "id" = 'c1'`);
  assert.equal(fila.estado, "PLAN_LISTO");
  await db.exec(`UPDATE "TarjetaTablero" SET "estado" = 'IDEA', "plan" = NULL WHERE "id" = 'c1'`);
});

await prueba("AprobadorTablero: uno por persona y negocio, alcance TODO o DESARROLLO, puedeSubir false por defecto", async () => {
  await db.exec(`INSERT INTO "AprobadorTablero" ("id", "workspaceId", "userId") VALUES ('a1', 'ws1', 'u-asesora')`);
  const [fila] = await filas(`SELECT "alcance", "puedeSubir", "creadoEn" FROM "AprobadorTablero" WHERE "id" = 'a1'`);
  assert.equal(fila.alcance, "DESARROLLO");
  assert.equal(fila.puedeSubir, false);
  assert.ok(fila.creadoEn);
  await assert.rejects(
    db.query(`INSERT INTO "AprobadorTablero" ("id", "workspaceId", "userId") VALUES ('a2', 'ws1', 'u-asesora')`),
    /unique|duplicate/i,
  );
  await assert.rejects(
    db.query(`INSERT INTO "AprobadorTablero" ("id", "workspaceId", "userId", "alcance") VALUES ('a3', 'ws2', 'u-asesora', 'JEFE')`),
    /check/i,
  );
  await assert.rejects(
    db.query(`INSERT INTO "AprobadorTablero" ("id", "workspaceId", "userId") VALUES ('a4', 'ws1', 'nadie')`),
    /foreign key/i,
  );
});

await prueba("ClaveTrabajador: huella única, sin uso ni revocación al nacer, y cae con el negocio", async () => {
  await db.exec(`INSERT INTO "ClaveTrabajador" ("id", "workspaceId", "nombre", "hash") VALUES ('k1', 'ws1', 'aizen1', 'abc')`);
  const [fila] = await filas(`SELECT "ultimoUsoEn", "revocadaEn", "creadoEn" FROM "ClaveTrabajador" WHERE "id" = 'k1'`);
  assert.equal(fila.ultimoUsoEn, null);
  assert.equal(fila.revocadaEn, null);
  assert.ok(fila.creadoEn);
  await assert.rejects(
    db.query(`INSERT INTO "ClaveTrabajador" ("id", "workspaceId", "nombre", "hash") VALUES ('k2', 'ws2', 'otra', 'abc')`),
    /unique|duplicate/i,
  );
  await db.exec(`INSERT INTO "ClaveTrabajador" ("id", "workspaceId", "nombre", "hash") VALUES ('k3', 'ws2', 'otra', 'def')`);
});

await prueba("aplicarla otra vez no falla ni duplica nada", async () => {
  await db.exec(leer(NUEVA));
  const valores = await filas(`SELECT unnest(enum_range(NULL::"EstadoTarjeta"))::text AS v`);
  assert.equal(valores.length, 12);
  const [{ a }] = await filas(`SELECT count(*)::int AS a FROM "AprobadorTablero"`);
  const [{ k }] = await filas(`SELECT count(*)::int AS k FROM "ClaveTrabajador"`);
  assert.equal(a, 1);
  assert.equal(k, 2);
});

// ── Las consultas del trabajador ────────────────────────────────────────────────────────────
// Las consultas de hoy (services/sql-trabajador.ts) usan también lo que agregaron las migraciones
// posteriores (IntentoTarjeta, esDependencia, reparaciones): se aplican en orden antes de correrlas.
for (const nombre of migraciones.slice(migraciones.indexOf(NUEVA) + 1)) {
  try {
    await db.exec(leer(nombre));
  } catch (fallo) {
    throw new Error(`La migración ${nombre} falló en PGlite: ${fallo.message}`);
  }
}
const AHORA = "2026-10-20T15:00:00.000Z";
const EN_5_MIN = "2026-10-20T15:05:00.000Z";
const REPOS = ["gestion", "aizencrm"];
const tomar = (ws = "ws1", ahora = AHORA, vence = EN_5_MIN, excluir = []) => filas(sql.SQL_TOMAR_UNA, [ws, ahora, REPOS, vence, excluir]);
const hay = (ws = "ws1", ahora = AHORA) => filas(sql.SQL_TRABAJANDO, [ws, ahora]);
const candidatas = (ws = "ws1") => filas(sql.SQL_CANDIDATAS, [ws, REPOS]);
const fueraPorLaVia = (ws = "ws1") => filas(sql.SQL_FUERA_POR_LA_VIA, [ws, REPOS]);

await db.exec(`
  UPDATE "TarjetaTablero" SET "repo" = 'aizencrm', "actualizadoEn" = '2026-10-20 10:00:00' WHERE "id" = 'c3';
  INSERT INTO "TarjetaTablero" ("id", "tableroId", "titulo", "estado", "creadoPor", "actualizadoEn", "tipoId", "repo", "plan") VALUES
    ('sin-repo', 'tab1', 'Llamar al proveedor', 'APROBADO', 'u-dueno', '2026-10-20 08:00:00', 'tarea', NULL, NULL),
    ('otro-repo', 'tab1', 'Repo raro', 'APROBADO', 'u-dueno', '2026-10-20 08:00:00', 'tarea', 'netmagi', NULL),
    ('idea-repo', 'tab1', 'Una idea', 'EN_CURSO', 'u-dueno', '2026-10-20 08:00:00', 'idea', 'aizencrm', NULL),
    ('plan-ok', 'tab1', 'Con plan', 'PLAN_APROBADO', 'u-dueno', '2026-10-20 11:00:00', 'tarea', 'gestion', 'El plan'),
    ('plan-sin', 'tab1', 'Sin plan', 'PLAN_APROBADO', 'u-dueno', '2026-10-20 07:00:00', 'tarea', 'gestion', NULL),
    ('zona', 'tab1', 'Toca el bot', 'APROBADO', 'u-dueno', '2026-10-20 06:00:00', 'tarea', 'aizencrm', NULL),
    ('borrada', 'tab1', 'Borrada', 'APROBADO', 'u-dueno', '2026-10-20 05:00:00', 'tarea', 'aizencrm', NULL),
    ('ajena', 'tab2', 'De otro negocio', 'APROBADO', 'u-dueno', '2026-10-20 04:00:00', 'tarea2', 'aizencrm', NULL);
  UPDATE "TarjetaTablero" SET "zonaProtegida" = ARRAY['LIBRO_V3'] WHERE "id" = 'zona';
  UPDATE "TarjetaTablero" SET "borradoEn" = '2026-10-20 05:30:00' WHERE "id" = 'borrada';
  INSERT INTO "HistorialTarjeta" ("id", "tarjetaId", "quien", "origen", "accion", "despues", "creadoEn") VALUES
    ('hz', 'zona', 'u-dueno', 'MCP', 'aprobar', '{"estado":"APROBADO","via":"voz"}', '2026-10-20 06:00:00');
`);

await prueba("el candado del negocio se puede pedir (advisory lock de la transacción)", async () => {
  await db.query("BEGIN");
  await db.query(sql.SQL_CANDADO_DEL_NEGOCIO, ["ws1"]);
  await db.query("COMMIT");
});

await prueba("candidatas: las mismas que tomaría y en el mismo orden, sin tomarlas; excluir salta las que chocan", async () => {
  const lista = await candidatas();
  assert.deepEqual(
    lista.map((f) => [f.id, f.estado, f.repo]),
    [
      ["c3", "APROBADO", "aizencrm"],
      ["plan-ok", "PLAN_APROBADO", "gestion"],
    ],
  );
  assert.equal(lista[1].plan, "El plan");
  assert.deepEqual(lista[0].zonaProtegida, []);
  assert.deepEqual(await hay(), [], "mirar no toma nada");
  await db.query("BEGIN");
  const [saltada] = await tomar("ws1", AHORA, EN_5_MIN, ["c3"]);
  assert.equal(saltada.id, "plan-ok", "con c3 excluida toma la que sigue");
  assert.deepEqual(await tomar("ws1", AHORA, EN_5_MIN, ["c3"]), [], "y c3 no se toma mientras esté excluida");
  await db.query("ROLLBACK");
  assert.deepEqual(await hay(), []);
});

await prueba("tomar: la más vieja con repo de la lista y tipo con aprobación; nada sin repo, de otro repo, Idea, borrada, ajena ni zona sin pantalla", async () => {
  assert.deepEqual(await hay(), []);
  const [primera] = await tomar();
  // c3 (10:00, APROBADO) es más vieja que plan-ok (11:00); plan-sin no tiene plan; zona se aprobó por voz.
  assert.deepEqual(primera, { id: "c3", tableroId: "tab1", antes: "APROBADO", estado: "PLANEANDO" });
  // Se guarda en UTC sin zona (como Prisma), sin importar la zona de la sesión.
  const [fila] = await filas(
    `SELECT "intentos", "trabajoIniciadoEn"::text AS ini, "trabajoVenceEn"::text AS vence FROM "TarjetaTablero" WHERE "id" = 'c3'`,
  );
  assert.equal(fila.intentos, 1);
  assert.equal(fila.ini, "2026-10-20 15:00:00");
  assert.equal(fila.vence, "2026-10-20 15:05:00");
  assert.deepEqual((await hay()).map((f) => f.id), ["c3"], "ahora hay candado");
  assert.deepEqual((await candidatas()).map((f) => f.id), ["plan-ok"], "la tomada ya no es candidata");
  // Con la tarjeta tomada, la que sigue es plan-ok (el servicio no llama tomar si hay candado, pero la consulta sola la ve).
  const [segunda] = await tomar();
  assert.deepEqual(segunda, { id: "plan-ok", tableroId: "tab1", antes: "PLAN_APROBADO", estado: "EN_CURSO" });
  // Ya no queda nada que tomar en ws1 (sin repo, otro repo, Idea, sin plan, zona por voz, borrada).
  assert.deepEqual(await tomar(), []);
  const intactas = await filas(
    `SELECT "id", "estado" FROM "TarjetaTablero" WHERE "id" IN ('sin-repo','otro-repo','idea-repo','plan-sin','zona','borrada','ajena') ORDER BY "id"`,
  );
  assert.deepEqual(
    intactas.map((f) => [f.id, f.estado]),
    [
      ["ajena", "APROBADO"],
      ["borrada", "APROBADO"],
      ["idea-repo", "EN_CURSO"],
      ["otro-repo", "APROBADO"],
      ["plan-sin", "PLAN_APROBADO"],
      ["sin-repo", "APROBADO"],
      ["zona", "APROBADO"],
    ],
  );
});

await prueba("vía de la aprobación (28-oct): voz + CHATS o BOT_VENTAS entra; voz + LIBRO_V3 / META_ADS no y queda en SQL_FUERA_POR_LA_VIA", async () => {
  // 'zona' (LIBRO_V3, aprobada por voz) no se tomó: es la única que espera la pantalla.
  assert.deepEqual((await fueraPorLaVia()).map((f) => [f.id, f.estado, f.zonaProtegida, f.via]), [["zona", "APROBADO", ["LIBRO_V3"], "voz"]]);
  assert.deepEqual(await fueraPorLaVia("ws2"), [], "no se ve desde otro negocio");
  await db.query("BEGIN");
  await db.exec(`
    INSERT INTO "TarjetaTablero" ("id", "tableroId", "titulo", "estado", "creadoPor", "actualizadoEn", "tipoId", "repo", "plan", "zonaProtegida") VALUES
      ('voz-chats', 'tab1', 'Chats por voz', 'APROBADO', 'u-dueno', '2026-10-20 03:00:00', 'tarea', 'aizencrm', NULL, ARRAY['CHATS']),
      ('voz-bot', 'tab1', 'Bot por voz', 'PLAN_APROBADO', 'u-dueno', '2026-10-20 03:10:00', 'tarea', 'aizencrm', 'El plan', ARRAY['BOT_VENTAS']),
      ('voz-ambas', 'tab1', 'Chats y bot por voz', 'APROBADO', 'u-dueno', '2026-10-20 03:20:00', 'tarea', 'aizencrm', NULL, ARRAY['CHATS', 'BOT_VENTAS']),
      ('voz-meta', 'tab1', 'Meta por voz', 'PLAN_APROBADO', 'u-dueno', '2026-10-20 03:30:00', 'tarea', 'aizencrm', 'El plan', ARRAY['META_ADS']),
      ('voz-mezcla', 'tab1', 'Chats y libro por voz', 'APROBADO', 'u-dueno', '2026-10-20 03:40:00', 'tarea', 'aizencrm', NULL, ARRAY['CHATS', 'LIBRO_V3']),
      ('pant-libro', 'tab1', 'Libro en pantalla', 'APROBADO', 'u-dueno', '2026-10-20 03:50:00', 'tarea', 'aizencrm', NULL, ARRAY['LIBRO_V3']),
      ('sin-aprob', 'tab1', 'Chats sin aprobación', 'APROBADO', 'u-dueno', '2026-10-20 03:55:00', 'tarea', 'aizencrm', NULL, ARRAY['CHATS']);
    INSERT INTO "HistorialTarjeta" ("id", "tarjetaId", "quien", "origen", "accion", "despues", "creadoEn") VALUES
      ('hv1', 'voz-chats', 'u-dueno', 'MCP', 'aprobar', '{"estado":"APROBADO","via":"voz"}', '2026-10-20 03:00:00'),
      ('hv2', 'voz-bot', 'u-dueno', 'MCP', 'aprobar', '{"estado":"PLAN_APROBADO","via":"voz"}', '2026-10-20 03:10:00'),
      ('hv3', 'voz-ambas', 'u-dueno', 'MCP', 'aprobar', '{"estado":"APROBADO","via":"voz"}', '2026-10-20 03:20:00'),
      ('hv4', 'voz-meta', 'u-dueno', 'MCP', 'aprobar', '{"estado":"PLAN_APROBADO","via":"voz"}', '2026-10-20 03:30:00'),
      ('hv5', 'voz-mezcla', 'u-dueno', 'MCP', 'aprobar', '{"estado":"APROBADO","via":"voz"}', '2026-10-20 03:40:00'),
      -- la última manda: primero voz, después pantalla.
      ('hv6', 'pant-libro', 'u-dueno', 'MCP', 'aprobar', '{"estado":"APROBADO","via":"voz"}', '2026-10-20 03:45:00'),
      ('hv7', 'pant-libro', 'u-dueno', 'PANTALLA', 'aprobar', '{"estado":"APROBADO","via":"pantalla"}', '2026-10-20 03:50:00');
  `);
  assert.deepEqual(
    (await candidatas()).map((f) => f.id),
    ["voz-chats", "voz-bot", "voz-ambas", "pant-libro"],
    "voz + CHATS, voz + BOT_VENTAS, voz + ambas y pantalla + LIBRO_V3 entran",
  );
  assert.deepEqual(
    (await fueraPorLaVia()).map((f) => [f.id, f.via]),
    [
      ["voz-meta", "voz"],
      ["voz-mezcla", "voz"],
      ["sin-aprob", ""],
      ["zona", "voz"],
    ],
    "voz + META_ADS, voz + CHATS y LIBRO_V3, sin aprobación y voz + LIBRO_V3 quedan fuera y avisan",
  );
  const [tomada] = await tomar();
  assert.equal(tomada.id, "voz-chats", "voz + CHATS se toma de verdad");
  await db.query("ROLLBACK");
});

await prueba("zona protegida: se toma solo si la última aprobación fue en la pantalla", async () => {
  await db.exec(`INSERT INTO "HistorialTarjeta" ("id", "tarjetaId", "quien", "origen", "accion", "despues", "creadoEn") VALUES
    ('hz2', 'zona', 'u-dueno', 'PANTALLA', 'aprobar', '{"estado":"APROBADO","via":"pantalla"}', '2026-10-20 06:30:00')`);
  assert.deepEqual(await fueraPorLaVia(), [], "aprobada en pantalla ya no espera");
  const [tomada] = await tomar();
  assert.equal(tomada.id, "zona");
  assert.equal(tomada.estado, "PLANEANDO");
});

await prueba("SUBIENDO pendiente (sin candado) se toma; con candado no", async () => {
  await db.exec(`
    INSERT INTO "TarjetaTablero" ("id", "tableroId", "titulo", "estado", "creadoPor", "actualizadoEn", "tipoId", "repo", "trabajoVenceEn") VALUES
      ('sube', 'tab1', 'Subir', 'SUBIENDO', 'u-dueno', '2026-10-20 01:00:00', 'tarea', 'gestion', NULL),
      ('sube-ya', 'tab1', 'Ya subiendo', 'SUBIENDO', 'u-dueno', '2026-10-20 00:00:00', 'tarea', 'gestion', '2026-10-20 15:10:00')`);
  const [tomada] = await tomar();
  assert.deepEqual(tomada, { id: "sube", tableroId: "tab1", antes: "SUBIENDO", estado: "SUBIENDO" });
  const [fila] = await filas(`SELECT "trabajoVenceEn" FROM "TarjetaTablero" WHERE "id" = 'sube'`);
  assert.ok(fila.trabajoVenceEn);
  assert.deepEqual(await tomar(), []);
});

await prueba("vencidas: las que pasaron su vencimiento quedan ERROR con motivo (y se conserva el resultado anterior)", async () => {
  await db.exec(`UPDATE "TarjetaTablero" SET "resultado" = '{"rama":"tablero/x"}' WHERE "id" = 'plan-ok'`);
  // A las 15:06 vencieron las tomadas a las 15:00 (vence 15:05); sube-ya vence 15:10.
  // Protocolo de reparación: las de planear/construir que vencieron por falta de latido (antes de su tope de
  // etapa) vuelven a la fila sin ERROR y sin gastar el intento; las que estaban SUBIENDO pasan a ERROR.
  // El quinto parámetro es el tope de esperas seguidas.
  const vencidas = await filas(sql.SQL_PASAR_VENCIDAS_A_ERROR, ["ws1", "2026-10-20T15:06:00.000Z", "Se pasó del tiempo en {estado}", "2026-10-20T15:06:00.000Z", 5]);
  assert.deepEqual(vencidas.map((f) => [f.id, f.antes, f.estado]).sort(), [
    ["c3", "PLANEANDO", "APROBADO"],
    ["plan-ok", "EN_CURSO", "PLAN_APROBADO"],
    ["sube", "SUBIENDO", "ERROR"],
    ["zona", "PLANEANDO", "APROBADO"],
  ]);
  const [suelta] = await filas(`SELECT "estado", "resultado", "trabajoVenceEn", "intentos" FROM "TarjetaTablero" WHERE "id" = 'plan-ok'`);
  assert.equal(suelta.estado, "PLAN_APROBADO");
  assert.equal(suelta.trabajoVenceEn, null);
  assert.equal(suelta.intentos, 0, "no gasta el intento");
  assert.equal(suelta.resultado.rama, "tablero/x", "se conserva el resultado anterior");
  const [intento] = await filas(`SELECT "categoria", "accion", "cuentaComoIntento" FROM "IntentoTarjeta" WHERE "tarjetaId" = 'plan-ok'`);
  assert.deepEqual(intento, { categoria: "coordinador_cortado", accion: "esperar", cuentaComoIntento: false });
  const [fila] = await filas(`SELECT "estado", "resultado", "trabajoVenceEn" FROM "TarjetaTablero" WHERE "id" = 'sube'`);
  assert.equal(fila.estado, "ERROR");
  assert.equal(fila.trabajoVenceEn, null);
  assert.deepEqual(fila.resultado.error, { motivo: "Se pasó del tiempo en SUBIENDO", en: "SUBIENDO", cuando: "2026-10-20T15:06:00.000Z" });
  const [escalada] = await filas(`SELECT "accion", "cuentaComoIntento", "causa", "error" FROM "IntentoTarjeta" WHERE "tarjetaId" = 'sube'`);
  assert.deepEqual([escalada.accion, escalada.cuentaComoIntento], ["escalar", true], "una tarjeta en ERROR siempre deja su motivo en el historial");
  assert.match(escalada.causa, /venció el candado en SUBIENDO sin respuesta/, "30-oct-2026: la causa dice en qué estado estaba");
  assert.equal(escalada.error, "venció el candado en SUBIENDO sin respuesta del Coordinador", "y el error ya no queda vacío");
  assert.deepEqual((await hay("ws1", "2026-10-20T15:06:00.000Z")).map((f) => f.id), ["sube-ya"]);
  // La de otro negocio, idea-repo (EN_CURSO sin candado) y sube-ya no se tocaron.
  const [idea] = await filas(`SELECT "estado" FROM "TarjetaTablero" WHERE "id" = 'idea-repo'`);
  assert.equal(idea.estado, "EN_CURSO");
});

await prueba("vencidas: construir en la nube tiene tope de 180 min (en aizen1, 90): a los 100 min sin latido la de la nube vuelve a la fila y la de aizen1 pasó su tope", async () => {
  await db.exec(`
    INSERT INTO "TarjetaTablero" ("id", "tableroId", "titulo", "estado", "creadoPor", "actualizadoEn", "tipoId", "repo", "intentos", "trabajoIniciadoEn", "trabajoVenceEn", "resultado") VALUES
      ('tp-nube', 'tab2', 'En la nube', 'EN_CURSO', 'u-dueno', now(), 'tarea2', 'aizencrm', 1, '2026-10-25 10:00:00', '2026-10-25 11:40:00', '{"construccion":{"lugar":"nube"}}'),
      ('tp-aizen', 'tab2', 'En aizen1', 'EN_CURSO', 'u-dueno', now(), 'tarea2', 'aizencrm', 1, '2026-10-25 10:00:00', '2026-10-25 11:40:00', '{"construccion":{"lugar":"aizen1"}}')`);
  const vencidas = await filas(sql.SQL_PASAR_VENCIDAS_A_ERROR, ["ws2", "2026-10-25T12:00:00.000Z", "", "2026-10-25T12:00:00.000Z", 5]);
  assert.deepEqual(
    vencidas.map((f) => [f.id, f.antes, f.estado]).sort(),
    [
      ["tp-aizen", "EN_CURSO", "ERROR"],
      ["tp-nube", "EN_CURSO", "PLAN_APROBADO"],
    ],
    "con el tope de 90 la de aizen1 ya lo pasó; la de la nube tiene hasta los 180",
  );
  // 30-oct-2026: con el motivo de entrada vacío, la tarjeta en ERROR igual queda con uno, con el estado en que estaba.
  const [enError] = await filas(`SELECT "resultado" FROM "TarjetaTablero" WHERE "id" = 'tp-aizen'`);
  assert.equal(enError.resultado.error.motivo, "venció el candado en EN_CURSO sin respuesta del Coordinador");
});

await prueba("arranque: lo que el Coordinador anterior dejó con candado vuelve a la fila, sin ERROR y sin gastar el intento", async () => {
  await db.exec(`
    INSERT INTO "TarjetaTablero" ("id", "tableroId", "titulo", "estado", "creadoPor", "actualizadoEn", "tipoId", "repo", "intentos", "trabajoVenceEn") VALUES
      ('ar-plan', 'tab2', 'Planeando', 'PLANEANDO', 'u-dueno', now(), 'tarea2', 'aizencrm', 2, '2099-01-01'),
      ('ar-obra', 'tab2', 'Construyendo', 'EN_CURSO', 'u-dueno', now(), 'tarea2', 'aizencrm', 1, '2099-01-01'),
      ('ar-sube', 'tab2', 'Subiendo', 'SUBIENDO', 'u-dueno', now(), 'tarea2', 'aizencrm', 1, '2099-01-01')`);
  const sueltas = await filas(sql.SQL_ARRANQUE, ["ws2","2026-10-24T10:00:00.000Z"]);
  assert.deepEqual(sueltas.map((f) => [f.id, f.antes]).sort(), [["ar-obra", "EN_CURSO"], ["ar-plan", "PLANEANDO"]], "SUBIENDO no se toca");
  const tarjetas = Object.fromEntries((await filas(`SELECT "id", "estado", "intentos", "trabajoVenceEn" FROM "TarjetaTablero" WHERE "id" LIKE 'ar-%'`)).map((f) => [f.id, f]));
  assert.deepEqual([tarjetas["ar-plan"].estado, tarjetas["ar-plan"].intentos, tarjetas["ar-plan"].trabajoVenceEn], ["APROBADO", 1, null]);
  assert.deepEqual([tarjetas["ar-obra"].estado, tarjetas["ar-obra"].intentos], ["PLAN_APROBADO", 0]);
  assert.equal(tarjetas["ar-sube"].estado, "SUBIENDO");
  const intentos = await filas(`SELECT "tarjetaId", "categoria", "accion", "cuentaComoIntento" FROM "IntentoTarjeta" WHERE "tarjetaId" LIKE 'ar-%' ORDER BY "tarjetaId"`);
  assert.deepEqual(intentos.map((i) => [i.tarjetaId, i.categoria, i.accion, i.cuentaComoIntento]), [
    ["ar-obra", "coordinador_cortado", "esperar", false],
    ["ar-plan", "coordinador_cortado", "esperar", false],
  ]);
  await db.exec(`DELETE FROM "TarjetaTablero" WHERE "id" LIKE 'ar-%'`);
});

await prueba("dependencias: una tarjeta no se toma hasta que de la que depende esté HECHO (y borrada no frena)", async () => {
  // Un negocio aparte para que las demás tarjetas de la prueba no se cuelen.
  await db.exec(`
    INSERT INTO "Workspace" ("id", "name", "slug", "updatedAt", "ownerId") VALUES ('ws3', 'Tercero', 'tercero', now(), NULL);
    INSERT INTO "TableroInteligente" ("id", "workspaceId", "nombre") VALUES ('tab3', 'ws3', 'Agentes');
    INSERT INTO "TipoTarjeta" ("id", "tableroId", "nombre", "requiereAprobacion", "usaEstados", "orden") VALUES ('tarea3', 'tab3', 'Tarea', true, true, 0);
    INSERT INTO "TarjetaTablero" ("id", "tableroId", "titulo", "estado", "creadoPor", "actualizadoEn", "tipoId", "repo") VALUES
      ('ventas', 'tab3', 'Agente de Ventas', 'EN_CURSO', 'u-dueno', '2026-10-20 03:00:00', 'tarea3', NULL),
      ('marketing', 'tab3', 'Agente de Marketing', 'APROBADO', 'u-dueno', '2026-10-20 02:00:00', 'tarea3', 'aizencrm');
    INSERT INTO "ConexionTarjeta" ("id", "tableroId", "origenId", "destinoId", "esDependencia") VALUES ('dep1', 'tab3', 'ventas', 'marketing', true)`);
  assert.deepEqual(await tomar("ws3"), [], "Ventas no está HECHO: Marketing espera");
  assert.deepEqual(await candidatas("ws3"), []);
  await db.exec(`UPDATE "TarjetaTablero" SET "estado" = 'HECHO' WHERE "id" = 'ventas'`);
  const [tomada] = await tomar("ws3");
  assert.equal(tomada.id, "marketing", "con Ventas HECHO, Marketing arranca");
  await db.exec(`UPDATE "TarjetaTablero" SET "estado" = 'APROBADO', "trabajoVenceEn" = NULL WHERE "id" = 'marketing'`);
  await db.exec(`UPDATE "TarjetaTablero" SET "estado" = 'EN_CURSO', "borradoEn" = now() WHERE "id" = 'ventas'`);
  assert.equal((await tomar("ws3"))[0]?.id, "marketing", "si Ventas se borró, no frena");
});

await prueba("tomar en otro negocio no ve las de este", async () => {
  const [tomada] = await tomar("ws2");
  assert.equal(tomada.id, "ajena");
  assert.deepEqual(await tomar("ws2"), []);
});

await prueba("huérfanas (26-oct-2026): PLANEANDO o EN_CURSO sin candado y sin cambios hace más de 30 min pasan a ERROR; SUBIENDO pendiente, con candado, recientes, sin repo, Idea y madres que esperan partes no", async () => {
  await db.exec(`
    INSERT INTO "Workspace" ("id", "name", "slug", "updatedAt", "ownerId") VALUES ('ws4', 'Cuarto', 'cuarto', now(), NULL);
    INSERT INTO "TableroInteligente" ("id", "workspaceId", "nombre") VALUES ('tab4', 'ws4', 'Huérfanas');
    INSERT INTO "TipoTarjeta" ("id", "tableroId", "nombre", "requiereAprobacion", "usaEstados", "orden") VALUES
      ('tarea4', 'tab4', 'Tarea', true, true, 0), ('idea4', 'tab4', 'Idea', false, true, 1);
    INSERT INTO "TarjetaTablero" ("id", "tableroId", "titulo", "estado", "creadoPor", "actualizadoEn", "tipoId", "repo", "trabajoVenceEn", "resultado") VALUES
      ('hu-plan', 'tab4', 'Planeando sin candado', 'PLANEANDO', 'u-dueno', '2026-10-26 12:00:00', 'tarea4', 'aizencrm', NULL, NULL),
      ('hu-obra', 'tab4', 'Retroactivos', 'EN_CURSO', 'u-dueno', '2026-10-26 12:00:00', 'tarea4', 'gestion', NULL, '{"previo":1}'),
      ('hu-reciente', 'tab4', 'Hace 10 min', 'EN_CURSO', 'u-dueno', '2026-10-26 19:50:00', 'tarea4', 'gestion', NULL, NULL),
      ('hu-candado', 'tab4', 'Con candado', 'EN_CURSO', 'u-dueno', '2026-10-26 12:00:00', 'tarea4', 'gestion', '2026-10-26 20:03:00', NULL),
      ('hu-sube', 'tab4', 'Subiendo pendiente', 'SUBIENDO', 'u-dueno', '2026-10-26 12:00:00', 'tarea4', 'aizencrm', NULL, NULL),
      ('hu-sin-repo', 'tab4', 'A mano', 'EN_CURSO', 'u-dueno', '2026-10-26 12:00:00', 'tarea4', NULL, NULL, NULL),
      ('hu-idea', 'tab4', 'Idea con repo', 'EN_CURSO', 'u-dueno', '2026-10-26 12:00:00', 'idea4', 'aizencrm', NULL, NULL),
      ('hu-madre', 'tab4', 'Madre esperando', 'PLANEANDO', 'u-dueno', '2026-10-26 12:00:00', 'tarea4', 'aizencrm', NULL, '{"partida":{"hijas":["hu-h1","hu-h2"]}}'),
      ('hu-h1', 'tab4', 'Parte 1', 'FALLIDO', 'u-dueno', '2026-10-26 12:00:00', 'tarea4', 'aizencrm', NULL, NULL),
      ('hu-h2', 'tab4', 'Parte 2', 'APROBADO', 'u-dueno', '2026-10-26 12:00:00', 'tarea4', 'aizencrm', NULL, NULL),
      ('hu-madre-sola', 'tab4', 'Madre sin partes vivas', 'EN_CURSO', 'u-dueno', '2026-10-26 12:00:00', 'tarea4', 'aizencrm', NULL, '{"partida":{"hijas":["hu-h3"]}}'),
      ('hu-h3', 'tab4', 'Parte borrada', 'APROBADO', 'u-dueno', '2026-10-26 12:00:00', 'tarea4', 'aizencrm', NULL, NULL);
    UPDATE "TarjetaTablero" SET "borradoEn" = '2026-10-26 13:00:00' WHERE "id" = 'hu-h3';`);

  // Las madres partidas que revisa /tomar en cada vuelta (la que espera y la que ya no tiene partes vivas).
  const madres = await filas(sql.SQL_MADRES_PARTIDAS, ["ws4"]);
  assert.deepEqual(madres.map((f) => f.id).sort(), ["hu-madre", "hu-madre-sola"]);

  const AHORA_H = "2026-10-26T20:00:00.000Z";
  const huerfanas = await filas(sql.SQL_PASAR_HUERFANAS_A_ERROR, ["ws4", AHORA_H, "", AHORA_H, 30]);
  assert.deepEqual(
    huerfanas.map((f) => [f.id, f.antes]).sort(),
    [
      ["hu-madre-sola", "EN_CURSO"],
      ["hu-obra", "EN_CURSO"],
      ["hu-plan", "PLANEANDO"],
    ],
    "solo las huérfanas de verdad (una madre sin partes vivas no espera a nadie)",
  );
  const estados = Object.fromEntries(
    (await filas(`SELECT "id", "estado", "resultado" FROM "TarjetaTablero" WHERE "id" LIKE 'hu-%'`)).map((f) => [f.id, f]),
  );
  assert.equal(estados["hu-obra"].estado, "ERROR");
  assert.equal(estados["hu-obra"].resultado.previo, 1, "conserva el resultado anterior");
  // 30-oct-2026: aunque el motivo de entrada venga vacío, queda uno con el estado en que estaba.
  assert.equal(estados["hu-obra"].resultado.error.motivo, "huérfana: EN_CURSO sin candado");
  assert.equal(estados["hu-plan"].resultado.error.motivo, "huérfana: PLANEANDO sin candado");
  assert.equal(estados["hu-obra"].resultado.error.en, "EN_CURSO");
  for (const id of ["hu-reciente", "hu-candado", "hu-sin-repo", "hu-idea"]) assert.equal(estados[id].estado, "EN_CURSO", `${id} no se toca`);
  assert.equal(estados["hu-sube"].estado, "SUBIENDO", "SUBIENDO pendiente es válida");
  assert.equal(estados["hu-madre"].estado, "PLANEANDO", "la madre espera a su parte 2");
  const intentos = await filas(
    `SELECT "tarjetaId", "etapa", "accion", "cuentaComoIntento", "causa", "error" FROM "IntentoTarjeta" WHERE "tarjetaId" LIKE 'hu-%' ORDER BY "tarjetaId"`,
  );
  assert.ok(intentos.every((i) => i.causa && i.error), "cada fila lleva su causa y su error");
  assert.match(intentos.find((i) => i.tarjetaId === "hu-plan").causa, /estaba en PLANEANDO sin el candado/);
  assert.deepEqual(intentos.map((i) => [i.tarjetaId, i.etapa, i.accion, i.cuentaComoIntento]), [
    ["hu-madre-sola", "construir", "escalar", false],
    ["hu-obra", "construir", "escalar", false],
    ["hu-plan", "planear", "escalar", false],
  ]);
  // Otra vuelta no las vuelve a tocar (ya están en ERROR), ni se ven desde otro negocio.
  assert.deepEqual(await filas(sql.SQL_PASAR_HUERFANAS_A_ERROR, ["ws4", AHORA_H, "x", AHORA_H, 30]), []);
  const deOtro = await filas(sql.SQL_PASAR_HUERFANAS_A_ERROR, ["ws1", AHORA_H, "x", AHORA_H, 30]);
  assert.ok(!deOtro.some((f) => f.id.startsWith("hu-")));
});

await db.close();
console.log(`\n${pruebas} pruebas, todas bien`);
