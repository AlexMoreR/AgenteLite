// Tablero de Features en columnas (27-nov-2026, parte 1): prueba el servicio REAL
// (src/features/tableros-inteligentes/services/tablero-de-features.ts) con su consulta corriendo en el Postgres de pruebas
// o en PGlite (todas las migraciones) y un prisma FALSO que manda la consulta a esa base. No necesita red ni la base real.
//  - Estado → columna de los 12 estados del enum, y las 10 columnas en su orden.
//  - El corte de 7 días de las archivadas, los filtros, las etiquetas Gestión / CRM / Sin repo y el área heredada.
//  - La consulta trae una nieta de Features (Features > sub-área > tarea > parte), y no una borrada, de otro negocio ni de fuera.
//  - La acción usa personaPuedeAprobar y no importa nada que cambie estados.
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

// findFirst de TarjetaTablero con lo que usa el servicio: id o numero, borradoEn null y tablero.workspaceId.
const tarjetaTablero = {
  async findFirst({ where }) {
    const condiciones = [`c."borradoEn" IS NULL`, `b."workspaceId" = $1`];
    const valores = [where.tablero.workspaceId];
    if (where.id !== undefined) {
      valores.push(where.id);
      condiciones.push(`c."id" = $${valores.length}`);
    }
    if (where.numero !== undefined) {
      valores.push(where.numero);
      condiciones.push(`c."numero" = $${valores.length}`);
    }
    const { rows } = await db.query(
      `SELECT c."id", c."titulo", c."area", c."tipoId" FROM "TarjetaTablero" c JOIN "TableroInteligente" b ON b."id" = c."tableroId" WHERE ${condiciones.join(" AND ")} LIMIT 1`,
      valores,
    );
    return rows[0] ?? null;
  },
};
const prismaFalso = {
  tarjetaTablero,
  async $queryRawUnsafe(texto, ...valores) {
    return (await db.query(texto, valores)).rows;
  },
};
let areaGuardada = null;
const coordinadorFalso = { leerAreaFeatures: async () => areaGuardada };

const servicio = cargar("src/features/tableros-inteligentes/services/tablero-de-features.ts", {
  "@/lib/prisma": { prisma: prismaFalso },
  "./coordinador-en-vivo": coordinadorFalso,
});
const reglas = cargar("src/features/tableros-inteligentes/services/reglas.ts");

/* ------------------------------------------------------------------ 1. columnas y estados */

await prueba("COLUMNAS_DE_FEATURES tiene las 10 columnas, con su clave y su nombre, en el orden pedido", async () => {
  assert.deepEqual(
    servicio.COLUMNAS_DE_FEATURES.map((c) => c.nombre),
    ["Por aprobar", "Aprobado (en fila)", "Planeando", "Plan listo", "En curso", "Por revisar", "Subiendo", "Error", "Hecho (últimos 7 días)", "Fallido"],
  );
  assert.deepEqual(
    servicio.COLUMNAS_DE_FEATURES.map((c) => c.clave),
    ["por_aprobar", "aprobado", "planeando", "plan_listo", "en_curso", "por_revisar", "subiendo", "error", "hecho", "fallido"],
  );
});

await prueba("columnaDelEstado: los 12 estados del enum de Prisma van cada uno a su columna (IDEA con esIdea)", async () => {
  const schema = fs.readFileSync(path.join(RAIZ, "prisma", "schema.prisma"), "utf8");
  const enumReal = schema.match(/enum EstadoTarjeta \{([^}]*)\}/)[1].split(/\s+/).filter(Boolean);
  assert.deepEqual([...enumReal].sort(), [...reglas.ESTADOS_TARJETA].sort(), "ESTADOS_TARJETA coincide con el enum");
  assert.deepEqual(Object.keys(reglas.NOMBRE_DEL_ESTADO).sort(), [...enumReal].sort(), "NOMBRE_DEL_ESTADO tiene todos");
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
  for (const estado of enumReal) {
    const columna = servicio.columnaDelEstado(estado);
    assert.ok(columna, `${estado} tiene columna`);
    assert.equal(columna.clave, esperado[estado], estado);
    assert.equal(columna.esIdea, estado === "IDEA", `esIdea de ${estado}`);
  }
  assert.equal(servicio.columnaDelEstado("OTRO"), null, "un estado desconocido no tiene columna");
});

