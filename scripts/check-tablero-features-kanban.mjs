// Tablero de Features en columnas (27-nov-2026, parte 1 de 3): el servicio que LEE lo que cuelga de Features
// (services/tablero-de-features.ts) y la acción del servidor que lo entrega (src/app/actions/tablero-ia-features-actions.ts).
// Carga el servicio real con supervisor-cargar.mjs y corre su SQL en la base de pruebas (el Postgres de pruebas o PGlite, con
// todas las migraciones), con un prisma FALSO que manda las consultas a esa base. No necesita base real ni red.
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

/* ------------------------------------------------------------------ la base de pruebas y el prisma falso */

const db = await abrirBaseDePruebas();
for (const nombre of fs.readdirSync(CARPETA, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort()) {
  try {
    await db.exec(fs.readFileSync(path.join(CARPETA, nombre, "migration.sql"), "utf8"));
  } catch (fallo) {
    throw new Error(`La migración ${nombre} falló en la base de pruebas: ${fallo.message}`);
  }
}

const ajustes = new Map();
const consultas = [];
const prismaFalso = {
  $queryRawUnsafe: async (texto, ...valores) => {
    consultas.push(texto);
    return (await db.query(texto, valores)).rows;
  },
  appSetting: {
    findUnique: async ({ where }) => (ajustes.has(where.key) ? { value: ajustes.get(where.key) } : null),
  },
};
class ErrorDelTrabajador extends Error {}
const trabajadorFalso = { ErrorDelTrabajador };
const servicio = cargar("src/features/tableros-inteligentes/services/tablero-de-features.ts", {
  "@/lib/prisma": { prisma: prismaFalso },
  "@prisma/client": { Prisma: {} },
  "./trabajador": trabajadorFalso,
  "@/features/tableros-inteligentes/services/trabajador": trabajadorFalso,
  "./tableros": { linkDeLaTarjeta: (id) => `https://app.aizenbot.com/cliente/tablero-ia?tarjeta=${id}` },
  "@/features/alertas/servicios/alertas": { registrarAlerta: async () => ({ id: null, creada: false, salioPorWhatsApp: false }), resolverAlertasPorClave: async () => 0 },
});
const reglas = cargar("src/features/tableros-inteligentes/services/reglas.ts");

/* ------------------------------------------------------------------ 1. columnas y estados */

const ORDEN = [
  ["por_aprobar", "Por aprobar"],
  ["aprobado", "Aprobado (en fila)"],
  ["planeando", "Planeando"],
  ["plan_listo", "Plan listo"],
  ["en_curso", "En curso"],
  ["por_revisar", "Por revisar"],
  ["subiendo", "Subiendo"],
  ["error", "Error"],
  ["hecho", "Hecho (últimos 7 días)"],
  ["fallido", "Fallido"],
];

await prueba("COLUMNAS_DE_FEATURES: exactamente las 10 columnas, con su clave y su nombre, en el orden pedido", async () => {
  assert.deepEqual(servicio.COLUMNAS_DE_FEATURES.map((c) => [c.clave, c.nombre]), ORDEN);
});

await prueba("columnaDelEstado: cada estado del enum de Prisma va a una sola columna; IDEA en «Por aprobar» con esIdea", async () => {
  const esquema = fs.readFileSync(path.join(RAIZ, "prisma", "schema.prisma"), "utf8");
  const delEnum = esquema.match(/enum EstadoTarjeta \{([^}]*)\}/)[1].split(/\s+/).filter(Boolean);
  assert.deepEqual([...delEnum].sort(), [...reglas.ESTADOS_TARJETA].sort(), "ESTADOS_TARJETA coincide con el enum");
  assert.deepEqual(Object.keys(reglas.NOMBRE_DEL_ESTADO).sort(), [...delEnum].sort());
  const esperado = {
    IDEA: "por_aprobar",
    POR_APROBAR: "por_aprobar",
    APROBADO: "aprobado",
    PLAN_APROBADO: "aprobado",
    PLANEANDO: "planeando",
    PLAN_LISTO: "plan_listo",
    EN_CURSO: "en_curso",
    POR_REVISAR: "por_revisar",
    SUBIENDO: "subiendo",
    ERROR: "error",
    HECHO: "hecho",
    FALLIDO: "fallido",
  };
  const claves = new Set(servicio.COLUMNAS_DE_FEATURES.map((c) => c.clave));
  for (const estado of delEnum) {
    const { clave, esIdea } = servicio.columnaDelEstado(estado);
    assert.equal(clave, esperado[estado], estado);
    assert.ok(claves.has(clave), `${estado} va a una columna que existe`);
    assert.equal(esIdea, estado === "IDEA", `esIdea de ${estado}`);
  }
});

