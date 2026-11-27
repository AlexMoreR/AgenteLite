// Tablero IA, vista tipo tablero de Features (27-nov-2026, parte 1 de 3): el servicio que lee las tarjetas que cuelgan del
// Área Features y las reparte en 10 columnas por estado (services/tablero-de-features.ts) y su acción de solo lectura.
// Carga el servicio REAL, corre su consulta en el Postgres de pruebas (o PGlite, con todas las migraciones) y lo demás con un
// prisma FALSO que pasa la consulta a esa base. No necesita base ni red.
// Correr: npm run test:tablero-features-kanban
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { abrirBaseDePruebas } from "./lib/base-de-pruebas.mjs";
import { cargar } from "./supervisor-cargar.mjs";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CARPETA = path.join(RAIZ, "prisma", "migrations");
const SERVICIO = "src/features/tableros-inteligentes/services/tablero-de-features.ts";
const ACCION = "src/app/actions/tablero-ia-features-actions.ts";

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

// Lo que guardó el Coordinador (leerAreaFeatures) y un prisma falso: la consulta cruda va a la base de pruebas.
const guardado = { id: null };
const consultas = [];
const prismaFalso = {
  $queryRawUnsafe: async (texto, ...valores) => {
    consultas.push({ texto, valores });
    return (await db.query(texto, valores)).rows;
  },
  tarjetaTablero: {
    findFirst: async ({ where }) => {
      const condicion = where.id ? `c."id" = $2` : `c."numero" = $2`;
      const { rows } = await db.query(
        `SELECT c."id" FROM "TarjetaTablero" c JOIN "TableroInteligente" b ON b."id" = c."tableroId"
         WHERE b."workspaceId" = $1 AND c."borradoEn" IS NULL AND ${condicion} LIMIT 1`,
        [where.tablero.workspaceId, where.id ?? where.numero],
      );
      return rows[0] ?? null;
    },
  },
};
const servicio = cargar(SERVICIO, {
  "@/lib/prisma": { prisma: prismaFalso },
  "./coordinador-en-vivo": { leerAreaFeatures: async () => guardado.id },
});
const { ESTADOS_TARJETA, NOMBRE_DEL_ESTADO } = cargar("src/features/tableros-inteligentes/services/reglas.ts");

/* ------------------------------------------------------------------ 1. columnas y estados */

await prueba("COLUMNAS_DE_FEATURES tiene las 10 columnas, con su clave y su nombre, en el orden pedido", async () => {
  assert.deepEqual(
    servicio.COLUMNAS_DE_FEATURES.map((c) => c.nombre),
    ["Por aprobar", "Aprobado (en fila)", "Planeando", "Plan listo", "En curso", "Por revisar", "Subiendo", "Error", "Hecho (últimos 7 días)", "Fallido"],
  );
  const claves = servicio.COLUMNAS_DE_FEATURES.map((c) => c.clave);
  assert.deepEqual(claves, ["por_aprobar", "aprobado", "planeando", "plan_listo", "en_curso", "por_revisar", "subiendo", "error", "hecho", "fallido"]);
  assert.equal(new Set(claves).size, 10);
});

await prueba("cada estado del enum de Prisma va a una sola columna (IDEA con la marca esIdea; APROBADO y PLAN_APROBADO juntos)", async () => {
  const esquema = fs.readFileSync(path.join(RAIZ, "prisma", "schema.prisma"), "utf8");
  const delEnum = esquema.match(/enum EstadoTarjeta \{([^}]*)\}/)[1].split(/\s+/).filter(Boolean);
  assert.deepEqual([...delEnum].sort(), [...ESTADOS_TARJETA].sort(), "ESTADOS_TARJETA coincide con el enum de Prisma");
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
    assert.equal(clave, esperado[estado], `${estado} (${NOMBRE_DEL_ESTADO[estado]})`);
    assert.ok(claves.has(clave), `${estado} va a una columna que existe`);
    assert.equal(esIdea, estado === "IDEA", `${estado}: esIdea`);
  }
});

/* ------------------------------------------------------------------ 2. repo, filtros y área */

await prueba("etiquetaDelRepo: gestion → Gestión, aizencrm → CRM y vacío → Sin repo", async () => {
  assert.equal(servicio.etiquetaDelRepo("gestion"), "Gestión");
  assert.equal(servicio.etiquetaDelRepo("aizencrm"), "CRM");
  assert.equal(servicio.etiquetaDelRepo(null), "Sin repo");
  assert.equal(servicio.etiquetaDelRepo(""), "Sin repo");
  assert.equal(servicio.etiquetaDelRepo("  "), "Sin repo");
});

