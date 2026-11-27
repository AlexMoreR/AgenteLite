// Tablero de Features en columnas (27-nov-2026, parte 1 de 3): el servicio que lee, sin cambiar nada, las tarjetas que cuelgan
// del Área Features y las reparte en 10 columnas por estado (services/tablero-de-features.ts) y su acción de solo lectura.
// Corre la consulta REAL en el Postgres de pruebas o en PGlite (scripts/lib/base-de-pruebas.mjs, con todas las migraciones),
// con un prisma FALSO que le pasa la consulta a esa base. No necesita base real ni red.
// Correr: npm run test:tablero-features-kanban
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { abrirBaseDePruebas } from "./lib/base-de-pruebas.mjs";
import { cargar } from "./supervisor-cargar.mjs";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CARPETA = path.join(RAIZ, "prisma", "migrations");

let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

/* ------------------------------------------------------------------ la base de pruebas */

const db = await abrirBaseDePruebas();
for (const nombre of fs.readdirSync(CARPETA, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort()) {
  try {
    await db.exec(fs.readFileSync(path.join(CARPETA, nombre, "migration.sql"), "utf8"));
  } catch (fallo) {
    throw new Error(`La migración ${nombre} falló en la base de pruebas: ${fallo.message}`);
  }
}

// El prisma falso: la consulta va a la base de pruebas; findFirst busca la T-736 en la misma base. Nada escribe.
const consultas = [];
let escrituras = 0;
const prismaFalso = {
  $queryRawUnsafe: async (texto, ...valores) => {
    consultas.push({ texto, valores });
    return (await db.query(texto, valores)).rows;
  },
  tarjetaTablero: {
    findFirst: async ({ where }) => {
      const { rows } = await db.query(
        `SELECT c."id" FROM "TarjetaTablero" c JOIN "TableroInteligente" b ON b."id" = c."tableroId"
         WHERE c."numero" = $1 AND c."borradoEn" IS NULL AND b."workspaceId" = $2 LIMIT 1`,
        [where.numero, where.tablero.workspaceId],
      );
      assert.equal(where.borradoEn, null, "la T-736 se busca sin borrar");
      return rows[0] ?? null;
    },
    update: async () => void (escrituras += 1),
    updateMany: async () => void (escrituras += 1),
  },
};
const guardado = new Map();
const servicio = cargar("src/features/tableros-inteligentes/services/tablero-de-features.ts", {
  "@/lib/prisma": { prisma: prismaFalso },
  "./coordinador-en-vivo": { leerAreaFeatures: async (negocio) => guardado.get(negocio) ?? null },
});
const { ESTADOS_TARJETA, NOMBRE_DEL_ESTADO } = cargar("src/features/tableros-inteligentes/services/reglas.ts");

const FEATURES = "area-features-0000000001";
const SUBAREA = "area-seo-000000000000001";
const OTRA_AREA = "area-ventas-0000000000001";
const AHORA = new Date("2026-11-27T15:00:00.000Z");
const hace = (dias) => new Date(AHORA.getTime() - dias * 86_400_000).toISOString();

await db.exec(`
  INSERT INTO "User" ("id", "email", "password", "updatedAt") VALUES ('u-dueno', 'dueno@x.co', 'x', now()), ('u-otro', 'otro@x.co', 'x', now());
  INSERT INTO "Workspace" ("id", "name", "slug", "updatedAt", "ownerId") VALUES
    ('ws1', 'Magilus', 'magilus', now(), 'u-dueno'),
    ('ws2', 'Otro negocio', 'otro', now(), 'u-otro');
  INSERT INTO "TableroInteligente" ("id", "workspaceId", "nombre") VALUES ('tab1', 'ws1', 'Empresa Magilus'), ('tab2', 'ws2', 'Otro');
  INSERT INTO "TipoTarjeta" ("id", "tableroId", "nombre", "requiereAprobacion", "usaEstados", "orden") VALUES
    ('area', 'tab1', 'Área', false, false, 0),
    ('tarea', 'tab1', 'Tarea', true, true, 2),
    ('tarea2', 'tab2', 'Tarea', true, true, 2);
  INSERT INTO "TarjetaTablero" ("id", "numero", "tableroId", "titulo", "estado", "creadoPor", "creadoEn", "actualizadoEn", "tipoId", "repo", "padreId", "prioridad", "urgente", "area") VALUES
    ('${FEATURES}', 736, 'tab1', 'Features', 'IDEA', 'u-dueno', '2026-10-01 08:00:00', '2026-10-01 08:00:00', 'area', NULL, NULL, 'MEDIA', false, NULL),
    ('${SUBAREA}', 801, 'tab1', 'SEO Magilus', 'IDEA', 'u-dueno', '2026-10-01 08:00:00', '2026-10-01 08:00:00', 'area', NULL, '${FEATURES}', 'MEDIA', false, NULL),
    ('${OTRA_AREA}', 802, 'tab1', 'Ventas', 'IDEA', 'u-dueno', '2026-10-01 08:00:00', '2026-10-01 08:00:00', 'area', NULL, NULL, 'MEDIA', false, NULL),
    ('t-tarea', 900, 'tab1', 'Tarea de SEO', 'EN_CURSO', 'u-dueno', '2026-11-20 08:00:00', '2026-11-26 08:00:00', 'tarea', 'aizencrm', '${SUBAREA}', 'ALTA', false, NULL),
    ('t-parte', 901, 'tab1', 'Parte de la tarea', 'PLAN_APROBADO', 'u-dueno', '2026-11-20 08:00:00', '2026-11-26 09:00:00', 'tarea', 'gestion', 't-tarea', 'MEDIA', false, NULL),
    ('t-idea', 902, 'tab1', 'Idea suelta en Features', 'IDEA', 'u-dueno', '2026-11-20 08:00:00', '2026-11-26 10:00:00', 'tarea', NULL, '${FEATURES}', 'BAJA', true, NULL),
    ('t-propia', 903, 'tab1', 'Con área propia', 'APROBADO', 'u-dueno', '2026-11-20 08:00:00', '2026-11-26 11:00:00', 'tarea', 'aizencrm', '${SUBAREA}', 'MEDIA', false, 'Pagos'),
    ('t-hecho-sin-archivar', 904, 'tab1', 'Hecha hace un mes, sin archivar', 'HECHO', 'u-dueno', '2026-10-20 08:00:00', '2026-10-26 08:00:00', 'tarea', 'aizencrm', '${SUBAREA}', 'MEDIA', false, NULL),
    ('t-hecho-3', 905, 'tab1', 'Hecha y archivada hace 3 días', 'HECHO', 'u-dueno', '2026-11-20 08:00:00', '2026-11-24 08:00:00', 'tarea', 'aizencrm', '${SUBAREA}', 'MEDIA', false, NULL),
    ('t-hecho-10', 906, 'tab1', 'Hecha y archivada hace 10 días', 'HECHO', 'u-dueno', '2026-11-10 08:00:00', '2026-11-17 08:00:00', 'tarea', 'aizencrm', '${SUBAREA}', 'MEDIA', false, NULL),
    ('t-fallido-2', 907, 'tab1', 'Fallida y archivada hace 2 días', 'FALLIDO', 'u-dueno', '2026-11-20 08:00:00', '2026-11-25 08:00:00', 'tarea', 'gestion', '${SUBAREA}', 'MEDIA', false, NULL),
    ('t-fallido-viejo', 908, 'tab1', 'Fallida sin archivar, vieja', 'FALLIDO', 'u-dueno', '2026-10-01 08:00:00', '2026-10-02 08:00:00', 'tarea', 'gestion', '${SUBAREA}', 'MEDIA', false, NULL),
    ('t-archivada-en-curso', 909, 'tab1', 'Archivada sin terminar', 'EN_CURSO', 'u-dueno', '2026-11-20 08:00:00', '2026-11-26 08:00:00', 'tarea', 'aizencrm', '${SUBAREA}', 'MEDIA', false, NULL),
    ('t-borrada', 910, 'tab1', 'Borrada', 'APROBADO', 'u-dueno', '2026-11-20 08:00:00', '2026-11-26 08:00:00', 'tarea', 'aizencrm', '${SUBAREA}', 'MEDIA', false, NULL),
    ('t-bajo-borrada', 911, 'tab1', 'Cuelga de una borrada', 'APROBADO', 'u-dueno', '2026-11-20 08:00:00', '2026-11-26 08:00:00', 'tarea', 'aizencrm', 't-borrada', 'MEDIA', false, NULL),
    ('t-fuera', 912, 'tab1', 'De Ventas', 'APROBADO', 'u-dueno', '2026-11-20 08:00:00', '2026-11-26 08:00:00', 'tarea', 'aizencrm', '${OTRA_AREA}', 'MEDIA', false, NULL),
    ('t-suelta', 913, 'tab1', 'Suelta sin área', 'APROBADO', 'u-dueno', '2026-11-20 08:00:00', '2026-11-26 08:00:00', 'tarea', 'aizencrm', NULL, 'MEDIA', false, NULL),
    ('t-otro-negocio', 914, 'tab2', 'De otro negocio', 'APROBADO', 'u-otro', '2026-11-20 08:00:00', '2026-11-26 08:00:00', 'tarea2', 'aizencrm', '${FEATURES}', 'MEDIA', false, NULL);
  UPDATE "TarjetaTablero" SET "archivadaEn" = '${hace(3)}', "terminadaEn" = '${hace(3)}' WHERE "id" = 't-hecho-3';
  UPDATE "TarjetaTablero" SET "archivadaEn" = '${hace(10)}', "terminadaEn" = '${hace(10)}' WHERE "id" = 't-hecho-10';
  UPDATE "TarjetaTablero" SET "archivadaEn" = '${hace(2)}', "terminadaEn" = '${hace(2)}' WHERE "id" = 't-fallido-2';
  UPDATE "TarjetaTablero" SET "terminadaEn" = '${hace(40)}' WHERE "id" IN ('t-hecho-sin-archivar', 't-fallido-viejo');
  UPDATE "TarjetaTablero" SET "archivadaEn" = '${hace(1)}' WHERE "id" = 't-archivada-en-curso';
  UPDATE "TarjetaTablero" SET "borradoEn" = '${hace(1)}' WHERE "id" = 't-borrada';
`);

const contarFilas = async () => (await db.query(`SELECT count(*)::int AS n, max("actualizadoEn") AS m FROM "TarjetaTablero"`)).rows[0];
const antes = await contarFilas();

/* ------------------------------------------------------------------ 1. columnas y estados */

const ORDEN = [
  ["POR_APROBAR", "Por aprobar"],
  ["APROBADO", "Aprobado (en fila)"],
  ["PLANEANDO", "Planeando"],
  ["PLAN_LISTO", "Plan listo"],
  ["EN_CURSO", "En curso"],
  ["POR_REVISAR", "Por revisar"],
  ["SUBIENDO", "Subiendo"],
  ["ERROR", "Error"],
  ["HECHO", "Hecho (últimos 7 días)"],
  ["FALLIDO", "Fallido"],
];

await prueba("COLUMNAS_DE_FEATURES: exactamente las 10 claves y nombres, en el orden pedido", async () => {
  assert.deepEqual(servicio.COLUMNAS_DE_FEATURES.map((c) => [c.clave, c.nombre]), ORDEN);
});

await prueba("columnaDelEstado: cada estado del enum va a una sola columna; IDEA a «Por aprobar» con esIdea; APROBADO y PLAN_APROBADO juntos", async () => {
  const enum_ = fs.readFileSync(path.join(RAIZ, "prisma", "schema.prisma"), "utf8").match(/enum EstadoTarjeta \{([^}]*)\}/)[1].trim().split(/\s+/);
  assert.deepEqual([...ESTADOS_TARJETA].sort(), [...enum_].sort(), "ESTADOS_TARJETA es el enum de Prisma");
  const esperado = {
    IDEA: "POR_APROBAR", POR_APROBAR: "POR_APROBAR", APROBADO: "APROBADO", PLAN_APROBADO: "APROBADO", PLANEANDO: "PLANEANDO",
    PLAN_LISTO: "PLAN_LISTO", EN_CURSO: "EN_CURSO", POR_REVISAR: "POR_REVISAR", SUBIENDO: "SUBIENDO", ERROR: "ERROR", HECHO: "HECHO", FALLIDO: "FALLIDO",
  };
  const claves = new Set(ORDEN.map(([c]) => c));
  for (const estado of enum_) {
    const { clave, esIdea } = servicio.columnaDelEstado(estado);
    assert.equal(clave, esperado[estado], estado);
    assert.ok(claves.has(clave), `${estado} va a una columna que existe`);
    assert.equal(esIdea, estado === "IDEA", `${estado}: esIdea`);
    assert.ok(NOMBRE_DEL_ESTADO[estado], `${estado} tiene nombre`);
  }
});