/* ------------------------------------------------------------------ 2. etiquetas y filtros */

await prueba("etiquetaDelRepo: gestion → Gestión, aizencrm → CRM, vacío → Sin repo", async () => {
  assert.equal(servicio.etiquetaDelRepo("gestion"), "Gestión");
  assert.equal(servicio.etiquetaDelRepo(" Gestion "), "Gestión");
  assert.equal(servicio.etiquetaDelRepo("aizencrm"), "CRM");
  for (const vacio of [null, undefined, "", "   "]) assert.equal(servicio.etiquetaDelRepo(vacio), "Sin repo", String(vacio));
});

await prueba("filtrarTarjetas: área, repo y prioridad se combinan entre sí; sin filtros salen todas", async () => {
  const lista = [
    { id: "a", area: "SEO", repo: "gestion", prioridad: "ALTA" },
    { id: "b", area: "SEO", repo: "aizencrm", prioridad: "ALTA" },
    { id: "c", area: "Ventas", repo: "gestion", prioridad: "MEDIA" },
    { id: "d", area: "SEO", repo: null, prioridad: "MEDIA" },
  ];
  const ids = (filtros) => servicio.filtrarTarjetas(lista, filtros).map((t) => t.id);
  assert.deepEqual(ids({}), ["a", "b", "c", "d"]);
  assert.deepEqual(ids({ area: "SEO" }), ["a", "b", "d"]);
  assert.deepEqual(ids({ repo: "gestion" }), ["a", "c"]);
  assert.deepEqual(ids({ repo: "Gestión" }), ["a", "c"], "acepta la etiqueta");
  assert.deepEqual(ids({ repo: "CRM" }), ["b"]);
  assert.deepEqual(ids({ repo: "Sin repo" }), ["d"]);
  assert.deepEqual(ids({ prioridad: "ALTA" }), ["a", "b"]);
  assert.deepEqual(ids({ area: "SEO", repo: "gestion" }), ["a"]);
  assert.deepEqual(ids({ area: "SEO", prioridad: "MEDIA" }), ["d"]);
  assert.deepEqual(ids({ area: "SEO", repo: "gestion", prioridad: "MEDIA" }), []);
  assert.deepEqual(ids({ area: "", repo: null, prioridad: undefined }), ["a", "b", "c", "d"], "vacío no filtra");
});

/* ------------------------------------------------------------------ 3. el SQL en la base de pruebas */

const AHORA = new Date("2026-11-27T15:00:00.000Z");
const haceDias = (dias) => new Date(AHORA.getTime() - dias * 24 * 60 * 60 * 1000).toISOString();
const FEATURES = "area-features-0000000001";
const SUBAREA = "area-seo-000000000000001";
const OTRA_AREA = "area-ventas-0000000000001";