await prueba("filtrarTarjetas: área, repo y prioridad se combinan entre sí; sin filtros pasan todas", async () => {
  const t = (id, area, repo, prioridad) => ({ id, area, repo, prioridad });
  const lista = [
    t("a", "SEO", "aizencrm", "ALTA"),
    t("b", "SEO", "gestion", "ALTA"),
    t("c", "SEO", "aizencrm", "MEDIA"),
    t("d", "Ventas", "aizencrm", "ALTA"),
    t("e", null, null, "BAJA"),
  ];
  const ids = (filtros) => servicio.filtrarTarjetas(lista, filtros).map((x) => x.id);
  assert.deepEqual(ids({}), ["a", "b", "c", "d", "e"]);
  assert.deepEqual(ids(undefined), ["a", "b", "c", "d", "e"]);
  assert.deepEqual(ids({ area: "SEO" }), ["a", "b", "c"]);
  assert.deepEqual(ids({ repo: "aizencrm" }), ["a", "c", "d"]);
  assert.deepEqual(ids({ prioridad: "ALTA" }), ["a", "b", "d"]);
  assert.deepEqual(ids({ area: "SEO", repo: "aizencrm" }), ["a", "c"]);
  assert.deepEqual(ids({ area: "SEO", repo: "aizencrm", prioridad: "ALTA" }), ["a"]);
  assert.deepEqual(ids({ area: "", repo: "" }), ["e"], "sin área y sin repo");
  assert.deepEqual(ids({ area: "Ventas", prioridad: "BAJA" }), []);
});

await prueba("el área se hereda de la carpeta más cercana (o del área propia) y las carpetas no salen como tarjeta", async () => {
  const fila = (id, padreId, tipoId, extra = {}) => ({
    id,
    numero: 1,
    titulo: id,
    area: null,
    estado: "APROBADO",
    tipoId,
    padreId,
    repo: null,
    urgente: false,
    prioridad: "MEDIA",
    archivadaEn: null,
    terminadaEn: null,
    actualizadoEn: null,
    tipoNombre: tipoId,
    tipoOrden: 0,
    requiereAprobacion: tipoId === "tarea",
    usaEstados: tipoId !== "area",
    ...extra,
  });
  const tarjetas = servicio.tarjetasDeLasFilas([
    fila("Features", null, "area", { estado: "IDEA" }),
    fila("SEO", "Features", "area", { estado: "IDEA" }),
    fila("tarea", "SEO", "tarea"),
    fila("parte", "tarea", "tarea", { urgente: true }),
    fila("propia", "SEO", "tarea", { area: "Ventas" }),
    fila("directa", "Features", "tarea", { prioridad: "BAJA" }),
  ]);
  assert.deepEqual(
    tarjetas.map((x) => [x.id, x.area, x.prioridad]),
    [
      ["tarea", "SEO", "MEDIA"],
      ["parte", "SEO", "URGENTE"],
      ["propia", "Ventas", "MEDIA"],
      ["directa", "Features", "BAJA"],
    ],
  );
});

/* ------------------------------------------------------------------ 3. la consulta, en la base de pruebas */

const FEATURES = "area-features-0000000001";
const SUBAREA = "area-seo-000000000000001";
const FUERA = "area-ventas-0000000000001";
const AHORA = new Date("2026-11-27T15:00:00.000Z");
const dias = (n) => new Date(AHORA.getTime() - n * 86400000).toISOString().replace("T", " ").replace("Z", "");

