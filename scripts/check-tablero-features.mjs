// Solo Features (23-nov-2026, parte 1): el CRM filtra las candidatas del Coordinador por el Área Features (sub-áreas incluidas)
// y guarda el id que llega con el latido. Corre las consultas REALES (services/sql-trabajador.ts) en un Postgres embebido
// (PGlite, con todas las migraciones) y el guardado del latido con un prisma FALSO. No necesita base ni red.
//  - Con el id de Features y 60 aprobadas de fuera por delante (intentos = 0), /candidatas trae la de una sub-área de Features
//    y ninguna de fuera; /tomar toma la de Features.
//  - Una de fuera ya empezada (intentos > 0) en PLAN_APROBADO y otra en SUBIENDO sí salen.
//  - Sin id, el resultado es el de hoy.
// Correr: npm run test:tablero-features
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { cargar } from "./supervisor-cargar.mjs";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CARPETA = path.join(RAIZ, "prisma", "migrations");

let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const sql = cargar("src/features/tableros-inteligentes/services/sql-trabajador.ts");
const reglas = cargar("src/features/tableros-inteligentes/services/reglas-trabajador.ts");

/* ------------------------------------------------------------------ 1. el SQL, en PGlite */

const db = new PGlite();
for (const nombre of fs.readdirSync(CARPETA, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort()) {
  try {
    await db.exec(fs.readFileSync(path.join(CARPETA, nombre, "migration.sql"), "utf8"));
  } catch (fallo) {
    throw new Error(`La migración ${nombre} falló en PGlite: ${fallo.message}`);
  }
}

// Ids con el formato del Coordinador (20 a 64 letras, números, _ o -).
const FEATURES = "area-features-0000000001";
const SUBAREA = "area-seo-000000000000001";
const SUBSUB = "area-seo-ideas-0000000001";
const OTRA_AREA = "area-ventas-0000000000001";
const AHORA = "2026-11-23T15:00:00.000Z";
const VENCE = "2026-11-23T15:05:00.000Z";
const REPOS = ["gestion", "aizencrm"];

const fuera = Array.from({ length: 60 }, (_, i) => {
  const n = String(i).padStart(2, "0");
  // Las 60 de fuera son MÁS VIEJAS que las de Features: sin el filtro antes del LIMIT, taparían a las de Features.
  return `('fuera-${n}', 'tab1', 'Aprobada de fuera ${n}', 'APROBADO', 'u-dueno', '2026-11-01 08:${n}:00', '2026-11-01 08:${n}:00', 'tarea', 'aizencrm', NULL, '${OTRA_AREA}', 0)`;
});

await db.exec(`
  INSERT INTO "User" ("id", "email", "password", "updatedAt") VALUES ('u-dueno', 'dueno@x.co', 'x', now());
  INSERT INTO "Workspace" ("id", "name", "slug", "updatedAt", "ownerId") VALUES ('ws1', 'Magilus', 'magilus', now(), 'u-dueno');
  INSERT INTO "TableroInteligente" ("id", "workspaceId", "nombre") VALUES ('tab1', 'ws1', 'Empresa Magilus');
  INSERT INTO "TipoTarjeta" ("id", "tableroId", "nombre", "requiereAprobacion", "usaEstados", "orden") VALUES
    ('area', 'tab1', 'Área', false, false, 0),
    ('tarea', 'tab1', 'Tarea', true, true, 2);
  INSERT INTO "TarjetaTablero" ("id", "tableroId", "titulo", "estado", "creadoPor", "creadoEn", "actualizadoEn", "tipoId", "repo", "plan", "padreId", "intentos") VALUES
    ('${FEATURES}', 'tab1', 'Features', 'IDEA', 'u-dueno', '2026-10-01 08:00:00', '2026-10-01 08:00:00', 'area', NULL, NULL, NULL, 0),
    ('${SUBAREA}', 'tab1', 'SEO Magilus', 'IDEA', 'u-dueno', '2026-10-01 08:00:00', '2026-10-01 08:00:00', 'area', NULL, NULL, '${FEATURES}', 0),
    ('${SUBSUB}', 'tab1', 'Ideas de mejora', 'IDEA', 'u-dueno', '2026-10-01 08:00:00', '2026-10-01 08:00:00', 'area', NULL, NULL, '${SUBAREA}', 0),
    ('${OTRA_AREA}', 'tab1', 'Ventas', 'IDEA', 'u-dueno', '2026-10-01 08:00:00', '2026-10-01 08:00:00', 'area', NULL, NULL, NULL, 0),
    ${fuera.join(",\n    ")},
    ('feat-sub', 'tab1', 'Idea SEO del martes', 'APROBADO', 'u-dueno', '2026-11-20 08:00:00', '2026-11-20 08:00:00', 'tarea', 'aizencrm', NULL, '${SUBSUB}', 0),
    ('fuera-plan', 'tab1', 'De fuera ya planeada', 'PLAN_APROBADO', 'u-dueno', '2026-11-21 08:00:00', '2026-11-21 08:00:00', 'tarea', 'aizencrm', 'El plan', '${OTRA_AREA}', 1),
    ('fuera-sube', 'tab1', 'De fuera subiendo', 'SUBIENDO', 'u-dueno', '2026-11-21 09:00:00', '2026-11-21 09:00:00', 'tarea', 'gestion', 'El plan', NULL, 2),
    ('fuera-sin-padre', 'tab1', 'Suelta sin área', 'APROBADO', 'u-dueno', '2026-11-01 07:00:00', '2026-11-01 07:00:00', 'tarea', 'gestion', NULL, NULL, 0),
    ('feat-borrada', 'tab1', 'De Features, borrada', 'APROBADO', 'u-dueno', '2026-11-01 06:00:00', '2026-11-01 06:00:00', 'tarea', 'aizencrm', NULL, '${SUBAREA}', 0);
  UPDATE "TarjetaTablero" SET "borradoEn" = '2026-11-02 08:00:00' WHERE "id" = 'feat-borrada';
`);

const ids = async (texto, valores) => (await db.query(texto, valores)).rows.map((fila) => fila.id);

// Lo de hoy, antes de cualquier cambio: las 50 primeras en el orden de siempre (SUBIENDO primero, después la más vieja).
const sinArea = await ids(sql.SQL_CANDIDATAS, ["ws1", REPOS]);

await prueba("con el id de Features y 60 aprobadas de fuera por delante, sale la de la sub-área y ninguna de fuera sin empezar", async () => {
  assert.equal(sinArea.length, 50, "sin filtro, el tope de 50 se llena con las de fuera");
  assert.ok(!sinArea.includes("feat-sub"), "sin filtro, las 60 de fuera tapan a la de Features (por eso el filtro va antes del LIMIT)");
  const conArea = await ids(sql.SQL_CANDIDATAS_EN_AREA, ["ws1", REPOS, FEATURES]);
  assert.ok(conArea.includes("feat-sub"), "la de una sub-área de Features (dos niveles abajo) sale");
  for (const id of conArea) assert.ok(!id.startsWith("fuera-") || id === "fuera-plan" || id === "fuera-sube", `no sale ${id}`);
  assert.ok(!conArea.includes("fuera-sin-padre"), "una suelta sin área y sin empezar no sale");
  assert.ok(!conArea.includes("feat-borrada"), "una borrada no sale");
});

await prueba("una de fuera ya empezada (intentos > 0) en PLAN_APROBADO y otra en SUBIENDO sí salen, en el orden de siempre", async () => {
  const conArea = await ids(sql.SQL_CANDIDATAS_EN_AREA, ["ws1", REPOS, FEATURES]);
  assert.deepEqual(conArea, ["fuera-sube", "feat-sub", "fuera-plan"], "SUBIENDO primero; después la más vieja (feat-sub es del 20-nov)");
});

await prueba("sin id, el resultado es el de hoy (la consulta de siempre, igual que antes del cambio)", async () => {
  assert.deepEqual(await ids(sql.SQL_CANDIDATAS, ["ws1", REPOS]), sinArea);
  assert.ok(!sql.SQL_CANDIDATAS.includes("WITH RECURSIVE baja"), "sin id no lleva el filtro del Área");
  assert.ok(!sql.SQL_TOMAR_UNA.includes("WITH RECURSIVE baja"));
  assert.deepEqual(sinArea.slice(0, 2), ["fuera-sube", "fuera-sin-padre"], "SUBIENDO primero y después la más vieja, como siempre");
});

await prueba("el filtro está antes del LIMIT 50 en /candidatas y en /tomar", async () => {
  for (const [nombre, texto] of [["SQL_CANDIDATAS_EN_AREA", sql.SQL_CANDIDATAS_EN_AREA], ["SQL_TOMAR_UNA_EN_AREA", sql.SQL_TOMAR_UNA_EN_AREA]]) {
    const filtro = texto.indexOf("WITH RECURSIVE baja");
    assert.ok(filtro > 0, nombre);
    assert.ok(filtro < texto.indexOf(`ORDER BY (c."estado" = 'SUBIENDO') DESC`), `${nombre}: el filtro va en el WHERE, antes del orden`);
    assert.ok(filtro < texto.lastIndexOf("LIMIT"), `${nombre}: antes del LIMIT`);
  }
});

await prueba("/tomar con el id: toma las ya empezadas y la de Features, y nunca una de fuera sin empezar", async () => {
  const tomar = () => ids(sql.SQL_TOMAR_UNA_EN_AREA, ["ws1", AHORA, REPOS, VENCE, [], FEATURES]);
  assert.deepEqual(await tomar(), ["fuera-sube"]);
  assert.deepEqual(await tomar(), ["feat-sub"]);
  assert.deepEqual(await tomar(), ["fuera-plan"]);
  assert.deepEqual(await tomar(), [], "no queda nada de Features ni empezado: las 60 de fuera esperan");
  const [{ n }] = (await db.query(`SELECT count(*)::int AS n FROM "TarjetaTablero" WHERE "id" LIKE 'fuera-__' AND "estado" = 'APROBADO' AND "intentos" = 0`)).rows;
  assert.equal(n, 60, "las 60 de fuera siguen APROBADO, sin tocar");
});

await prueba("/tomar sin id toma como hoy (la más vieja de fuera)", async () => {
  assert.deepEqual(await ids(sql.SQL_TOMAR_UNA, ["ws1", AHORA, REPOS, VENCE, []]), ["fuera-sin-padre"]);
});

await prueba("un id que no es un Área (o no existe) solo deja las ya empezadas", async () => {
  await db.exec(`UPDATE "TarjetaTablero" SET "estado" = 'APROBADO', "intentos" = 0, "trabajoVenceEn" = NULL WHERE "id" IN ('feat-sub')`);
  assert.deepEqual(await ids(sql.SQL_CANDIDATAS_EN_AREA, ["ws1", REPOS, "no-existe-000000000000001"]), []);
  // fuera-sin-padre quedó PLANEANDO con candado: ya no es candidata. La de Features vuelve a salir con su id.
  assert.deepEqual(await ids(sql.SQL_CANDIDATAS_EN_AREA, ["ws1", REPOS, FEATURES]), ["feat-sub"]);
});

await db.close();

/* ------------------------------------------------------------------ 2. el id que llega (formato) */

await prueba("areaPermitidaDeEntrada: el formato del Coordinador; lo demás es null", async () => {
  assert.equal(reglas.areaPermitidaDeEntrada(FEATURES), FEATURES);
  assert.equal(reglas.areaPermitidaDeEntrada(`  ${FEATURES} `), FEATURES);
  for (const raro of [undefined, null, "", "Features", "corto", 7, {}, [FEATURES], "x'; DROP TABLE x;--000000000", "a".repeat(65)]) {
    assert.equal(reglas.areaPermitidaDeEntrada(raro), null, String(raro));
  }
  // opcionesDeTomar no cambia: el id se lee aparte.
  assert.deepEqual(reglas.opcionesDeTomar({ areaPermitidaId: FEATURES }), { maxParalelo: 1, excluir: [] });
});

/* ------------------------------------------------------------------ 3. el latido guarda el id (prisma falso) */

const ajustes = new Map();
let escrituras = 0;
const prismaFalso = {
  appSetting: {
    upsert: async ({ where, create, update }) => {
      escrituras += 1;
      ajustes.set(where.key, ajustes.has(where.key) ? update.value : create.value);
    },
    findUnique: async ({ where }) => (ajustes.has(where.key) ? { value: ajustes.get(where.key) } : null),
    findMany: async ({ where }) => [...ajustes.entries()].filter(([key]) => key.startsWith(where.key.startsWith)).map(([key, value]) => ({ key, value })),
  },
};
class ErrorDelTrabajador extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}
const trabajadorFalso = { ErrorDelTrabajador };
const enVivo = cargar("src/features/tableros-inteligentes/services/coordinador-en-vivo.ts", {
  "@/lib/prisma": { prisma: prismaFalso },
  "@prisma/client": { Prisma: {} },
  "./trabajador": trabajadorFalso,
  "@/features/tableros-inteligentes/services/trabajador": trabajadorFalso,
  "./tableros": { linkDeLaTarjeta: (id) => `https://app.aizenbot.com/cliente/tablero-ia?tarjeta=${id}` },
});
const contexto = { workspaceId: "ws1", claveId: "k1", nombre: "aizen1" };