await db.exec(`
  INSERT INTO "User" ("id", "email", "password", "updatedAt") VALUES ('u-dueno', 'dueno@x.co', 'x', now()), ('u-otro', 'otro@x.co', 'x', now());
  INSERT INTO "Workspace" ("id", "name", "slug", "updatedAt", "ownerId") VALUES
    ('ws1', 'Magilus', 'magilus', now(), 'u-dueno'),
    ('ws2', 'Otro negocio', 'otro', now(), 'u-otro');
  INSERT INTO "TableroInteligente" ("id", "workspaceId", "nombre") VALUES ('tab1', 'ws1', 'Empresa Magilus'), ('tab2', 'ws2', 'Otro');
  INSERT INTO "TipoTarjeta" ("id", "tableroId", "nombre", "requiereAprobacion", "usaEstados", "orden") VALUES
    ('area', 'tab1', 'Área', false, false, 0),
    ('idea', 'tab1', 'Idea', false, true, 1),
    ('tarea', 'tab1', 'Tarea', true, true, 2),
    ('tarea2', 'tab2', 'Tarea', true, true, 2);
  INSERT INTO "TarjetaTablero" ("id", "numero", "tableroId", "titulo", "estado", "creadoPor", "creadoEn", "actualizadoEn", "tipoId", "repo", "padreId", "area", "prioridad", "urgente") VALUES
    ('${FEATURES}', 736, 'tab1', 'Features', 'IDEA', 'u-dueno', '2026-10-01 08:00:00', '2026-10-01 08:00:00', 'area', NULL, NULL, NULL, 'MEDIA', false),
    ('${SUBAREA}', 801, 'tab1', 'SEO Magilus', 'IDEA', 'u-dueno', '2026-10-01 08:00:00', '2026-10-01 08:00:00', 'area', NULL, '${FEATURES}', NULL, 'MEDIA', false),
    ('${OTRA_AREA}', 802, 'tab1', 'Ventas', 'IDEA', 'u-dueno', '2026-10-01 08:00:00', '2026-10-01 08:00:00', 'area', NULL, NULL, NULL, 'MEDIA', false),
    ('k-tarea', 810, 'tab1', 'Tarea de SEO', 'EN_CURSO', 'u-dueno', '2026-11-20 08:00:00', '2026-11-26 08:00:00', 'tarea', 'aizencrm', '${SUBAREA}', NULL, 'ALTA', false),
    ('k-parte', 811, 'tab1', 'Parte 1 de la tarea', 'PLANEANDO', 'u-dueno', '2026-11-20 08:00:00', '2026-11-26 09:00:00', 'tarea', 'gestion', 'k-tarea', NULL, 'MEDIA', false),
    ('k-propia', 812, 'tab1', 'Con área propia', 'PLAN_APROBADO', 'u-dueno', '2026-11-20 08:00:00', '2026-11-25 08:00:00', 'tarea', 'gestion', '${SUBAREA}', 'Pagos', 'BAJA', false),
    ('k-idea', 813, 'tab1', 'Idea suelta en Features', 'IDEA', 'u-dueno', '2026-11-20 08:00:00', '2026-11-25 08:00:00', 'idea', NULL, '${FEATURES}', NULL, 'MEDIA', true),
    ('k-aprobado', 814, 'tab1', 'Aprobada en fila', 'APROBADO', 'u-dueno', '2026-11-20 08:00:00', '2026-11-25 07:00:00', 'tarea', 'aizencrm', '${FEATURES}', NULL, 'MEDIA', false),
    ('k-hecho-3', 815, 'tab1', 'Hecha hace 3 días', 'HECHO', 'u-dueno', '2026-11-20 08:00:00', '2026-11-24 08:00:00', 'tarea', 'aizencrm', '${SUBAREA}', NULL, 'MEDIA', false),
    ('k-hecho-10', 816, 'tab1', 'Hecha hace 10 días', 'HECHO', 'u-dueno', '2026-11-10 08:00:00', '2026-11-17 08:00:00', 'tarea', 'aizencrm', '${SUBAREA}', NULL, 'MEDIA', false),
    ('k-hecho-viejo', 817, 'tab1', 'Hecha hace 20 días, sin archivar', 'HECHO', 'u-dueno', '2026-11-01 08:00:00', '2026-11-07 08:00:00', 'tarea', 'gestion', '${SUBAREA}', NULL, 'MEDIA', false),
    ('k-fallido-3', 818, 'tab1', 'Fallida hace 3 días, archivada', 'FALLIDO', 'u-dueno', '2026-11-20 08:00:00', '2026-11-24 08:00:00', 'tarea', 'aizencrm', '${SUBAREA}', NULL, 'MEDIA', false),
    ('k-fallido-10', 819, 'tab1', 'Fallida hace 10 días, archivada', 'FALLIDO', 'u-dueno', '2026-11-10 08:00:00', '2026-11-17 08:00:00', 'tarea', 'aizencrm', '${SUBAREA}', NULL, 'MEDIA', false),
    ('k-fallido-vivo', 820, 'tab1', 'Fallida sin archivar', 'FALLIDO', 'u-dueno', '2026-10-10 08:00:00', '2026-10-17 08:00:00', 'tarea', 'aizencrm', '${SUBAREA}', NULL, 'MEDIA', false),
    ('k-aprob-archivada', 821, 'tab1', 'Aprobada pero archivada', 'APROBADO', 'u-dueno', '2026-11-20 08:00:00', '2026-11-26 08:00:00', 'tarea', 'aizencrm', '${SUBAREA}', NULL, 'MEDIA', false),
    ('k-madre-vieja', 822, 'tab1', 'Madre hecha hace un mes', 'HECHO', 'u-dueno', '2026-10-01 08:00:00', '2026-10-27 08:00:00', 'tarea', 'aizencrm', '${SUBAREA}', NULL, 'MEDIA', false),
    ('k-hija', 823, 'tab1', 'Hija de la madre archivada', 'POR_REVISAR', 'u-dueno', '2026-11-20 08:00:00', '2026-11-26 10:00:00', 'tarea', 'aizencrm', 'k-madre-vieja', NULL, 'MEDIA', false),
    ('k-borrada', 824, 'tab1', 'Borrada', 'EN_CURSO', 'u-dueno', '2026-11-20 08:00:00', '2026-11-26 08:00:00', 'tarea', 'aizencrm', '${SUBAREA}', NULL, 'MEDIA', false),
    ('k-bajo-borrada', 825, 'tab1', 'Cuelga de una borrada', 'EN_CURSO', 'u-dueno', '2026-11-20 08:00:00', '2026-11-26 08:00:00', 'tarea', 'aizencrm', 'k-borrada', NULL, 'MEDIA', false),
    ('k-fuera', 826, 'tab1', 'De Ventas, fuera de Features', 'EN_CURSO', 'u-dueno', '2026-11-20 08:00:00', '2026-11-26 08:00:00', 'tarea', 'aizencrm', '${OTRA_AREA}', NULL, 'MEDIA', false),
    ('k-otro-negocio', 827, 'tab2', 'De otro negocio colgada de Features', 'EN_CURSO', 'u-otro', '2026-11-20 08:00:00', '2026-11-26 08:00:00', 'tarea2', 'aizencrm', '${FEATURES}', NULL, 'MEDIA', false);
  UPDATE "TarjetaTablero" SET "terminadaEn" = '${haceDias(3)}'::timestamptz AT TIME ZONE 'UTC', "archivadaEn" = '${haceDias(2)}'::timestamptz AT TIME ZONE 'UTC' WHERE "id" IN ('k-hecho-3', 'k-fallido-3');
  UPDATE "TarjetaTablero" SET "terminadaEn" = '${haceDias(10)}'::timestamptz AT TIME ZONE 'UTC', "archivadaEn" = '${haceDias(9)}'::timestamptz AT TIME ZONE 'UTC' WHERE "id" IN ('k-hecho-10', 'k-fallido-10');
  UPDATE "TarjetaTablero" SET "terminadaEn" = '${haceDias(20)}'::timestamptz AT TIME ZONE 'UTC' WHERE "id" IN ('k-hecho-viejo', 'k-fallido-vivo');
  UPDATE "TarjetaTablero" SET "archivadaEn" = '${haceDias(1)}'::timestamptz AT TIME ZONE 'UTC' WHERE "id" = 'k-aprob-archivada';
  UPDATE "TarjetaTablero" SET "terminadaEn" = '${haceDias(31)}'::timestamptz AT TIME ZONE 'UTC', "archivadaEn" = '${haceDias(30)}'::timestamptz AT TIME ZONE 'UTC' WHERE "id" = 'k-madre-vieja';
  UPDATE "TarjetaTablero" SET "borradoEn" = '2026-11-26 09:00:00' WHERE "id" = 'k-borrada';
`);