/* ------------------------------------------------------------------ 2. repo y filtros */

await prueba("etiquetaDelRepo: gestion → Gestión, aizencrm → CRM y vacío → Sin repo", async () => {
  assert.equal(servicio.etiquetaDelRepo("gestion"), "Gestión");
  assert.equal(servicio.etiquetaDelRepo("aizencrm"), "CRM");
  for (const vacio of [null, undefined, "", "   "]) assert.equal(servicio.etiquetaDelRepo(vacio), "Sin repo", String(vacio));
});

await prueba("filtrarTarjetas: área, repo y prioridad se combinan entre sí; sin filtros salen todas", async () => {
  const lista = [
    { id: "a", area: "SEO", repo: "CRM", prioridad: "ALTA" },
    { id: "b", area: "SEO", repo: "Gestión", prioridad: "ALTA" },
    { id: "c", area: "SEO", repo: "CRM", prioridad: "BAJA" },
    { id: "d", area: "Pagos", repo: "CRM", prioridad: "ALTA" },
    { id: "e", area: null, repo: "Sin repo", prioridad: "MEDIA" },
  ];
  const ids = (f) => servicio.filtrarTarjetas(lista, f).map((t) => t.id);
  assert.deepEqual(ids({}), ["a", "b", "c", "d", "e"]);
  assert.deepEqual(ids({ area: "SEO" }), ["a", "b", "c"]);
  assert.deepEqual(ids({ area: "SEO", repo: "CRM" }), ["a", "c"]);
  assert.deepEqual(ids({ area: "SEO", repo: "CRM", prioridad: "ALTA" }), ["a"]);
  assert.deepEqual(ids({ repo: "aizencrm", prioridad: "ALTA" }), ["a", "d"], "el repo también vale por su nombre en la base");
  assert.deepEqual(ids({ repo: "Gestión" }), ["b"]);
  assert.deepEqual(ids({ repo: "Sin repo" }), ["e"]);
  assert.deepEqual(ids({ area: "", repo: null, prioridad: "  " }), ["a", "b", "c", "d", "e"], "filtros vacíos no filtran");
});