/* ------------------------------------------------------------------ 2. etiquetas y filtros */

await prueba("etiquetaDelRepo: gestion → Gestión, aizencrm → CRM, vacío → Sin repo", async () => {
  assert.equal(servicio.etiquetaDelRepo("gestion"), "Gestión");
  assert.equal(servicio.etiquetaDelRepo("aizencrm"), "CRM");
  assert.equal(servicio.etiquetaDelRepo(null), "Sin repo");
  assert.equal(servicio.etiquetaDelRepo(""), "Sin repo");
  assert.equal(servicio.etiquetaDelRepo("  "), "Sin repo");
});

await prueba("filtrarTarjetas: área, repo y prioridad se combinan entre sí", async () => {
  const t = [
    { id: "a", area: "SEO", repo: "CRM", prioridad: "ALTA" },
    { id: "b", area: "SEO", repo: "Gestión", prioridad: "ALTA" },
    { id: "c", area: "SEO", repo: "CRM", prioridad: "MEDIA" },
    { id: "d", area: "Ventas", repo: "CRM", prioridad: "ALTA" },
    { id: "e", area: null, repo: "Sin repo", prioridad: "BAJA" },
  ];
  const ids = (f) => servicio.filtrarTarjetas(t, f).map((x) => x.id);
  assert.deepEqual(ids({}), ["a", "b", "c", "d", "e"], "sin filtros, todas");
  assert.deepEqual(ids({ area: "SEO" }), ["a", "b", "c"]);
  assert.deepEqual(ids({ repo: "CRM" }), ["a", "c", "d"]);
  assert.deepEqual(ids({ repo: "aizencrm" }), ["a", "c", "d"], "el repo también se puede pedir por su valor");
  assert.deepEqual(ids({ prioridad: "ALTA" }), ["a", "b", "d"]);
  assert.deepEqual(ids({ area: "SEO", repo: "CRM" }), ["a", "c"]);
  assert.deepEqual(ids({ area: "SEO", repo: "CRM", prioridad: "ALTA" }), ["a"]);
  assert.deepEqual(ids({ repo: "Sin repo" }), ["e"]);
  assert.deepEqual(ids({ area: "SEO", prioridad: "BAJA" }), [], "combinados que no coinciden: ninguna");
});

/* ------------------------------------------------------------------ 3. la consulta y el armado, en la base */

const FEATURES = "area-features-0000000001";
const SUBAREA = "area-seo-000000000000001";
const OTRA_AREA = "area-ventas-0000000000001";
const AHORA = new Date("2026-11-27T15:00:00.000Z");
const HACE = (dias) => new Date(AHORA.getTime() - dias * 24 * 60 * 60 * 1000).toISOString();