const tablero = await servicio.tableroDeFeatures("ws1", AHORA);
const todas = tablero.columnas.flatMap((c) => c.tarjetas);
const porId = new Map(todas.map((t) => [t.id, t]));
const columnaDe = (id) => tablero.columnas.find((c) => c.tarjetas.some((t) => t.id === id))?.clave ?? null;

await prueba("la SQL corre en la base de pruebas y trae la nieta de Features (Features > sub-área > tarea > parte)", async () => {
  assert.equal(tablero.error, undefined);
  assert.equal(tablero.areaFeaturesId, FEATURES, "sin id guardado, usa la T-736 del negocio");
  assert.deepEqual(tablero.columnas.map((c) => [c.clave, c.nombre]), ORDEN, "las 10 columnas, en orden, aunque estén vacías");
  assert.ok(porId.has("k-parte"), "la parte (nieta de la sub-área) sale");
  assert.equal(columnaDe("k-parte"), "planeando");
  assert.equal(columnaDe("k-tarea"), "en_curso");
  assert.equal(columnaDe("k-hija"), "por_revisar", "la hija de una madre archivada vieja sale igual");
});

await prueba("no salen la borrada (ni lo que cuelga de ella), la de otro negocio, la de fuera de Features ni las Áreas", async () => {
  for (const id of ["k-borrada", "k-bajo-borrada", "k-otro-negocio", "k-fuera", FEATURES, SUBAREA, OTRA_AREA]) {
    assert.ok(!porId.has(id), `no sale ${id}`);
  }
  for (const texto of consultas) assert.ok(!/\b(INSERT|UPDATE|DELETE|MERGE|TRUNCATE)\b/i.test(texto), "solo lectura");
});