/* ------------------------------------------------------------------ 3. la consulta real */

guardado.set("ws1", FEATURES);
const tablero = await servicio.tableroDeFeatures("ws1", AHORA);
const todas = tablero.columnas.flatMap((c) => c.tarjetas);
const porId = new Map(todas.map((t) => [t.id, t]));
const enColumna = (clave) => tablero.columnas.find((c) => c.clave === clave).tarjetas.map((t) => t.id);

await prueba("la SQL es recursiva, de solo lectura, con tope de 50 niveles y 500 tarjetas, y el corte de 7 días va como dato", async () => {
  const sql = servicio.SQL_TABLERO_DE_FEATURES;
  assert.match(sql, /WITH RECURSIVE baja/);
  assert.match(sql, /"nivel" < 50/);
  assert.match(sql, /LIMIT 500/);
  assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|MERGE|TRUNCATE|ALTER|DROP|CREATE)\b/i, "solo lee");
  assert.doesNotMatch(sql, /now\(\)|interval|ANY_VALUE|JSON_TABLE|json_scalar|\bMERGE\b/i, "nada de funciones de Postgres 16 ni de la hora del servidor");
  assert.equal(servicio.MAX_TARJETAS_DE_FEATURES, 500);
  assert.equal(consultas.length, 1);
  assert.deepEqual(consultas[0].valores.slice(0, 2), [FEATURES, "ws1"]);
  assert.equal(consultas[0].valores[2].toISOString(), hace(7), "el corte = ahora menos 7 días");
});