await prueba("el latido guarda el id de Features en AppSetting tablero:area-features:<negocio> y leerAreaFeatures lo devuelve", async () => {
  assert.equal(await enVivo.leerAreaFeatures("ws1"), null, "sin guardar, null");
  await enVivo.guardarLatido(contexto, { version: "1", areaPermitidaId: FEATURES });
  assert.equal(ajustes.get("tablero:area-features:ws1"), FEATURES);
  assert.equal(await enVivo.leerAreaFeatures("ws1"), FEATURES);
  assert.equal(await enVivo.leerAreaFeatures("ws2"), null, "otro negocio no lo ve");
  const antes = escrituras;
  await enVivo.guardarLatido(contexto, { version: "1", areaPermitidaId: FEATURES });
  assert.equal(escrituras, antes + 1, "el mismo id no se vuelve a escribir (solo el latido)");
});

await prueba("un latido sin id o con uno raro no borra ni cambia el guardado; un valor dañado se lee como null", async () => {
  await enVivo.guardarLatido(contexto, { version: "1" });
  await enVivo.guardarLatido(contexto, { version: "1", areaPermitidaId: "Features" });
  assert.equal(await enVivo.leerAreaFeatures("ws1"), FEATURES);
  ajustes.set("tablero:area-features:ws1", "esto no es un id");
  assert.equal(await enVivo.leerAreaFeatures("ws1"), null);
});

await prueba("las rutas leen el id del pedido y, si no viene, el guardado; el servicio elige la consulta con o sin el Área", async () => {
  const leer = (ruta) => fs.readFileSync(path.join(RAIZ, ruta), "utf8");
  const candidatas = leer("src/app/api/trabajador/tablero/candidatas/route.ts");
  assert.match(candidatas, /searchParams\.get\("areaPermitidaId"\)/);
  assert.match(candidatas, /leerAreaFeatures\(contexto\.workspaceId\)/);
  const tomar = leer("src/app/api/trabajador/tablero/tomar/route.ts");
  assert.match(tomar, /cuerpo\.areaPermitidaId/);
  assert.match(tomar, /searchParams\.get\("areaPermitidaId"\)/);
  assert.match(tomar, /leerAreaFeatures\(contexto\.workspaceId\)/);
  const servicio = leer("src/features/tableros-inteligentes/services/trabajador.ts");
  assert.match(servicio, /areaPermitidaId \? SQL_TOMAR_UNA_EN_AREA : SQL_TOMAR_UNA/);
  assert.match(servicio, /area \? SQL_CANDIDATAS_EN_AREA : SQL_CANDIDATAS/);
});

console.log(`\n${pruebas} pruebas OK`);