await db.exec(`
  INSERT INTO "User" ("id", "email", "password", "updatedAt") VALUES ('u-dueno', 'dueno@x.co', 'x', now()), ('u-otro', 'otro@x.co', 'x', now());
  INSERT INTO "Workspace" ("id", "name", "slug", "updatedAt", "ownerId") VALUES ('ws1', 'Magilus', 'magilus', now(), 'u-dueno'), ('ws2', 'Otro', 'otro', now(), 'u-otro');
  INSERT INTO "TableroInteligente" ("id", "workspaceId", "nombre") VALUES ('tab1', 'ws1', 'Empresa Magilus'), ('tab2', 'ws2', 'Otro negocio');
  INSERT INTO "TipoTarjeta" ("id", "tableroId", "nombre", "requiereAprobacion", "usaEstados", "orden") VALUES
    ('area', 'tab1', 'Área', false, false, 0),
    ('tarea', 'tab1', 'Tarea', true, true, 2),
    ('tarea2', 'tab2', 'Tarea', true, true, 2);
  INSERT INTO "TarjetaTablero" ("id", "numero", "tableroId", "titulo", "estado", "creadoPor", "creadoEn", "actualizadoEn", "tipoId", "repo", "padreId", "area", "prioridad", "urgente") VALUES
    ('${FEATURES}', 736, 'tab1', 'Features', 'IDEA', 'u-dueno', '2026-10-01 08:00:00', '2026-10-01 08:00:00', 'area', NULL, NULL, NULL, 'MEDIA', false),
    ('${SUBAREA}', 801, 'tab1', 'SEO Magilus', 'IDEA', 'u-dueno', '2026-10-01 08:00:00', '2026-10-01 08:00:00', 'area', NULL, '${FEATURES}', NULL, 'MEDIA', false),
    ('${OTRA_AREA}', 802, 'tab1', 'Ventas', 'IDEA', 'u-dueno', '2026-10-01 08:00:00', '2026-10-01 08:00:00', 'area', NULL, NULL, NULL, 'MEDIA', false),
    ('tarea-seo', 810, 'tab1', 'Tarea de SEO', 'EN_CURSO', 'u-dueno', '2026-11-20 08:00:00', '2026-11-20 08:00:00', 'tarea', 'aizencrm', '${SUBAREA}', NULL, 'ALTA', false),
    ('parte-seo', 811, 'tab1', 'Parte 1 de la tarea de SEO', 'PLAN_APROBADO', 'u-dueno', '2026-11-21 08:00:00', '2026-11-21 08:00:00', 'tarea', 'gestion', 'tarea-seo', NULL, 'MEDIA', false),
    ('directa', 812, 'tab1', 'Idea directa en Features', 'IDEA', 'u-dueno', '2026-11-22 08:00:00', '2026-11-22 08:00:00', 'tarea', NULL, '${FEATURES}', NULL, 'BAJA', true),
    ('con-area', 813, 'tab1', 'Con área propia', 'POR_REVISAR', 'u-dueno', '2026-11-22 08:00:00', '2026-11-22 08:00:00', 'tarea', 'aizencrm', '${SUBAREA}', 'Pagos', 'MEDIA', false),
    ('borrada', 814, 'tab1', 'Borrada', 'APROBADO', 'u-dueno', '2026-11-22 08:00:00', '2026-11-22 08:00:00', 'tarea', 'aizencrm', '${SUBAREA}', NULL, 'MEDIA', false),
    ('fuera', 815, 'tab1', 'De Ventas', 'APROBADO', 'u-dueno', '2026-11-22 08:00:00', '2026-11-22 08:00:00', 'tarea', 'aizencrm', '${OTRA_AREA}', NULL, 'MEDIA', false),
    ('otro-negocio', 816, 'tab2', 'De otro negocio colgada de Features', 'APROBADO', 'u-otro', '2026-11-22 08:00:00', '2026-11-22 08:00:00', 'tarea2', 'aizencrm', '${FEATURES}', NULL, 'MEDIA', false),
    ('hecha-3', 817, 'tab1', 'Hecha hace 3 días, archivada', 'HECHO', 'u-dueno', '2026-11-10 08:00:00', '2026-11-24 08:00:00', 'tarea', 'aizencrm', '${SUBAREA}', NULL, 'MEDIA', false),
    ('hecha-10', 818, 'tab1', 'Hecha hace 10 días, archivada', 'HECHO', 'u-dueno', '2026-11-10 08:00:00', '2026-11-17 08:00:00', 'tarea', 'aizencrm', '${SUBAREA}', NULL, 'MEDIA', false),
    ('hecha-vieja', 819, 'tab1', 'Hecha hace 20 días, sin archivar', 'HECHO', 'u-dueno', '2026-10-10 08:00:00', '2026-11-07 08:00:00', 'tarea', 'aizencrm', '${SUBAREA}', NULL, 'MEDIA', false),
    ('fallida-3', 820, 'tab1', 'Fallida hace 3 días, archivada', 'FALLIDO', 'u-dueno', '2026-11-10 08:00:00', '2026-11-24 08:00:00', 'tarea', 'gestion', '${SUBAREA}', NULL, 'MEDIA', false),
    ('fallida-10', 821, 'tab1', 'Fallida hace 10 días, archivada', 'FALLIDO', 'u-dueno', '2026-11-10 08:00:00', '2026-11-17 08:00:00', 'tarea', 'gestion', '${SUBAREA}', NULL, 'MEDIA', false),
    ('archivada-curso', 822, 'tab1', 'En curso archivada', 'EN_CURSO', 'u-dueno', '2026-11-10 08:00:00', '2026-11-24 08:00:00', 'tarea', 'gestion', '${SUBAREA}', NULL, 'MEDIA', false);
  UPDATE "TarjetaTablero" SET "borradoEn" = '2026-11-23 08:00:00' WHERE "id" = 'borrada';
  UPDATE "TarjetaTablero" SET "archivadaEn" = '${HACE(3)}', "terminadaEn" = '${HACE(3)}' WHERE "id" IN ('hecha-3', 'fallida-3', 'archivada-curso');
  UPDATE "TarjetaTablero" SET "archivadaEn" = '${HACE(10)}', "terminadaEn" = '${HACE(10)}' WHERE "id" IN ('hecha-10', 'fallida-10');
  UPDATE "TarjetaTablero" SET "terminadaEn" = '${HACE(20)}' WHERE "id" = 'hecha-vieja';
`);