await db.exec(`
  INSERT INTO "User" ("id", "email", "password", "updatedAt") VALUES ('u-dueno', 'dueno@x.co', 'x', now()), ('u-otro', 'otro@x.co', 'x', now());
  INSERT INTO "Workspace" ("id", "name", "slug", "updatedAt", "ownerId") VALUES
    ('ws1', 'Magilus', 'magilus', now(), 'u-dueno'),
    ('ws2', 'Otro', 'otro', now(), 'u-otro');
  INSERT INTO "TableroInteligente" ("id", "workspaceId", "nombre") VALUES ('tab1', 'ws1', 'Empresa Magilus'), ('tab2', 'ws2', 'Otro negocio');
  INSERT INTO "TipoTarjeta" ("id", "tableroId", "nombre", "requiereAprobacion", "usaEstados", "orden") VALUES
    ('area', 'tab1', 'Área', false, false, 0),
    ('idea', 'tab1', 'Idea', false, true, 1),
    ('tarea', 'tab1', 'Tarea', true, true, 2),
    ('tarea2', 'tab2', 'Tarea', true, true, 2);
  INSERT INTO "TarjetaTablero" ("id", "numero", "tableroId", "titulo", "estado", "creadoPor", "creadoEn", "actualizadoEn", "tipoId", "repo", "padreId", "prioridad") VALUES
    ('${FEATURES}', 736, 'tab1', 'Features', 'IDEA', 'u-dueno', '2026-10-01', '2026-10-01', 'area', NULL, NULL, 'MEDIA'),
    ('${SUBAREA}', 737, 'tab1', 'SEO Magilus', 'IDEA', 'u-dueno', '2026-10-01', '2026-10-01', 'area', NULL, '${FEATURES}', 'MEDIA'),
    ('${FUERA}', 738, 'tab1', 'Ventas', 'IDEA', 'u-dueno', '2026-10-01', '2026-10-01', 'area', NULL, NULL, 'MEDIA'),
    ('k-tarea', 801, 'tab1', 'Tarea de SEO', 'EN_CURSO', 'u-dueno', '2026-11-20', '2026-11-26', 'tarea', 'aizencrm', '${SUBAREA}', 'ALTA'),
    ('k-nieta', 802, 'tab1', 'Parte 1 de la tarea', 'PLAN_APROBADO', 'u-dueno', '2026-11-21', '2026-11-26', 'tarea', 'gestion', 'k-tarea', 'MEDIA'),
    ('k-idea', 803, 'tab1', 'Idea suelta', 'IDEA', 'u-dueno', '2026-11-21', '2026-11-25', 'idea', NULL, '${FEATURES}', 'BAJA'),
    ('k-borrada', 804, 'tab1', 'Borrada', 'APROBADO', 'u-dueno', '2026-11-21', '2026-11-25', 'tarea', 'aizencrm', '${SUBAREA}', 'MEDIA'),
    ('k-hija-de-borrada', 805, 'tab1', 'Hija de la borrada', 'APROBADO', 'u-dueno', '2026-11-21', '2026-11-25', 'tarea', 'aizencrm', 'k-borrada', 'MEDIA'),
    ('k-fuera', 806, 'tab1', 'De Ventas', 'APROBADO', 'u-dueno', '2026-11-21', '2026-11-25', 'tarea', 'aizencrm', '${FUERA}', 'MEDIA'),
    ('k-hecho-3', 807, 'tab1', 'Hecha hace 3 días', 'HECHO', 'u-dueno', '2026-11-01', '2026-11-24', 'tarea', 'aizencrm', '${SUBAREA}', 'MEDIA'),
    ('k-hecho-10', 808, 'tab1', 'Hecha hace 10 días', 'HECHO', 'u-dueno', '2026-11-01', '2026-11-17', 'tarea', 'aizencrm', '${SUBAREA}', 'MEDIA'),
    ('k-hecho-vieja', 809, 'tab1', 'Hecha vieja sin archivar', 'HECHO', 'u-dueno', '2026-10-01', '2026-10-05', 'tarea', 'aizencrm', '${SUBAREA}', 'MEDIA'),
    ('k-fallida-2', 810, 'tab1', 'Fallida archivada hace 2 días', 'FALLIDO', 'u-dueno', '2026-11-01', '2026-11-25', 'tarea', 'gestion', '${SUBAREA}', 'MEDIA'),
    ('k-arch-aprob', 811, 'tab1', 'Archivada sin terminar', 'APROBADO', 'u-dueno', '2026-11-01', '2026-11-25', 'tarea', 'gestion', '${SUBAREA}', 'MEDIA'),
    ('k-otro-negocio', 812, 'tab2', 'De otro negocio', 'APROBADO', 'u-otro', '2026-11-21', '2026-11-25', 'tarea2', 'aizencrm', '${FEATURES}', 'MEDIA');
  UPDATE "TarjetaTablero" SET "borradoEn" = '2026-11-26' WHERE "id" = 'k-borrada';
  UPDATE "TarjetaTablero" SET "archivadaEn" = '${dias(3)}', "terminadaEn" = '${dias(3)}' WHERE "id" = 'k-hecho-3';
  UPDATE "TarjetaTablero" SET "archivadaEn" = '${dias(10)}', "terminadaEn" = '${dias(10)}' WHERE "id" = 'k-hecho-10';
  UPDATE "TarjetaTablero" SET "archivadaEn" = '${dias(2)}', "terminadaEn" = '${dias(2)}' WHERE "id" = 'k-fallida-2';
  UPDATE "TarjetaTablero" SET "archivadaEn" = '${dias(1)}', "terminadaEn" = '${dias(1)}' WHERE "id" = 'k-arch-aprob';
`);