await prueba("trae una nieta de Features (Features > sub-área > tarea > parte), pero no una borrada, de otro negocio ni de fuera de Features", async () => {
  assert.equal(tablero.areaFeaturesId, FEATURES);
  assert.equal(tablero.error, undefined);
  for (const id of ["t-tarea", "t-parte", "t-idea", "t-propia"]) assert.ok(porId.has(id), `trae ${id}`);
  for (const id of ["t-borrada", "t-bajo-borrada", "t-otro-negocio", "t-fuera", "t-suelta"]) assert.ok(!porId.has(id), `no trae ${id}`);
  for (const id of [FEATURES, SUBAREA, OTRA_AREA]) assert.ok(!porId.has(id), `las Áreas (carpetas) no salen como tarjeta: ${id}`);
  const parte = porId.get("t-parte");
  assert.deepEqual(Object.keys(parte).sort(), ["archivada", "area", "codigo", "esIdea", "estado", "id", "prioridad", "repo", "titulo"]);
  assert.equal(parte.codigo, "T-901");
  assert.equal(parte.repo, "Gestión");
  assert.equal(parte.estado, "PLAN_APROBADO");
  assert.deepEqual(enColumna("APROBADO").sort(), ["t-parte", "t-propia"], "APROBADO y PLAN_APROBADO juntos");
  assert.deepEqual(enColumna("EN_CURSO"), ["t-tarea"]);
  assert.deepEqual(enColumna("POR_APROBAR"), ["t-idea"]);
  assert.equal(porId.get("t-idea").esIdea, true);
  assert.equal(porId.get("t-idea").repo, "Sin repo");
  assert.equal(porId.get("t-idea").prioridad, "URGENTE", "la marca urgente manda (prioridadDeLaTarjeta)");
  assert.equal(porId.get("t-tarea").prioridad, "ALTA");
  assert.equal(porId.get("t-tarea").repo, "CRM");
});