const tablero = await servicio.tableroDeFeatures("ws1", AHORA);
const todas = tablero.columnas.flatMap((c) => c.tarjetas);
const porId = new Map(todas.map((t) => [t.id, t]));
const enColumna = (clave) => tablero.columnas.find((c) => c.clave === clave).tarjetas.map((t) => t.id).sort();

await prueba("la consulta corre en la base de pruebas y trae la nieta de Features (Features > sub-área > tarea > parte)", async () => {
  assert.equal(tablero.error, undefined);
  assert.equal(tablero.areaFeaturesId, FEATURES, "sin id guardado, usa la T-736");
  assert.ok(porId.has("tarea-seo"), "la tarea de la sub-área");
  assert.ok(porId.has("parte-seo"), "la parte, nieta de Features");
  assert.ok(porId.has("directa"), "la que cuelga directo de Features");
  assert.deepEqual(tablero.columnas.map((c) => c.clave), servicio.COLUMNAS_DE_FEATURES.map((c) => c.clave), "vienen las 10 columnas en orden");
});

await prueba("no trae una borrada, una de otro negocio ni una de fuera de Features; las Áreas no salen como tarjeta", async () => {
  for (const id of ["borrada", "otro-negocio", "fuera", FEATURES, SUBAREA, OTRA_AREA]) assert.ok(!porId.has(id), `no sale ${id}`);
});

await prueba("corte de 7 días: la HECHO archivada hace 3 días entra y la de hace 10 no; la HECHO sin archivar entra siempre", async () => {
  assert.deepEqual(enColumna("hecho"), ["hecha-3", "hecha-vieja"]);
  assert.ok(!porId.has("hecha-10"));
  assert.equal(porId.get("hecha-3").archivada, true);
  assert.equal(porId.get("hecha-vieja").archivada, false);
});

await prueba("Fallido: la archivada hace 3 días entra y la de hace 10 no; una archivada que no terminó no entra", async () => {
  assert.deepEqual(enColumna("fallido"), ["fallida-3"]);
  assert.ok(!porId.has("fallida-10"));
  assert.ok(!porId.has("archivada-curso"), "archivada en EN_CURSO no entra");
  assert.equal(servicio.corteDeArchivadas(AHORA), HACE(7));
});

await prueba("cada tarjeta va en su columna, con código, prioridad, esIdea y la etiqueta del repo", async () => {
  assert.deepEqual(enColumna("por_aprobar"), ["directa"]);
  assert.deepEqual(enColumna("aprobado"), ["parte-seo"], "PLAN_APROBADO va en «Aprobado (en fila)»");
  assert.deepEqual(enColumna("en_curso"), ["tarea-seo"]);
  assert.deepEqual(enColumna("por_revisar"), ["con-area"]);
  assert.deepEqual(porId.get("directa"), {
    id: "directa",
    codigo: "T-812",
    titulo: "Idea directa en Features",
    area: "Features",
    prioridad: "URGENTE",
    esIdea: true,
    repo: "Sin repo",
    archivada: false,
    estado: "IDEA",
  });
  assert.equal(porId.get("tarea-seo").repo, "CRM");
  assert.equal(porId.get("parte-seo").repo, "Gestión");
  assert.equal(porId.get("tarea-seo").prioridad, "ALTA");
  assert.equal(porId.get("parte-seo").esIdea, false);
});