await prueba("corte de 7 días: una HECHO archivada hace 3 días entra y una de hace 10 no; las sin archivar entran todas", async () => {
  assert.equal(columnaDe("k-hecho-3"), "hecho");
  assert.equal(porId.get("k-hecho-3").archivada, true);
  assert.ok(!porId.has("k-hecho-10"), "la HECHO archivada hace 10 días no entra");
  assert.equal(columnaDe("k-hecho-viejo"), "hecho", "la HECHO sin archivar de hace 20 días entra (decisión del plan)");
  assert.equal(columnaDe("k-fallido-3"), "fallido");
  assert.ok(!porId.has("k-fallido-10"), "la FALLIDO archivada hace 10 días no entra");
  assert.equal(columnaDe("k-fallido-vivo"), "fallido", "la FALLIDO sin archivar entra");
  assert.ok(!porId.has("k-aprob-archivada"), "una archivada que no es HECHO ni FALLIDO no entra");
  assert.ok(!porId.has("k-madre-vieja"), "la madre archivada hace un mes no sale como tarjeta");
});

await prueba("área heredada de la carpeta y la propia; IDEA con esIdea; APROBADO y PLAN_APROBADO juntos; código y prioridad", async () => {
  assert.equal(porId.get("k-parte").area, "SEO Magilus", "la parte hereda el área de la sub-área a través de su tarea");
  assert.equal(porId.get("k-tarea").area, "SEO Magilus");
  assert.equal(porId.get("k-hija").area, "SEO Magilus", "a través de una madre que no sale como tarjeta");
  assert.equal(porId.get("k-propia").area, "Pagos", "la que tiene área propia la conserva");
  assert.equal(porId.get("k-idea").area, "Features", "la que cuelga directo de Features");
  assert.equal(columnaDe("k-idea"), "por_aprobar");
  assert.equal(porId.get("k-idea").esIdea, true);
  assert.equal(porId.get("k-tarea").esIdea, false);
  assert.equal(columnaDe("k-aprobado"), "aprobado");
  assert.equal(columnaDe("k-propia"), "aprobado");
  assert.deepEqual(Object.keys(porId.get("k-parte")).sort(), ["archivada", "area", "codigo", "esIdea", "estado", "id", "prioridad", "repo", "titulo"]);
  assert.equal(porId.get("k-parte").codigo, "T-811");
  assert.equal(porId.get("k-tarea").prioridad, "ALTA");
  assert.equal(porId.get("k-idea").prioridad, "URGENTE", "la marca urgente manda (prioridadDeLaTarjeta)");
  assert.deepEqual(tablero.areas, ["Features", "Pagos", "SEO Magilus"]);
  const delServicio = servicio.filtrarTarjetas(todas, { area: "SEO Magilus", repo: "Gestión" }).map((t) => t.id);
  assert.deepEqual(delServicio, ["k-parte", "k-hecho-viejo"]);
  assert.equal(servicio.etiquetaDelRepo(porId.get("k-idea").repo), "Sin repo");
});