const idsDeLaConsulta = async (negocio = "ws1") =>
  (await db.query(servicio.SQL_TABLERO_DE_FEATURES, [FEATURES, negocio, servicio.desdeCuando(AHORA).toISOString()])).rows.map((f) => f.id);

await prueba("la consulta trae la nieta de Features (Features > sub-área > tarea > parte), pero no una borrada, de otro negocio ni de fuera", async () => {
  const ids = await idsDeLaConsulta();
  assert.ok(ids.includes("k-nieta"), "la parte, tres niveles abajo de Features");
  assert.ok(ids.includes("k-tarea"));
  assert.ok(ids.includes("k-idea"));
  assert.ok(!ids.includes("k-borrada"), "la borrada no");
  assert.ok(!ids.includes("k-hija-de-borrada"), "lo que cuelga de una borrada tampoco");
  assert.ok(!ids.includes("k-otro-negocio"), "la de otro negocio no");
  assert.ok(!ids.includes("k-fuera"), "la de fuera de Features no");
  assert.ok(!ids.includes(FUERA), "el área de fuera tampoco");
  assert.deepEqual(await idsDeLaConsulta("ws2"), [], "otro negocio no ve nada de este Features");
});

await prueba("corte de 7 días: la HECHO archivada hace 3 días entra y la de hace 10 no; las sin archivar entran todas", async () => {
  const ids = await idsDeLaConsulta();
  assert.ok(ids.includes("k-hecho-3"), "archivada hace 3 días");
  assert.ok(!ids.includes("k-hecho-10"), "archivada hace 10 días");
  assert.ok(ids.includes("k-hecho-vieja"), "una HECHO sin archivar de octubre entra (decisión del dueño)");
  assert.ok(ids.includes("k-fallida-2"), "una FALLIDO archivada hace 2 días entra");
  assert.ok(!ids.includes("k-arch-aprob"), "una archivada que no es HECHO ni FALLIDO no entra");
});

await prueba("la consulta es de solo lectura, recursiva, con tope de 50 niveles y 500 filas, y sin funciones de Postgres 16", async () => {
  const texto = servicio.SQL_TABLERO_DE_FEATURES;
  assert.match(texto, /WITH RECURSIVE baja/);
  assert.match(texto, /"nivel" < 50/);
  assert.match(texto, /LIMIT 500\s*$/);
  assert.doesNotMatch(texto, /\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|CREATE|FOR UPDATE)\b/i);
  assert.doesNotMatch(texto, /\b(any_value|json_object|json_array|json_exists|json_query|json_value|json_table|is json|merge)\b/i); // sql-version-ok: es la lista de lo prohibido, no una consulta
  assert.doesNotMatch(texto, /now\(\)|current_timestamp/i, "el corte de 7 días llega como dato ($3)");
});

/* ------------------------------------------------------------------ 4. el servicio entero */