await prueba("área heredada: de la carpeta más cercana (también para la nieta); la propia manda", async () => {
  assert.equal(porId.get("tarea-seo").area, "SEO Magilus");
  assert.equal(porId.get("parte-seo").area, "SEO Magilus", "la parte hereda a través de su tarea madre");
  assert.equal(porId.get("con-area").area, "Pagos");
  assert.equal(porId.get("directa").area, "Features", "lo que cuelga directo de Features hereda Features");
  assert.deepEqual(tablero.areas, ["Features", "Pagos", "SEO Magilus"]);
  assert.deepEqual(servicio.filtrarTarjetas(todas, { area: "SEO Magilus", repo: "CRM" }).map((t) => t.id).sort(), ["hecha-3", "hecha-vieja", "tarea-seo"]);
});

await prueba("idDeFeatures: primero el id guardado (si es del negocio), si no la T-736, y si no null con el error", async () => {
  areaGuardada = SUBAREA;
  assert.equal(await servicio.idDeFeatures("ws1"), SUBAREA, "el guardado manda");
  areaGuardada = "no-existe-0000000000001";
  assert.equal(await servicio.idDeFeatures("ws1"), FEATURES, "un id guardado que no es del negocio cae a la T-736");
  areaGuardada = null;
  assert.equal(await servicio.idDeFeatures("ws2"), null, "otro negocio sin Features");
  const sinFeatures = await servicio.tableroDeFeatures("ws2", AHORA);
  assert.equal(sinFeatures.error, "No se encontró el Área Features");
  assert.equal(sinFeatures.areaFeaturesId, null);
  assert.equal(sinFeatures.columnas.length, 10);
  assert.equal(sinFeatures.columnas.flatMap((c) => c.tarjetas).length, 0);
});

await prueba("la consulta es de solo lectura, recursiva, con tope de 50 niveles y 500 tarjetas, sin funciones de Postgres 16", async () => {
  const texto = servicio.SQL_TABLERO_DE_FEATURES;
  assert.ok(texto.includes("WITH RECURSIVE baja"));
  assert.ok(texto.includes(`s."nivel" < 50`));
  assert.ok(/LIMIT 500\s*$/.test(texto));
  assert.ok(!/\b(INSERT|UPDATE|DELETE|MERGE|TRUNCATE|ALTER|DROP|CREATE)\b/i.test(texto), "no escribe");
  for (const pg16 of ["any_value", "json_object(", "json_array(", "IS JSON", "JSON_ARRAYAGG", "JSON_OBJECTAGG", "random_normal"]) { // sql-version-ok: es la lista de lo que la consulta NO debe usar
    assert.ok(!texto.toLowerCase().includes(pg16.toLowerCase()), `no usa ${pg16}`);
  }
});

/* ------------------------------------------------------------------ 4. la acción */

await prueba("la acción revisa el permiso con personaPuedeAprobar y no importa acciones de cambio de estado", async () => {
  const accion = fs.readFileSync(path.join(RAIZ, "src", "app", "actions", "tablero-ia-features-actions.ts"), "utf8");
  assert.ok(accion.startsWith(`"use server";`));
  assert.ok(accion.includes(`requireClientWorkspaceAccess("tableros_inteligentes")`));
  assert.ok(/if \(!personaPuedeAprobar\(access\)\) return \{ ok: false, error:/.test(accion), "sin permiso responde con error");
  assert.ok(accion.includes("tableroDeFeatures(access.workspaceId)"));
  const imports = accion.match(/^import[\s\S]*?;$/gm).join("\n");
  for (const prohibido of ["cambiarEstado", "aprobarTarjeta", "editarTarjeta", "borrarTarjeta", "archivar", "marcarHecho", "cerrarComoFallida", "/services/tableros\"", "-actions\""]) {
    assert.ok(!imports.includes(prohibido), `no importa ${prohibido}`);
  }
  const importados = [...imports.matchAll(/from "([^"]+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(importados, [
    "@/features/tableros-inteligentes/services/reglas",
    "@/features/tableros-inteligentes/services/tablero-de-features",
    "@/lib/client-workspace-access",
  ]);
  const servicioTexto = fs.readFileSync(path.join(RAIZ, "src", "features", "tableros-inteligentes", "services", "tablero-de-features.ts"), "utf8");
  assert.ok(!/\.(update|updateMany|create|createMany|delete|deleteMany|upsert)\(/.test(servicioTexto), "el servicio no escribe");
  assert.ok(!servicioTexto.includes("$executeRaw"), "el servicio no escribe con SQL");
});

await db.close?.();
console.log(`\n${pruebas} pruebas de tablero de Features en columnas OK`);