await prueba("idDeFeatures: primero el id guardado (leerAreaFeatures); si no es del negocio, la T-736; si no hay, null y el error", async () => {
  ajustes.set("tablero:area-features:ws1", SUBAREA);
  assert.equal(await servicio.idDeFeatures("ws1"), SUBAREA, "el guardado manda");
  ajustes.set("tablero:area-features:ws1", "area-de-nadie-00000000001");
  assert.equal(await servicio.idDeFeatures("ws1"), FEATURES, "un id que no es del negocio cae en la T-736");
  ajustes.delete("tablero:area-features:ws1");
  assert.equal(await servicio.idDeFeatures("ws1"), FEATURES);
  ajustes.set("tablero:area-features:ws2", FEATURES);
  assert.equal(await servicio.idDeFeatures("ws2"), null, "el Features de otro negocio no sirve y ws2 no tiene T-736");
  const sinArea = await servicio.tableroDeFeatures("ws2", AHORA);
  assert.equal(sinArea.areaFeaturesId, null);
  assert.equal(sinArea.error, "No se encontró el Área Features");
  assert.equal(sinArea.columnas.length, 10);
  assert.ok(sinArea.columnas.every((c) => c.tarjetas.length === 0));
});

await prueba("la SQL es recursiva, de solo lectura, con tope de 50 niveles y 500 tarjetas, y el corte llega como dato", async () => {
  const texto = servicio.SQL_TABLERO_DE_FEATURES;
  assert.ok(texto.trim().startsWith("WITH RECURSIVE baja"));
  assert.ok(texto.includes(`s."nivel" < 50`));
  assert.ok(/LIMIT 500\b/.test(texto));
  assert.ok(texto.includes("$3::timestamptz"), "el corte de 7 días se pasa como dato");
  assert.ok(!/\bnow\(\)|current_timestamp|interval\b/i.test(texto), "no calcula la fecha en la base");
  assert.ok(!/\b(INSERT|UPDATE|DELETE|MERGE|TRUNCATE|any_value|json_object|json_array|IS JSON)\b/i.test(texto), "solo lectura y sin funciones de Postgres 16");
});

await db.close();

/* ------------------------------------------------------------------ 4. la acción del servidor (por el texto) */

await prueba("la acción: 'use server', revisa personaPuedeAprobar y no importa acciones que cambien el estado", async () => {
  const texto = fs.readFileSync(path.join(RAIZ, "src", "app", "actions", "tablero-ia-features-actions.ts"), "utf8");
  assert.ok(texto.startsWith('"use server";'));
  assert.ok(texto.includes('requireClientWorkspaceAccess("tableros_inteligentes")'));
  assert.ok(/if \(!personaPuedeAprobar\(access\)\) return \{ ok: false, error: /.test(texto), "sin permiso, responde con el error");
  assert.ok(texto.includes("tableroDeFeatures(access.workspaceId)"));
  const desde = [...texto.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(desde, [
    "@/features/tableros-inteligentes/services/reglas",
    "@/features/tableros-inteligentes/services/tablero-de-features",
    "@/lib/client-workspace-access",
  ]);
  assert.ok(!/tableros-inteligentes-actions|aprobarTarjeta|cambiarEstado|moverTarjeta|editarTarjeta|borrarTarjeta|archivar|cerrarComoFallida|\$executeRaw/.test(texto));
  const exportadas = [...texto.matchAll(/^export\s+(\S+\s+\S+)/gm)].map((m) => m[1]);
  assert.deepEqual(exportadas, ["async function"], "solo exporta la acción async");
});

console.log(`\n${pruebas} pruebas OK`);