await prueba("el corte de 7 días: una HECHO archivada hace 3 días entra y una de hace 10 días no; las sin archivar entran todas", async () => {
  assert.ok(porId.has("t-hecho-3"), "archivada hace 3 días");
  assert.equal(porId.get("t-hecho-3").archivada, true);
  assert.ok(!porId.has("t-hecho-10"), "archivada hace 10 días");
  assert.ok(porId.has("t-hecho-sin-archivar"), "sin archivar, aunque sea vieja, entra");
  assert.equal(porId.get("t-hecho-sin-archivar").archivada, false);
  assert.deepEqual(enColumna("HECHO").sort(), ["t-hecho-3", "t-hecho-sin-archivar"]);
  assert.deepEqual(enColumna("FALLIDO").sort(), ["t-fallido-2", "t-fallido-viejo"], "Fallido = sin archivar + archivadas de los últimos 7 días");
  assert.ok(!porId.has("t-archivada-en-curso"), "una archivada que no es HECHO ni FALLIDO no entra");
});

await prueba("el área heredada: de la carpeta más cercana (como filasDeTabla); la propia manda; la lista de áreas", async () => {
  assert.equal(porId.get("t-tarea").area, "SEO Magilus");
  assert.equal(porId.get("t-parte").area, "SEO Magilus", "la parte hereda pasando por su tarea madre");
  assert.equal(porId.get("t-propia").area, "Pagos", "la propia manda");
  assert.equal(porId.get("t-idea").area, "Features", "colgada directo de Features");
  assert.deepEqual(tablero.areas, ["Features", "Pagos", "SEO Magilus"]);
  assert.deepEqual(servicio.filtrarTarjetas(todas, { area: "SEO Magilus", repo: "gestion" }).map((t) => t.id).sort(), ["t-fallido-2", "t-fallido-viejo", "t-parte"]);
});