await prueba("tableroDeFeatures: sin id guardado usa la T-736 y reparte en las 10 columnas con el área, el repo y la prioridad", async () => {
  guardado.id = null;
  const tablero = await servicio.tableroDeFeatures("ws1", AHORA);
  assert.equal(tablero.areaFeaturesId, FEATURES);
  assert.equal(tablero.error, undefined);
  assert.deepEqual(tablero.columnas.map((c) => c.clave), servicio.COLUMNAS_DE_FEATURES.map((c) => c.clave));
  const en = (clave) => tablero.columnas.find((c) => c.clave === clave).tarjetas.map((t) => t.id);
  assert.deepEqual(en("por_aprobar"), ["k-idea"]);
  assert.deepEqual(en("aprobado"), ["k-nieta"]);
  assert.deepEqual(en("en_curso"), ["k-tarea"]);
  assert.deepEqual(en("hecho"), ["k-hecho-3", "k-hecho-vieja"]);
  assert.deepEqual(en("fallido"), ["k-fallida-2"]);
  const todas = tablero.columnas.flatMap((c) => c.tarjetas);
  assert.ok(!todas.some((t) => [FEATURES, SUBAREA].includes(t.id)), "las Áreas no salen como tarjeta");
  const nieta = todas.find((t) => t.id === "k-nieta");
  assert.deepEqual(nieta, {
    id: "k-nieta",
    codigo: "T-802",
    titulo: "Parte 1 de la tarea",
    area: "SEO Magilus",
    prioridad: "MEDIA",
    esIdea: false,
    repo: "gestion",
    archivada: false,
    estado: "PLAN_APROBADO",
  });
  assert.equal(todas.find((t) => t.id === "k-idea").esIdea, true);
  assert.equal(todas.find((t) => t.id === "k-idea").area, "Features", "la que cuelga directo de Features hereda «Features»");
  assert.equal(todas.find((t) => t.id === "k-hecho-3").archivada, true);
  assert.equal(todas.find((t) => t.id === "k-tarea").prioridad, "ALTA");
  assert.deepEqual(tablero.areas, ["Features", "SEO Magilus"]);
  assert.deepEqual(servicio.filtrarTarjetas(todas, { repo: "gestion" }).map((t) => t.id).sort(), ["k-fallida-2", "k-nieta"]);
  assert.equal(servicio.etiquetaDelRepo(nieta.repo), "Gestión");
  const ultima = consultas.at(-1);
  assert.deepEqual(ultima.valores.slice(0, 2), [FEATURES, "ws1"], "la consulta va con el id de Features y el negocio de la sesión");
});

await prueba("idDeFeatures: primero el id guardado; si no corresponde al negocio, la T-736; si tampoco, null y el error", async () => {
  guardado.id = SUBAREA;
  assert.equal(await servicio.idDeFeatures("ws1"), SUBAREA, "el id guardado manda");
  guardado.id = "no-existe-000000000000001";
  assert.equal(await servicio.idDeFeatures("ws1"), FEATURES, "un id guardado que no existe cae a la T-736");
  guardado.id = FEATURES;
  assert.equal(await servicio.idDeFeatures("ws2"), null, "otro negocio sin T-736 ni Features propio: null");
  const sinFeatures = await servicio.tableroDeFeatures("ws2", AHORA);
  assert.equal(sinFeatures.areaFeaturesId, null);
  assert.equal(sinFeatures.error, "No se encontró el Área Features");
  assert.equal(sinFeatures.columnas.length, 10);
  assert.ok(sinFeatures.columnas.every((c) => c.tarjetas.length === 0));
  assert.deepEqual(sinFeatures.areas, []);
  guardado.id = null;
});

await prueba("el servicio usa leerAreaFeatures de coordinador-en-vivo y solo lee", async () => {
  const texto = fs.readFileSync(path.join(RAIZ, SERVICIO), "utf8");
  assert.match(texto, /import \{ leerAreaFeatures \} from "\.\/coordinador-en-vivo"/);
  assert.doesNotMatch(texto, /\.(update|updateMany|create|createMany|delete|deleteMany|upsert)\(|\$executeRaw/, "no escribe nada");
});

/* ------------------------------------------------------------------ 5. la acción */

await prueba("la acción usa personaPuedeAprobar, la sesión del negocio y no importa acciones que cambien el estado", async () => {
  const texto = fs.readFileSync(path.join(RAIZ, ACCION), "utf8");
  assert.match(texto, /^"use server";/);
  assert.match(texto, /requireClientWorkspaceAccess\("tableros_inteligentes"\)/);
  assert.match(texto, /if \(!personaPuedeAprobar\(access\)\) return \{ ok: false, error:/);
  assert.match(texto, /tableroDeFeatures\(access\.workspaceId\)/, "el negocio sale de la sesión, no de un parámetro");
  assert.match(texto, /export async function tableroDeFeaturesAction\(\)/, "no recibe parámetros");
  const importes = [...texto.matchAll(/import[^;]*from "([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(importes.sort(), [
    "@/features/tableros-inteligentes/services/reglas",
    "@/features/tableros-inteligentes/services/tablero-de-features",
    "@/lib/client-workspace-access",
  ]);
  assert.doesNotMatch(texto, /cambiarEstado|aprobarTarjeta|editarTarjeta|borrarTarjeta|marcarHecho|archivar|-actions"/);
});

await db.close();
console.log(`\n${pruebas} pruebas OK`);
