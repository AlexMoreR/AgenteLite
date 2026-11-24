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

await prueba("SQL_POR_PREPARAR_EN_FEATURES: las de Features (sub-áreas incluidas) en IDEA o POR_APROBAR sin empezar, la más vieja primero", async () => {
  await db.exec(`
    INSERT INTO "TipoTarjeta" ("id", "tableroId", "nombre", "requiereAprobacion", "usaEstados", "orden") VALUES ('idea', 'tab1', 'Idea', false, true, 1);
    INSERT INTO "TarjetaTablero" ("id", "tableroId", "titulo", "estado", "creadoPor", "creadoEn", "actualizadoEn", "tipoId", "repo", "plan", "padreId", "intentos") VALUES
      ('prep-idea', 'tab1', 'Idea vieja de SEO', 'IDEA', 'u-dueno', '2026-11-02 08:00:00', '2026-11-02 08:00:00', 'idea', NULL, NULL, '${SUBSUB}', 0),
      ('prep-porapr', 'tab1', 'Tarea por aprobar', 'POR_APROBAR', 'u-dueno', '2026-11-03 08:00:00', '2026-11-03 08:00:00', 'tarea', NULL, NULL, '${FEATURES}', 0),
      ('prep-empezada', 'tab1', 'Ya empezada', 'IDEA', 'u-dueno', '2026-11-01 08:00:00', '2026-11-01 08:00:00', 'idea', NULL, NULL, '${SUBAREA}', 1),
      ('prep-aprobada', 'tab1', 'Ya aprobada', 'APROBADO', 'u-dueno', '2026-11-01 08:00:00', '2026-11-01 08:00:00', 'tarea', 'aizencrm', NULL, '${SUBAREA}', 0),
      ('prep-fuera', 'tab1', 'Idea de Ventas', 'IDEA', 'u-dueno', '2026-11-01 08:00:00', '2026-11-01 08:00:00', 'idea', NULL, NULL, '${OTRA_AREA}', 0),
      ('prep-archivada', 'tab1', 'Archivada', 'IDEA', 'u-dueno', '2026-11-01 08:00:00', '2026-11-01 08:00:00', 'idea', NULL, NULL, '${SUBAREA}', 0),
      ('prep-borrada', 'tab1', 'Borrada', 'IDEA', 'u-dueno', '2026-11-01 08:00:00', '2026-11-01 08:00:00', 'idea', NULL, NULL, '${SUBAREA}', 0);
    UPDATE "TarjetaTablero" SET "archivadaEn" = '2026-11-05 08:00:00' WHERE "id" = 'prep-archivada';
    UPDATE "TarjetaTablero" SET "borradoEn" = '2026-11-05 08:00:00' WHERE "id" = 'prep-borrada';
  `);
  // Las sub-áreas (tipo Área, sin estados) no salen aunque estén en IDEA; tampoco las empezadas, aprobadas, de fuera, archivadas o borradas.
  assert.deepEqual(await ids(sql.SQL_POR_PREPARAR_EN_FEATURES, [FEATURES, "ws1"]), ["prep-idea", "prep-porapr"]);
  assert.deepEqual(await ids(sql.SQL_POR_PREPARAR_EN_FEATURES, [FEATURES, "ws2"]), [], "otro negocio no ve las de este");
  assert.deepEqual(await ids(sql.SQL_POR_PREPARAR_EN_FEATURES, [OTRA_AREA, "ws1"]), ["prep-fuera"]);
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

/* ------------------------------------------------------------------ 4. repoPorElTexto (puro) */

const { repoPorElTexto } = cargar("src/features/tableros-inteligentes/services/repo-por-el-texto.ts");

await prueba("repoPorElTexto: un lado, los dos sistemas, mayoría clara y la duda", async () => {
  assert.equal(repoPorElTexto("Arreglar alerta del tablero", ""), "aizencrm");
  assert.equal(repoPorElTexto("Que el BOT conteste en WhatsApp", null), "aizencrm");
  assert.equal(repoPorElTexto("Órdenes de producción", "Que la proveedora vea sus pedidos en magilus.com"), "gestion");
  assert.equal(repoPorElTexto("Cotizaciones", "Mostrar la COTIZACIÓN con tilde"), "gestion", "sin tildes ni mayúsculas");
  assert.equal(repoPorElTexto("Cotizaciones en Gestión y aviso en el CRM", ""), "los-dos");
  assert.equal(repoPorElTexto("Mejorar esto", ""), null, "sin ninguna palabra pregunta");
  assert.equal(repoPorElTexto("", undefined), null);
  assert.equal(repoPorElTexto("Ventas y pedidos", "que la asesora lo vea"), "gestion", "dos de Gestión contra uno del CRM: mayoría clara");
  assert.equal(repoPorElTexto("La venta en el chat", ""), null, "uno y uno sin nombrar los sistemas: ante la duda, pregunta");
  assert.equal(repoPorElTexto("Arreglar el botón de ordenar", "boton"), null, "'bot' no es 'botón' ni 'orden' es 'ordenar'");
});

/* ------------------------------------------------------------------ 5. prepararFeatures (prisma falso en memoria) */

// Comparte las filas de AppSetting con el prisma del latido: leerAreaFeatures (ya cargado) lee de ahí.
const mundo = { tarjetas: new Map(), historial: [], alertas: [], tipos: [], padres: new Set(), creadas: 0 };
const DbNull = Symbol("DbNull");
const conTipo = (t) => (t ? { ...t, tipo: mundo.tipos.find((k) => k.id === t.tipoId), tablero: { workspaceId: "ws1" } } : null);
const cumple = (fila, where = {}) =>
  Object.entries(where).every(([campo, esperado]) => {
    if (campo === "tablero") return true;
    const valor = fila[campo];
    if (esperado instanceof Date) return valor instanceof Date && valor.getTime() === esperado.getTime();
    if (esperado && typeof esperado === "object" && "in" in esperado) return esperado.in.includes(valor);
    if (esperado && typeof esperado === "object" && "not" in esperado) return valor !== esperado.not;
    if (esperado && typeof esperado === "object" && "isEmpty" in esperado) return ((valor ?? []).length === 0) === esperado.isEmpty;
    return (valor ?? null) === esperado;
  });
const baja = (area) => {
  const fuera = [];
  let nivel = [area];
  for (let n = 0; n < 50 && nivel.length; n += 1) {
    nivel = [...mundo.tarjetas.values()].filter((t) => nivel.includes(t.padreId) && !t.borradoEn).map((t) => t.id);
    fuera.push(...nivel);
  }
  return fuera;
};
const dbFeatures = {
  appSetting: prismaFalso.appSetting,
  $queryRawUnsafe: async (texto, area, negocio) => {
    assert.equal(texto, sql.SQL_POR_PREPARAR_EN_FEATURES);
    if (negocio !== "ws1") return [];
    return baja(area)
      .map((id) => conTipo(mundo.tarjetas.get(id)))
      .filter((t) => !t.borradoEn && !t.archivadaEn && ["IDEA", "POR_APROBAR"].includes(t.estado) && t.intentos === 0 && t.tipo.usaEstados)
      .sort((a, b) => a.creadoEn - b.creadoEn)
      .map((t) => ({ id: t.id }));
  },
  tarjetaTablero: {
    findFirst: async ({ where }) => conTipo([...mundo.tarjetas.values()].find((t) => cumple(t, where))),
    findMany: async ({ where }) => [...mundo.tarjetas.values()].filter((t) => cumple(t, where)).map(conTipo),
    count: async ({ where }) => [...mundo.tarjetas.values()].filter((t) => cumple(t, where)).length,
    updateMany: async ({ where, data }) => {
      const filas = [...mundo.tarjetas.values()].filter((t) => cumple(t, where));
      for (const t of filas) Object.assign(t, data, { actualizadoEn: new Date(t.actualizadoEn.getTime() + 1000) });
      return { count: filas.length };
    },
    create: async ({ data }) => {
      mundo.creadas += 1;
      const fila = { id: `hija-${mundo.creadas}`, intentos: 0, borradoEn: null, archivadaEn: null, plan: null, creadoEn: new Date(), actualizadoEn: new Date(), ...data };
      mundo.tarjetas.set(fila.id, fila);
      return { id: fila.id };
    },
  },
  historialTarjeta: {
    create: async ({ data }) => {
      mundo.historial.push({ ...data, creadoEn: new Date() });
      return data;
    },
    findMany: async ({ where, orderBy, take }) => {
      const filas = mundo.historial.filter((f) => f.tarjetaId === where.tarjetaId && (!where.accion || f.accion === where.accion));
      return (orderBy?.creadoEn === "desc" ? [...filas].reverse() : filas).slice(0, take ?? 1000);
    },
  },
  tipoTarjeta: { findMany: async ({ where }) => mundo.tipos.filter((k) => k.tableroId === where.tableroId) },
  tipoTarjetaPadre: {
    findUnique: async ({ where }) => {
      const { tipoId, tipoPadreId } = where.tipoId_tipoPadreId;
      return mundo.padres.has(`${tipoId}|${tipoPadreId}`) ? { tipoId } : null;
    },
  },
  tableroInteligente: { update: async () => ({}) },
  alertaInterna: {
    findFirst: async ({ where }) =>
      mundo.alertas.find((a) => a.workspaceId === where.workspaceId && a.clave === where.clave && a.destinatarioId === where.destinatarioId && where.estado.in.includes(a.estado)) ?? null,
    create: async ({ data }) => {
      const fila = { id: `al-${mundo.alertas.length + 1}`, estado: "NUEVA", veces: 1, ...data };
      mundo.alertas.push(fila);
      return { id: fila.id };
    },
    update: async ({ where, data }) => {
      const fila = mundo.alertas.find((a) => a.id === where.id);
      fila.veces += 1;
      Object.assign(fila, { ...data, veces: fila.veces });
    },
    updateMany: async () => ({ count: 0 }),
  },
  workspace: { findUnique: async () => ({ ownerId: "u-dueno" }) },
  $transaction: async (fn) => fn(dbFeatures),
};
const enviadosPorWhatsApp = [];
const preparar = cargar("src/features/tableros-inteligentes/services/preparar-features.ts", {
  "@/lib/prisma": { prisma: dbFeatures },
  "@prisma/client": { Prisma: { DbNull } },
  "@/lib/evolution": { sendEvolutionTextMessageWithReconnect: async (datos) => void enviadosPorWhatsApp.push(datos) },
  "./tableros": {
    QUIEN_TRABAJADOR: "trabajador:",
    linkDeLaTarjeta: (id) => `https://app.aizenbot.com/cliente/tablero-ia?tarjeta=${id}`,
    linkDeHoy: () => "https://app.aizenbot.com/cliente/tablero-ia?vista=hoy",
    linkDelCoordinador: () => "https://app.aizenbot.com/cliente/tablero-ia?vista=coordinador",
    pendientesDelDueno: async () => [],
    todoElNegocio: (workspaceId) => ({ workspaceId, soloDe: null }),
  },
});

const T_VIEJA = new Date("2026-11-20T08:00:00Z");
let orden = 0;
function sembrar() {
  mundo.tarjetas.clear();
  mundo.historial.length = 0;
  mundo.alertas.length = 0;
  mundo.creadas = 0;
  enviadosPorWhatsApp.length = 0;
  mundo.tipos = [
    { id: "k-area", tableroId: "tab1", nombre: "Área", requiereAprobacion: false, usaEstados: false, orden: 0 },
    { id: "k-idea", tableroId: "tab1", nombre: "Idea", requiereAprobacion: false, usaEstados: true, orden: 1 },
    { id: "k-tarea", tableroId: "tab1", nombre: "Tarea", requiereAprobacion: true, usaEstados: true, orden: 2 },
  ];
  mundo.padres = new Set(["k-idea|k-area", "k-tarea|k-idea", "k-tarea|k-area", "k-area|k-area"]);
  const poner = (id, datos) => {
    orden += 1;
    mundo.tarjetas.set(id, {
      id,
      tableroId: "tab1",
      titulo: id,
      detalle: "",
      estado: "IDEA",
      repo: null,
      intentos: 0,
      tipoId: "k-idea",
      padreId: SUBAREA,
      area: null,
      orden: 0,
      zonaProtegida: [],
      riesgo: null,
      riesgoMotivo: null,
      riesgoPor: null,
      prioridad: "MEDIA",
      creadoPor: "u-dueno",
      plan: null,
      borradoEn: null,
      archivadaEn: null,
      creadoEn: new Date(T_VIEJA.getTime() + orden * 60_000),
      actualizadoEn: T_VIEJA,
      ...datos,
    });
  };
  poner(FEATURES, { titulo: "Features", tipoId: "k-area", padreId: null });
  poner(SUBAREA, { titulo: "SEO Magilus", tipoId: "k-area", padreId: FEATURES });
  poner(OTRA_AREA, { titulo: "Ventas", tipoId: "k-area", padreId: null });
  poner("i-alerta", { titulo: "Arreglar alerta del tablero" });
  poner("i-dos", { titulo: "Cotizaciones en Gestión y aviso en el CRM", detalle: "La cotización se guarda y la asesora recibe el aviso." });
  poner("i-mejorar", { titulo: "Mejorar esto", padreId: FEATURES });
  poner("i-abonos", { titulo: "Registrar los abonos de cada venta en Gestión" });
  poner("i-madre", { titulo: "Idea grande del tablero" });
  poner("i-madre-hija", { titulo: "Parte ya aprobada", tipoId: "k-tarea", repo: "aizencrm", estado: "APROBADO", padreId: "i-madre" });
  poner("i-fuera", { titulo: "Arreglar el chat de ventas", padreId: OTRA_AREA });
  poner("i-empezada", { titulo: "Arreglar el bot", intentos: 1 });
}
const tarjeta = (id) => mundo.tarjetas.get(id);
const historialDe = (id) => mundo.historial.filter((f) => f.tarjetaId === id);
const hijasDe = (id) => [...mundo.tarjetas.values()].filter((t) => t.padreId === id && !t.borradoEn);
const AHORA_FEATURES = new Date("2026-11-24T15:00:00Z");

// El id de Features ya guardado por el latido (parte 1) y "Aprobar tareas solo" sin fila (prendido, como en producción).
ajustes.set("tablero:area-features:ws1", FEATURES);

await prueba("prepararFeatures: 'Arreglar alerta del tablero' (Idea sin repo en una sub-área) queda Tarea, aizencrm y APROBADO", async () => {
  sembrar();
  const r = await preparar.prepararFeatures("ws1", AHORA_FEATURES);
  const t = tarjeta("i-alerta");
  assert.equal(t.tipoId, "k-tarea");
  assert.equal(t.repo, "aizencrm");
  assert.equal(t.estado, "APROBADO");
  const filas = historialDe("i-alerta");
  const editar = filas.find((f) => f.accion === "editar");
  assert.ok(editar, "deja el 'editar'");
  assert.deepEqual(editar.antes, { tipoId: "k-idea", repo: null, estado: "IDEA" });
  assert.equal(editar.despues.tipoId, "k-tarea");
  assert.equal(editar.despues.repo, "aizencrm");
  assert.equal(editar.quien, preparar.QUIEN_FEATURES_SOLAS);
  const aprobar = filas.find((f) => f.accion === "aprobar");
  assert.ok(aprobar, "deja el 'aprobar'");
  assert.equal(aprobar.despues.via, "automatica");
  assert.equal(aprobar.despues.momento, "tarea");
  assert.ok(r.aprobadas >= 1 && r.pasadasATarea >= 1);
  assert.equal(enviadosPorWhatsApp.length, 0, "no manda WhatsApp");
});

await prueba("prepararFeatures: 'Cotizaciones en Gestión y aviso en el CRM' queda como madre y nacen dos Tareas hijas (gestion y aizencrm)", async () => {
  sembrar();
  await preparar.prepararFeatures("ws1", AHORA_FEATURES);
  const madre = tarjeta("i-dos");
  assert.equal(madre.tipoId, "k-idea", "la madre no cambia de tipo");
  assert.equal(madre.repo, null, "ni de repo");
  assert.equal(madre.estado, "IDEA", "ni de estado");
  assert.equal(madre.actualizadoEn.getTime(), T_VIEJA.getTime(), "ni se edita");
  const hijas = hijasDe("i-dos");
  assert.deepEqual(hijas.map((h) => h.repo).sort(), ["aizencrm", "gestion"]);
  for (const hija of hijas) {
    assert.equal(hija.tipoId, "k-tarea");
    assert.equal(hija.titulo, madre.titulo);
    assert.ok(hija.detalle.startsWith(madre.detalle), "el mismo detalle");
    assert.match(hija.detalle, hija.repo === "gestion" ? /PARTE DE GESTIÓN/ : /PARTE DEL CRM/, "con la aclaración de su parte");
    assert.equal(hija.estado, "APROBADO", "y siguen la aprobación de siempre");
    assert.ok(historialDe(hija.id).some((f) => f.accion === "crear" && f.despues.madreFeatures === "i-dos"));
  }
  // Otra vuelta: no se vuelve a partir (la madre es una Idea con hijas).
  await preparar.prepararFeatures("ws1", AHORA_FEATURES);
  assert.equal(hijasDe("i-dos").length, 2, "no se parte dos veces");
});

await prueba("prepararFeatures: una Tarea sin repo de los dos sistemas cuyas hijas no pueden colgar de ella tampoco se parte dos veces", async () => {
  sembrar();
  mundo.padres.delete("k-tarea|k-tarea");
  mundo.tarjetas.get("i-dos").tipoId = "k-tarea";
  mundo.tarjetas.get("i-dos").estado = "POR_APROBAR";
  await preparar.prepararFeatures("ws1", AHORA_FEATURES);
  const hermanas = [...mundo.tarjetas.values()].filter((t) => t.titulo === "Cotizaciones en Gestión y aviso en el CRM" && t.id !== "i-dos");
  assert.equal(hermanas.length, 2);
  assert.ok(hermanas.every((h) => h.padreId === SUBAREA), "cuelgan del mismo lugar que la original");
  await preparar.prepararFeatures("ws1", AHORA_FEATURES);
  assert.equal([...mundo.tarjetas.values()].filter((t) => t.titulo === "Cotizaciones en Gestión y aviso en el CRM").length, 3, "la marca en la madre lo impide");
  assert.equal(tarjeta("i-dos").repo, null);
  assert.equal(tarjeta("i-dos").estado, "POR_APROBAR");
});

await prueba("prepararFeatures: 'Mejorar esto' queda sin repo y sin arrancar, con la pregunta en el historial y la alerta coord:necesita abierta", async () => {
  sembrar();
  const r = await preparar.prepararFeatures("ws1", AHORA_FEATURES);
  const t = tarjeta("i-mejorar");
  assert.equal(t.repo, null);
  assert.equal(t.estado, "IDEA");
  assert.equal(t.tipoId, "k-idea");
  const pregunta = historialDe("i-mejorar").filter((f) => typeof f.despues?.preguntaFeatures === "string");
  assert.equal(pregunta.length, 1);
  assert.match(pregunta[0].despues.nota, /El Coordinador pregunta/);
  const alerta = mundo.alertas.filter((a) => a.clave.startsWith("coord:necesita:i-mejorar:"));
  assert.equal(alerta.length, 1);
  assert.equal(alerta[0].estado, "NUEVA");
  assert.equal(alerta[0].origen, "Coordinador");
  assert.equal(r.preguntadas, 1);
  // Otra vuelta con el mismo texto: ni otra pregunta ni otra alerta.
  await preparar.prepararFeatures("ws1", AHORA_FEATURES);
  assert.equal(historialDe("i-mejorar").length, 1, "no repite la pregunta");
  assert.equal(mundo.alertas.filter((a) => a.clave.startsWith("coord:necesita:i-mejorar:")).length, 1);
  // El dueño edita el detalle: la vuelta siguiente lo vuelve a leer y la pone en marcha.
  Object.assign(tarjeta("i-mejorar"), { detalle: "Es del chat del CRM: que cargue más rápido", actualizadoEn: new Date("2026-11-24T15:10:00Z") });
  await preparar.prepararFeatures("ws1", AHORA_FEATURES);
  assert.equal(tarjeta("i-mejorar").repo, "aizencrm");
  assert.equal(tarjeta("i-mejorar").estado, "APROBADO");
});

await prueba("prepararFeatures: la que habla de abonos queda POR_APROBAR con la alerta auto:necesita:<id>:POR_APROBAR", async () => {
  sembrar();
  const r = await preparar.prepararFeatures("ws1", AHORA_FEATURES);
  const t = tarjeta("i-abonos");
  assert.equal(t.repo, "gestion");
  assert.equal(t.tipoId, "k-tarea");
  assert.equal(t.estado, "POR_APROBAR");
  assert.ok(!historialDe("i-abonos").some((f) => f.accion === "aprobar"), "no se aprueba sola");
  const alerta = mundo.alertas.find((a) => a.clave === "auto:necesita:i-abonos:POR_APROBAR");
  assert.ok(alerta, "la alerta del sí del dueño");
  assert.equal(alerta.estado, "NUEVA");
  assert.match(alerta.detalle, /dinero de Gestión/);
  assert.equal(r.esperanAlDueno, 1);
  // Otra vuelta: la misma alerta, sin duplicar.
  await preparar.prepararFeatures("ws1", AHORA_FEATURES);
  assert.equal(mundo.alertas.filter((a) => a.clave === "auto:necesita:i-abonos:POR_APROBAR").length, 1);
  assert.equal(alerta.veces, 1, "ni la refresca");
  // El dueño la cierra y la tarjeta sigue esperando: la vuelta siguiente no la reabre (eso lo deciden los avisos de siempre).
  alerta.estado = "RESUELTA";
  await preparar.prepararFeatures("ws1", AHORA_FEATURES);
  assert.equal(mundo.alertas.filter((a) => a.clave === "auto:necesita:i-abonos:POR_APROBAR" && a.estado !== "RESUELTA").length, 0, "no se reabre");
  assert.equal(tarjeta("i-abonos").estado, "POR_APROBAR");
});

await prueba("prepararFeatures: no toca una Idea con hijas, una de fuera de Features ni una ya empezada", async () => {
  sembrar();
  await preparar.prepararFeatures("ws1", AHORA_FEATURES);
  for (const id of ["i-madre", "i-fuera", "i-empezada"]) {
    assert.equal(tarjeta(id).tipoId, "k-idea", id);
    assert.equal(tarjeta(id).repo, null, id);
    assert.equal(tarjeta(id).estado, "IDEA", id);
    assert.equal(historialDe(id).length, 0, id);
  }
  assert.equal(tarjeta("i-madre-hija").estado, "APROBADO");
  for (const id of [FEATURES, SUBAREA, OTRA_AREA]) assert.equal(historialDe(id).length, 0, `el Área ${id} no se toca`);
});

await prueba("prepararFeatures: con el interruptor apagado (o sin el id de Features) no hace nada", async () => {
  sembrar();
  ajustes.set("tablero:features-solas:ws1", "false");
  const r = await preparar.prepararFeatures("ws1", AHORA_FEATURES);
  assert.equal(r.revisadas, 0);
  assert.equal(mundo.historial.length, 0);
  assert.equal(mundo.alertas.length, 0);
  assert.equal(tarjeta("i-alerta").estado, "IDEA");
  assert.equal(tarjeta("i-alerta").repo, null);
  assert.equal(await preparar.featuresSolasPrendido("ws1"), false);
  ajustes.delete("tablero:features-solas:ws1");
  assert.equal(await preparar.featuresSolasPrendido("ws1"), true, "sin la fila está prendido");
  // Sin el id guardado tampoco.
  ajustes.delete("tablero:area-features:ws1");
  assert.equal((await preparar.prepararFeatures("ws1", AHORA_FEATURES)).revisadas, 0);
  assert.equal(mundo.historial.length, 0);
  ajustes.set("tablero:area-features:ws1", FEATURES);
});

await prueba("prepararFeaturesDeTodos: recorre los negocios con el id de Features guardado; el cron la llama con su try/catch", async () => {
  sembrar();
  await preparar.prepararFeaturesDeTodos(AHORA_FEATURES);
  assert.equal(tarjeta("i-alerta").estado, "APROBADO");
  const cron = fs.readFileSync(path.join(RAIZ, "src/app/api/cron/follows/route.ts"), "utf8");
  const bloque = cron.slice(cron.indexOf("await prepararFeaturesDeTodos()") - 400, cron.indexOf("await aprobarSolasLasPendientes()"));
  assert.match(bloque, /try \{[\s\S]*await prepararFeaturesDeTodos\(\);[\s\S]*\} catch \(error\) \{/);
  const mcp = fs.readFileSync(path.join(RAIZ, "src/lib/mcp/que-es-esta-aplicacion.ts"), "utf8");
  assert.match(mcp, /features_solas_tablero: await estadoDeFeaturesSolas\(workspaceId\)/);
});

/* ------------------------------------------------------------------ 6. tarjetas de Features que no arrancan (auto:quieta) */

const reglasDeAlertas = cargar("src/features/alertas/dominio/reglas.ts");
// Un mundo chico para leerSituacion: Features, una sub-área y sus tarjetas, con el historial y las alertas abiertas.
// avisos-al-dueno.ts ya quedó cargado (lo importa preparar-features.ts) con el prisma falso de la sección 5: se le cambian
// las tablas que lee leerSituacion. El id de Features y el latido salen de los mismos AppSetting falsos (`ajustes`).
const quietas = { tarjetas: [], historial: [], alertas: [], fueraPorLaVia: [] };
Object.assign(dbFeatures, {
  tarjetaTablero: {
    findMany: async ({ where }) =>
      where?.padreId?.in
        ? quietas.tarjetas
            .filter((t) => where.padreId.in.includes(t.padreId) && !t.borradoEn && !t.archivadaEn)
            .map((t) => ({ entrantes: [], ...t, tipo: { usaEstados: t.usaEstados ?? true } }))
        : [],
    count: async () => 0,
  },
  historialTarjeta: {
    groupBy: async () => [],
    findMany: async ({ where }) => quietas.historial.filter((f) => where.tarjetaId.in.includes(f.tarjetaId) && f.accion === where.accion && !f.deshechoEn),
  },
  alertaInterna: {
    findMany: async ({ where }) => quietas.alertas.filter((a) => where.estado.in.includes(a.estado) && a.clave.startsWith(where.clave.startsWith)),
  },
  $queryRawUnsafe: async () => quietas.fueraPorLaVia,
});
const avisos = cargar("src/features/tableros-inteligentes/services/avisos-al-dueno.ts");

const AHORA_Q = new Date("2026-11-24T15:00:00Z");
const haceHoras = (h) => new Date(AHORA_Q.getTime() - h * 3_600_000);
const quieta = (datos) => ({
  id: "q-1",
  titulo: "Mejorar el filtro de alertas",
  estado: "APROBADO",
  intentos: 0,
  enFeatures: true,
  entroEn: haceHoras(25),
  repo: "aizencrm",
  preguntaAbierta: false,
  esperaTuSi: null,
  dependeDe: null,
  fueraPorLaVia: null,
  ...datos,
});
// El Coordinador en línea (latido de hace 1 min) y libre.
const situacionQ = (lista, extra = {}) => ({ latidoEn: haceHoras(1 / 60).toISOString(), enCurso: [], enFila: 0, esperando: [], quietasDeFeatures: lista, ...extra });
const quietasDe = (situacion, ahora = AHORA_Q) => avisos.calcularAvisos(situacion, ahora).filter((a) => a.tipo === "quieta");

await prueba("calcularAvisos: una de Features creada hace 25 h y nunca tomada sale como auto:quieta:<id>:APROBADO con su motivo", async () => {
  const [aviso, ...resto] = quietasDe(situacionQ([quieta()]));
  assert.equal(resto.length, 0);
  assert.equal(aviso.clave, "auto:quieta:q-1:APROBADO");
  assert.equal(aviso.prioridad, "MEDIA", "solo la página");
  assert.match(aviso.titulo, /"Mejorar el filtro de alertas" lleva más de 24 h en Features sin arrancar: nadie la ha tomado todavía/);
  assert.match(aviso.lineas.join("\n"), /\(25 h\)[\s\S]*Motivo: nadie la ha tomado todavía/);
  assert.equal(aviso.link, "https://app.aizenbot.com/cliente/tablero-ia?tarjeta=q-1");
  assert.equal(reglasDeAlertas.idDeTarjetaDeLaClave(aviso.clave), "q-1", "la clave es de tarjeta: tiene área y la cierra el barrido");
});

await prueba("calcularAvisos: a las 23 h, ya tomada, en otro estado o de fuera de Features no sale", async () => {
  assert.deepEqual(quietasDe(situacionQ([quieta({ entroEn: haceHoras(23) })])), []);
  assert.deepEqual(quietasDe(situacionQ([quieta({ enFeatures: false })])), [], "de fuera de Features");
  assert.deepEqual(quietasDe(situacionQ([quieta({ intentos: 1 })])), [], "ya la tomó el Coordinador");
  for (const estado of ["PLANEANDO", "EN_CURSO", "POR_REVISAR", "HECHO", "ERROR", "PLAN_LISTO"]) assert.deepEqual(quietasDe(situacionQ([quieta({ estado })])), [], estado);
  for (const estado of ["IDEA", "POR_APROBAR", "PLAN_APROBADO"]) assert.equal(quietasDe(situacionQ([quieta({ estado })]))[0]?.clave, `auto:quieta:q-1:${estado}`);
  assert.deepEqual(quietasDe({ latidoEn: null, enCurso: [], enFila: 0, esperando: [] }), [], "sin la lista (sin id de Features), nada");
});

await prueba("el motivo: falta repo con pregunta, espera tu sí, depende de otra, canal que no arranca, Coordinador caído u ocupado", async () => {
  const motivo = (datos, extra) => quietasDe(situacionQ([quieta(datos)], extra))[0].lineas[1];
  assert.match(motivo({ repo: null, preguntaAbierta: true, estado: "IDEA" }), /falta el repositorio y espera tu respuesta/);
  assert.match(motivo({ estado: "POR_APROBAR", esperaTuSi: "toca Meta Ads" }), /espera tu sí \(toca Meta Ads\)/);
  assert.match(motivo({ dependeDe: "Parte 1 del tablero" }), /depende de «Parte 1 del tablero»/);
  assert.match(motivo({ fueraPorLaVia: "Libro V3" }), /aprobada por un canal que no la deja arrancar \(Libro V3\)/);
  assert.match(motivo({}, { latidoEn: haceHoras(1).toISOString() }), /Coordinador está caído/);
  assert.match(motivo({}, { latidoEn: null }), /Coordinador está caído/, "sin latido nunca");
  assert.match(motivo({}, { coordinadorOcupado: true }), /Coordinador está ocupado/);
  assert.match(motivo({ repo: null }), /falta el repositorio$/);
});

await prueba("una POR_APROBAR de 'abonos' con 25 h sale con el motivo 'espera tu sí' (motivoDeEsperaTuSi)", async () => {
  const tarjeta = { id: "q-abonos", titulo: "Registrar los abonos de cada venta en Gestión", detalle: "", estado: "POR_APROBAR", zonaProtegida: [] };
  const motivo = avisos.motivoDeEsperaTuSi(tarjeta);
  assert.ok(motivo, "espera el sí del dueño (dinero de Gestión)");
  assert.equal(avisos.motivoDeEsperaTuSi({ ...tarjeta, estado: "APROBADO" }), null, "solo POR_APROBAR");
  const [aviso] = quietasDe(situacionQ([quieta({ id: "q-abonos", titulo: tarjeta.titulo, estado: "POR_APROBAR", repo: "gestion", esperaTuSi: motivo })]));
  assert.equal(aviso.clave, "auto:quieta:q-abonos:POR_APROBAR");
  assert.match(aviso.titulo, /espera tu sí/);
});

await prueba("alertaYaNoAplica cierra auto:quieta cuando cambia el estado o el Coordinador la toma (intentos > 0)", async () => {
  const clave = "auto:quieta:q-1:APROBADO";
  assert.equal(reglasDeAlertas.alertaYaNoAplica(clave, { estado: "APROBADO", borradoEn: null, intentos: 0 }), false, "sigue igual: sigue abierta");
  assert.equal(reglasDeAlertas.alertaYaNoAplica(clave, { estado: "PLANEANDO", borradoEn: null, intentos: 0 }), true, "cambió de estado");
  assert.equal(reglasDeAlertas.alertaYaNoAplica(clave, { estado: "APROBADO", borradoEn: null, intentos: 1 }), true, "ya la tomaron");
  assert.equal(reglasDeAlertas.alertaYaNoAplica(clave, { estado: "APROBADO", borradoEn: new Date() }), true, "borrada");
  assert.equal(reglasDeAlertas.alertaYaNoAplica(clave, null), true, "no existe");
  assert.equal(reglasDeAlertas.motivoCierraLaClave("CIERRE", clave, "q-1"), true, "al cerrar la tarjeta también");
  assert.equal(reglasDeAlertas.motivoCierraLaClave("APROBACION", clave, "q-1"), false, "aprobar la cierra por el cambio de estado, en el barrido");
});

await prueba("entradaAFeatures: el último 'mover' (editar con padreId) a Features o una sub-área; sin él, la creación", async () => {
  const delArbol = new Set([FEATURES, SUBAREA]);
  const creado = haceHoras(100);
  assert.equal(reglasDeAlertas.entradaAFeatures([], delArbol, creado).getTime(), creado.getTime());
  const filas = [
    { accion: "editar", creadoEn: haceHoras(50), despues: { padreId: FEATURES, movimiento: true } },
    { accion: "editar", creadoEn: haceHoras(20), despues: { padreId: SUBAREA, movimiento: true } },
    { accion: "editar", creadoEn: haceHoras(10), despues: { padreId: OTRA_AREA } },
    { accion: "editar", creadoEn: haceHoras(5), despues: { padreId: SUBAREA }, deshechoEn: haceHoras(4) },
    { accion: "estado", creadoEn: haceHoras(2), despues: { padreId: SUBAREA } },
    { accion: "editar", creadoEn: haceHoras(1), despues: { titulo: "otro" } },
  ];
  assert.equal(reglasDeAlertas.entradaAFeatures(filas, delArbol, creado).getTime(), haceHoras(20).getTime());
});

await prueba("leerSituacion: lee las de Features (sub-áreas incluidas) con el historial y la pregunta abierta; sin id no lee nada", async () => {
  ajustes.set("tablero:area-features:ws1", FEATURES);
  const t = (id, datos) => ({ id, titulo: id, detalle: "", estado: "APROBADO", intentos: 0, repo: "aizencrm", zonaProtegida: [], creadoEn: haceHoras(25), padreId: SUBAREA, ...datos });
  quietas.tarjetas = [
    t(SUBAREA, { titulo: "SEO Magilus", estado: "IDEA", padreId: FEATURES, usaEstados: false, creadoEn: haceHoras(900) }),
    t("q-vieja"),
    t("q-movida", { creadoEn: haceHoras(500) }),
    t("q-nueva", { creadoEn: haceHoras(23) }),
    t("q-tomada", { intentos: 2 }),
    t("q-sinrepo", { repo: null, estado: "IDEA" }),
    t("q-depende", { entrantes: [{ origen: { titulo: "La parte 1" } }] }),
    t("q-voz", { zonaProtegida: ["META_ADS"] }),
    t("q-fuera", { padreId: OTRA_AREA }),
  ];
  quietas.historial = [{ tarjetaId: "q-movida", accion: "editar", creadoEn: haceHoras(10), despues: { padreId: SUBAREA, movimiento: true } }];
  quietas.alertas = [{ clave: "coord:necesita:q-sinrepo:¿De qué sistema es?", estado: "NUEVA" }];
  quietas.fueraPorLaVia = [{ id: "q-voz", titulo: "q-voz", estado: "APROBADO", zonaProtegida: ["META_ADS"], via: "voz" }];
  const situacion = await avisos.leerSituacion("ws1", AHORA_Q);
  const claves = quietasDe(situacion).map((a) => a.clave).sort();
  assert.deepEqual(claves, ["auto:quieta:q-depende:APROBADO", "auto:quieta:q-sinrepo:IDEA", "auto:quieta:q-vieja:APROBADO", "auto:quieta:q-voz:APROBADO"]);
  const porId = new Map(quietasDe(situacion).map((a) => [reglasDeAlertas.idDeTarjetaDeLaClave(a.clave), a.lineas[1]]));
  assert.match(porId.get("q-sinrepo"), /falta el repositorio y espera tu respuesta/);
  assert.match(porId.get("q-depende"), /depende de «La parte 1»/);
  assert.match(porId.get("q-voz"), /canal que no la deja arrancar \(Meta Ads\)/);
  assert.ok(!claves.some((c) => c.includes("q-movida")), "se movió a Features hace 10 h: todavía no");
  // Sin el id de Features no sale nada.
  ajustes.delete("tablero:area-features:ws1");
  assert.deepEqual(quietasDe(await avisos.leerSituacion("ws1", AHORA_Q)), []);
  assert.equal(enviadosPorWhatsApp.length, 0, "no manda WhatsApp");
});

console.log(`\n${pruebas} pruebas OK`);