await prueba("idDeFeatures: primero el guardado; si no hay, la T-736 del negocio; si tampoco, null y el error", async () => {
  assert.equal(await servicio.idDeFeatures("ws1"), FEATURES, "el guardado");
  guardado.delete("ws1");
  assert.equal(await servicio.idDeFeatures("ws1"), FEATURES, "la T-736 del negocio");
  assert.deepEqual(enColumna("EN_CURSO"), ["t-tarea"]);
  const otro = await servicio.tableroDeFeatures("ws2", AHORA);
  assert.equal(otro.areaFeaturesId, null, "otro negocio no ve la T-736 de este");
  assert.equal(otro.error, "No se encontró el Área Features");
  assert.deepEqual(otro.columnas.map((c) => [c.clave, c.nombre]), ORDEN);
  assert.ok(otro.columnas.every((c) => c.tarjetas.length === 0));
  const sinTarjeta = await servicio.tableroDeFeatures("ws-nada", AHORA);
  assert.equal(sinTarjeta.error, "No se encontró el Área Features");
  guardado.set("ws1", FEATURES);
});

await prueba("solo lee: ninguna fila cambió y no se llamó a nada que escriba", async () => {
  assert.deepEqual(await contarFilas(), antes);
  assert.equal(escrituras, 0);
});

await db.close();

/* ------------------------------------------------------------------ 4. la acción */

await prueba("la acción: 'use server', revisa la sesión y personaPuedeAprobar, solo llama a tableroDeFeatures y no importa acciones de cambio de estado", async () => {
  const texto = fs.readFileSync(path.join(RAIZ, "src/app/actions/tablero-ia-features-actions.ts"), "utf8");
  assert.match(texto, /^"use server";/);
  assert.match(texto, /export async function tableroDeFeaturesAction\(/);
  assert.match(texto, /requireClientWorkspaceAccess\("tableros_inteligentes"\)/);
  assert.match(texto, /if \(!personaPuedeAprobar\(access\)\) return \{ ok: false, error: /);
  assert.match(texto, /tableroDeFeatures\(access\.workspaceId\)/);
  const imports = [...texto.matchAll(/^import[\s\S]*?from\s+"([^"]+)";/gm)].map((m) => [m[0], m[1]]);
  assert.deepEqual(imports.map(([, de]) => de).sort(), [
    "@/features/tableros-inteligentes/services/reglas",
    "@/features/tableros-inteligentes/services/tablero-de-features",
    "@/lib/client-workspace-access",
  ]);
  for (const [linea] of imports) {
    assert.doesNotMatch(linea, /cambiarEstado|editarTarjeta|aprobar[A-Z]|archivar|borrar|mover|actions/i, linea);
  }
  const permiso = texto.indexOf("personaPuedeAprobar(access)");
  assert.ok(permiso > 0 && permiso < texto.indexOf("tableroDeFeatures(access"), "el permiso se revisa antes de leer");
});

await prueba("package.json tiene test:tablero-features-kanban (npm test corre todos los test:*)", async () => {
  const paquete = JSON.parse(fs.readFileSync(path.join(RAIZ, "package.json"), "utf8"));
  assert.equal(paquete.scripts["test:tablero-features-kanban"], "node scripts/check-tablero-features-kanban.mjs");
});

console.log(`\n${pruebas} pruebas OK`);
