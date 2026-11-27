// Toda Tarea nueva cae sola en Features (27-nov-2026): el Coordinador solo toma lo que cuelga de Features (T-736).
// Una Tarea nueva sin padre del tablero de Features queda dentro de Features; si trae un padre fuera de Features, se crea
// igual con aviso_features. Prueba la parte pura (reglas-features.ts) y, por texto, que crearTarjeta, crear_tarjeta y
// las instrucciones del servidor MCP la usan. Parte 2: SQL_TAREAS_FUERA_DE_FEATURES contra una base de pruebas (PGlite, con
// todas las migraciones), moverTareasAFeatures con un prisma FALSO sobre esa base, y por texto el reloj y que_es_esta_aplicacion.
// Sin red.
// Correr: npm run test:tareas-a-features
import assert from "node:assert/strict";
import fs, { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { abrirBaseDePruebas } from "./lib/base-de-pruebas.mjs";
import { cargar } from "./supervisor-cargar.mjs";

const f = cargar("src/features/tableros-inteligentes/services/reglas-features.ts");

let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const TABLERO = f.TABLERO_DE_FEATURES_ID;
const FEATURES = f.TARJETA_AREA_FEATURES_ID;
const leer = (ruta) => readFileSync(new URL(`../${ruta}`, import.meta.url), "utf8");

await prueba("los textos de la regla y del aviso son los de la tarjeta", () => {
  assert.equal(
    f.REGLA_TAREAS_EN_FEATURES,
    "Si es un desarrollo nuevo o una corrección en Gestión o en el CRM, créala como Tarea dentro de Features (T-736), con repo gestion o aizencrm. Las Ideas son solo notas y no van a Features.",
  );
  assert.equal(f.AVISO_TAREA_FUERA_DE_FEATURES, "Esta Tarea no la va a tomar el Coordinador; muévela a Features (T-736).");
  assert.equal(f.NOTA_PUESTA_EN_FEATURES, "puesta dentro de Features sola");
});

await prueba("padreParaTareaNueva: una Tarea sin padre del tablero de Features va a Features", () => {
  assert.equal(f.padreParaTareaNueva({ tableroId: TABLERO, tipo: { nombre: "Tarea" }, padreId: null }), FEATURES);
  assert.equal(f.padreParaTareaNueva({ tableroId: TABLERO, tipo: { nombre: "Tarea" }, padreId: undefined }), FEATURES);
  assert.equal(f.padreParaTareaNueva({ tableroId: TABLERO, tipo: "tarea", padreId: null }), FEATURES, "por nombre, sin mayúsculas");
  assert.equal(f.padreParaTareaNueva({ tableroId: TABLERO, tipo: { nombre: " TAREA " }, padreId: "" }), FEATURES, "padre vacío = sin padre");
});

await prueba("padreParaTareaNueva: otro tablero, Idea, Área o una Tarea con padre no se tocan", () => {
  assert.equal(f.padreParaTareaNueva({ tableroId: "otroTablero", tipo: { nombre: "Tarea" }, padreId: null }), null, "otro tablero");
  assert.equal(f.padreParaTareaNueva({ tableroId: TABLERO, tipo: { nombre: "Idea" }, padreId: null }), null, "Idea");
  assert.equal(f.padreParaTareaNueva({ tableroId: TABLERO, tipo: { nombre: "Área" }, padreId: null }), null, "Área");
  assert.equal(f.padreParaTareaNueva({ tableroId: TABLERO, tipo: { nombre: "Tarea" }, padreId: "otraArea" }), "otraArea", "Tarea con padre");
  assert.equal(f.padreParaTareaNueva({ tableroId: TABLERO, tipo: { nombre: "Idea" }, padreId: "otraArea" }), "otraArea", "Idea con padre");
  assert.equal(f.padreParaTareaNueva({ tableroId: TABLERO, tipo: null, padreId: null }), null, "sin tipo");
});

await prueba("esTipoTarea y padreEstaEnFeatures", () => {
  assert.equal(f.esTipoTarea({ nombre: "Tarea" }), true);
  assert.equal(f.esTipoTarea({ nombre: "Idea" }), false);
  assert.equal(f.esTipoTarea({ nombre: "Área" }), false);
  assert.equal(f.esTipoTarea(undefined), false);
  assert.equal(f.padreEstaEnFeatures(FEATURES, []), true, "el padre es Features");
  assert.equal(f.padreEstaEnFeatures("idea1", ["sub", FEATURES, "raiz"]), true, "Features más arriba");
  assert.equal(f.padreEstaEnFeatures("otra", ["raiz"]), false, "fuera de Features");
  assert.equal(f.padreEstaEnFeatures("suelta", []), false, "padre suelto");
});

await prueba("la regla está en la descripción de crear_tarjeta y aviso_features sale en su respuesta", () => {
  const mcp = leer("src/lib/mcp/tableros-inteligentes.ts");
  assert.match(mcp, /import \{ REGLA_TAREAS_EN_FEATURES \} from "@\/features\/tableros-inteligentes\/services\/reglas-features";/);
  const definicion = mcp.slice(mcp.indexOf('name: "crear_tarjeta"'), mcp.indexOf("inputSchema", mcp.indexOf('name: "crear_tarjeta"')));
  assert.ok(definicion.includes("REGLA_TAREAS_EN_FEATURES +"), "la descripción de crear_tarjeta usa la regla");
  assert.ok(definicion.includes(f.REGLA_TAREAS_EN_FEATURES), "el texto de la regla queda a la vista en crear_tarjeta (igual a la constante)");
  const respuesta = mcp.slice(mcp.indexOf('case "crear_tarjeta": {'), mcp.indexOf('case "editar_tarjeta": {'));
  assert.ok(respuesta.includes("...(resultado.avisoFeatures ? { aviso_features: resultado.avisoFeatures } : {}),"), "aviso_features solo cuando viene");
});

await prueba("la regla está en las instrucciones del servidor MCP, en la parte del TABLERO IA", () => {
  const ruta = leer("src/app/api/mcp/route.ts");
  assert.match(ruta, /import \{ REGLA_TAREAS_EN_FEATURES \} from "@\/features\/tableros-inteligentes\/services\/reglas-features";/);
  const tablero = ruta.indexOf("TABLERO IA");
  assert.ok(tablero > 0);
  const parte = ruta.slice(tablero, ruta.indexOf("TRABAJADOR (fase 2)", tablero));
  assert.ok(parte.includes("${REGLA_TAREAS_EN_FEATURES}"), "las instrucciones usan la regla");
  assert.ok(parte.includes(f.REGLA_TAREAS_EN_FEATURES), "el texto de la regla queda a la vista (igual a la constante)");
});

await prueba("crearTarjeta usa padreParaTareaNueva, revisarMadre sin fallar, SQL_ANCESTROS, la nota y aviso_features", () => {
  const servicio = leer("src/features/tableros-inteligentes/services/tableros.ts");
  const inicio = servicio.indexOf("export async function crearTarjeta(");
  const crear = servicio.slice(inicio, servicio.indexOf("\n}\n", inicio));
  assert.ok(crear.includes("padreParaTareaNueva({ tableroId: tablero.id, tipo, padreId: padrePedido })"));
  assert.match(crear, /try \{\s*await revisarMadre\(\{[^}]*\}, padreId, tipos\);\s*puestaEnFeatures = true;\s*\} catch \{\s*padreId = null;\s*avisoFeatures = AVISO_TAREA_FUERA_DE_FEATURES;/);
  assert.ok(crear.includes("...(puestaEnFeatures ? { nota: NOTA_PUESTA_EN_FEATURES } : {}),"), "la nota en el historial de la creación");
  assert.ok(crear.includes("!(await padreCuelgaDeFeatures(padreId))"), "Tarea con padre: mira la cadena de madres");
  assert.ok(crear.includes("aprobacionAutomatica: aprobacion.resultado, avisoFeatures }"), "devuelve avisoFeatures");
  const sube = servicio.slice(servicio.indexOf("async function padreCuelgaDeFeatures("));
  assert.ok(sube.slice(0, 600).includes("$queryRawUnsafe<{ id: string; ancestros: string[] }[]>(SQL_ANCESTROS, [padreId])"));
});

/* ------------------------------------------------ parte 2: las aprobadas que quedaron fuera, en PGlite */

const sqlFeatures = cargar("src/features/tableros-inteligentes/services/sql-features.ts");
const CARPETA = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "prisma", "migrations");
const db = await abrirBaseDePruebas();
for (const nombre of fs.readdirSync(CARPETA, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort()) {
  try {
    await db.exec(fs.readFileSync(path.join(CARPETA, nombre, "migration.sql"), "utf8"));
  } catch (fallo) {
    throw new Error(`La migración ${nombre} falló en PGlite: ${fallo.message}`);
  }
}

const SUB = "area-seo-000000000000001";
const OTRA = "area-ventas-0000000000001";
const fila = (id, tablero, estado, tipo, repo, padre, creado = "2026-11-10 08:00:00") =>
  `('${id}', '${tablero}', '${id}', '${estado}', 'u-dueno', '${creado}', '${creado}', '${tipo}', ${repo === null ? "NULL" : `'${repo}'`}, ${padre === null ? "NULL" : `'${padre}'`})`;

await db.exec(`
  INSERT INTO "User" ("id", "email", "password", "updatedAt") VALUES ('u-dueno', 'dueno@x.co', 'x', now());
  INSERT INTO "Workspace" ("id", "name", "slug", "updatedAt", "ownerId") VALUES
    ('ws1', 'Magilus', 'magilus', now(), 'u-dueno'),
    ('ws2', 'Otro negocio', 'otro', now(), 'u-dueno');
  INSERT INTO "TableroInteligente" ("id", "workspaceId", "nombre") VALUES
    ('${TABLERO}', 'ws1', 'Empresa Magilus'),
    ('tab-otro', 'ws1', 'Otro tablero'),
    ('tab-ws2', 'ws2', 'Tablero de otro negocio');
  INSERT INTO "TipoTarjeta" ("id", "tableroId", "nombre", "requiereAprobacion", "usaEstados", "orden") VALUES
    ('area', '${TABLERO}', 'Área', false, false, 0),
    ('idea', '${TABLERO}', 'Idea', false, true, 1),
    ('tarea', '${TABLERO}', 'Tarea', true, true, 2),
    ('tarea-otro', 'tab-otro', 'Tarea', true, true, 0),
    ('tarea-ws2', 'tab-ws2', 'Tarea', true, true, 0);
  INSERT INTO "TarjetaTablero" ("id", "tableroId", "titulo", "estado", "creadoPor", "creadoEn", "actualizadoEn", "tipoId", "repo", "padreId") VALUES
    ${[
      fila(FEATURES, TABLERO, "IDEA", "area", null, null, "2026-10-01 08:00:00"),
      fila(SUB, TABLERO, "IDEA", "area", null, FEATURES, "2026-10-01 08:00:00"),
      fila(OTRA, TABLERO, "IDEA", "area", null, null, "2026-10-01 08:00:00"),
      // Salen: Tareas aprobadas con repo, fuera de Features.
      fila("fuera-aprobada", TABLERO, "APROBADO", "tarea", "aizencrm", OTRA, "2026-11-01 08:00:00"),
      fila("fuera-plan", TABLERO, "PLAN_APROBADO", "tarea", "gestion", null, "2026-11-02 08:00:00"),
      fila("fuera-cambiada", TABLERO, "APROBADO", "tarea", "aizencrm", null, "2026-11-03 08:00:00"),
      // No salen.
      fila("dentro-features", TABLERO, "APROBADO", "tarea", "aizencrm", FEATURES),
      fila("dentro-subarea", TABLERO, "PLAN_APROBADO", "tarea", "aizencrm", SUB),
      fila("idea-aprobada", TABLERO, "APROBADO", "idea", "aizencrm", null),
      fila("area-aprobada", TABLERO, "APROBADO", "area", "aizencrm", null),
      fila("borrada", TABLERO, "APROBADO", "tarea", "aizencrm", null),
      fila("archivada", TABLERO, "APROBADO", "tarea", "aizencrm", null),
      fila("en-curso", TABLERO, "EN_CURSO", "tarea", "aizencrm", null),
      fila("por-aprobar", TABLERO, "POR_APROBAR", "tarea", "aizencrm", null),
      fila("planeando", TABLERO, "PLANEANDO", "tarea", "aizencrm", null),
      fila("subiendo", TABLERO, "SUBIENDO", "tarea", "aizencrm", null),
      fila("sin-repo", TABLERO, "APROBADO", "tarea", null, null),
      fila("repo-vacio", TABLERO, "APROBADO", "tarea", "", null),
      fila("otro-tablero", "tab-otro", "APROBADO", "tarea-otro", "aizencrm", null),
      fila("otro-negocio", "tab-ws2", "APROBADO", "tarea-ws2", "aizencrm", null),
    ].join(",\n    ")};
  UPDATE "TarjetaTablero" SET "borradoEn" = '2026-11-20 08:00:00' WHERE "id" = 'borrada';
  UPDATE "TarjetaTablero" SET "archivadaEn" = '2026-11-20 08:00:00' WHERE "id" = 'archivada';
`);

const fueraDeFeatures = async (features = FEATURES, tablero = TABLERO, negocio = "ws1") =>
  (await db.query(sqlFeatures.SQL_TAREAS_FUERA_DE_FEATURES, [features, tablero, negocio])).rows.map((r) => r.id);

await prueba("SQL_TAREAS_FUERA_DE_FEATURES: solo las Tareas APROBADO y PLAN_APROBADO con repo que están fuera, la más vieja primero", async () => {
  assert.deepEqual(await fueraDeFeatures(), ["fuera-aprobada", "fuera-plan", "fuera-cambiada"]);
  assert.ok(sqlFeatures.SQL_TAREAS_FUERA_DE_FEATURES.includes('WHERE s."nivel" < 50'), "el recorrido llega hasta 50 niveles");
});

await prueba("SQL_TAREAS_FUERA_DE_FEATURES: el tablero y el negocio filtran; otro negocio o Features que no existe no devuelven nada", async () => {
  assert.deepEqual(await fueraDeFeatures(FEATURES, TABLERO, "ws2"), [], "otro negocio");
  assert.deepEqual(await fueraDeFeatures(FEATURES, "tab-otro", "ws1"), ["otro-tablero"], "el tablero manda: con otro tablero solo salen las suyas");
  assert.deepEqual(await fueraDeFeatures("no-existe-000000000000001"), [], "Features no existe");
});

/* moverTareasAFeatures con un prisma FALSO: las consultas y el update condicional van a la base de pruebas. */
const ajustes = new Map();
const historial = [];
const condiciones = [];
let alLeer = null;
const tx = {
  tarjetaTablero: {
    async updateMany({ where, data }) {
      condiciones.push(Object.keys(where).sort().join(","));
      const r = await db.query(
        `UPDATE "TarjetaTablero" SET "padreId" = $1, "actualizadoEn" = now()
         WHERE "id" = $2 AND "padreId" IS NOT DISTINCT FROM $3 AND "estado"::text = $4 AND "actualizadoEn" = $5
           AND "borradoEn" IS NULL AND "archivadaEn" IS NULL`,
        [data.padreId, where.id, where.padreId, where.estado, where.actualizadoEn],
      );
      return { count: r.affectedRows ?? 0 };
    },
  },
  historialTarjeta: { async create({ data }) { historial.push(data); } },
  tableroInteligente: { async updateMany() { return { count: 1 }; } },
};
const prismaFalso = {
  ...tx,
  tableroInteligente: {
    ...tx.tableroInteligente,
    async findUnique({ where }) {
      const r = await db.query(`SELECT "workspaceId" FROM "TableroInteligente" WHERE "id" = $1`, [where.id]);
      return r.rows[0] ?? null;
    },
  },
  appSetting: {
    async findUnique({ where }) { return ajustes.has(where.key) ? { value: ajustes.get(where.key) } : null; },
    async upsert({ where, update }) { ajustes.set(where.key, update.value); },
  },
  async $queryRawUnsafe(texto, ...valores) {
    const filas = (await db.query(texto, valores)).rows;
    if (alLeer) await alLeer();
    return filas;
  },
  async $transaction(fn) { return fn(tx); },
};
const mover = cargar("src/features/tableros-inteligentes/services/tareas-a-features.ts", { "@/lib/prisma": { prisma: prismaFalso } });

await prueba("moverTareasAFeatures: apagada con tablero:tareas-a-features:<negocio>=false no mueve nada", async () => {
  ajustes.set("tablero:tareas-a-features:ws1", "false");
  assert.deepEqual(await mover.moverTareasAFeatures(new Date("2026-11-27T15:00:00Z")), { movidas: 0 });
  assert.equal((await fueraDeFeatures()).length, 3);
  ajustes.delete("tablero:tareas-a-features:ws1");
});

await prueba("moverTareasAFeatures: mueve las de fuera a Features sin cambiar estado y no pisa la que alguien cambió mientras tanto", async () => {
  // Alguien edita 'fuera-cambiada' justo después de que la vuelta la leyó.
  alLeer = async () => {
    await db.exec(`UPDATE "TarjetaTablero" SET "actualizadoEn" = '2026-11-27 14:59:00' WHERE "id" = 'fuera-cambiada'`);
    alLeer = null;
  };
  assert.deepEqual(await mover.moverTareasAFeatures(new Date("2026-11-27T15:00:00Z")), { movidas: 2 });
  for (const c of condiciones) assert.equal(c, "actualizadoEn,archivadaEn,borradoEn,estado,id,padreId", "el update es condicional");
  const r = await db.query(`SELECT "id", "padreId", "estado"::text AS "estado" FROM "TarjetaTablero" WHERE "id" IN ('fuera-aprobada', 'fuera-plan', 'fuera-cambiada') ORDER BY "id"`);
  assert.deepEqual(r.rows, [
    { id: "fuera-aprobada", padreId: FEATURES, estado: "APROBADO" },
    { id: "fuera-cambiada", padreId: null, estado: "APROBADO" },
    { id: "fuera-plan", padreId: FEATURES, estado: "PLAN_APROBADO" },
  ]);
  assert.equal(historial.length, 2);
  assert.deepEqual(historial[0], {
    tarjetaId: "fuera-aprobada",
    quien: "sistema:tareas-a-features",
    origen: "TRABAJADOR",
    accion: "mover",
    antes: { estado: "APROBADO", padreId: OTRA },
    despues: { estado: "APROBADO", padreId: FEATURES, nota: mover.NOTA_TAREA_MOVIDA_A_FEATURES },
  });
  assert.equal(ajustes.get("tablero:tareas-a-features:ultimo-dia:ws1"), "2026-11-27", "la fecha de Bogotá de la vuelta");
  assert.equal(ajustes.get("tablero:tareas-a-features:movidas:ws1"), "2");
});

await prueba("moverTareasAFeatures: una vez al día; al día siguiente mueve la que quedó y después la consulta no devuelve nada", async () => {
  assert.deepEqual(await mover.moverTareasAFeatures(new Date("2026-11-28T04:59:00Z")), { movidas: 0 }, "todavía 27-nov en Bogotá");
  assert.deepEqual(await mover.moverTareasAFeatures(new Date("2026-11-28T15:00:00Z")), { movidas: 1 });
  assert.deepEqual(await fueraDeFeatures(), []);
  assert.match(await mover.estadoDeTareasAFeatures(), /^prendida: .*última vuelta: 2026-11-28, movió 1$/);
});

await prueba("SQL_TAREAS_FUERA_DE_FEATURES: con Features borrada no devuelve nada", async () => {
  await db.exec(`UPDATE "TarjetaTablero" SET "padreId" = NULL WHERE "id" = 'fuera-plan'`);
  assert.deepEqual(await fueraDeFeatures(), ["fuera-plan"]);
  await db.exec(`UPDATE "TarjetaTablero" SET "borradoEn" = '2026-11-28 09:00:00' WHERE "id" = '${FEATURES}'`);
  assert.deepEqual(await fueraDeFeatures(), []);
});
await db.close();

await prueba("el reloj llama a moverTareasAFeatures con candado, junto al archivado diario", () => {
  const ruta = leer("src/app/api/cron/follows/route.ts");
  assert.match(ruta, /import \{ moverTareasAFeatures \} from "@\/features\/tableros-inteligentes\/services\/tareas-a-features";/);
  const archivar = ruta.indexOf('conCandado("tablero-archivar-terminadas", archivarLasTerminadas)');
  const mueve = ruta.indexOf('await conCandado("tablero-tareas-a-features", () => moverTareasAFeatures());');
  assert.ok(archivar > 0 && mueve > archivar && mueve - archivar < 600, "va justo después del archivado diario");
});

await prueba("que_es_esta_aplicacion tiene la regla, regla_del_tablero_ia y tareas_a_features_tablero", () => {
  const app = leer("src/lib/mcp/que-es-esta-aplicacion.ts");
  assert.match(app, /import \{ REGLA_TAREAS_EN_FEATURES \} from "@\/features\/tableros-inteligentes\/services\/reglas-features";/);
  const descripcion = app.slice(app.indexOf('name: "que_es_esta_aplicacion"'), app.indexOf("inputSchema", app.indexOf('name: "que_es_esta_aplicacion"')));
  assert.ok(descripcion.includes("REGLA_TAREAS_EN_FEATURES,"), "la descripción de la herramienta lleva la regla");
  assert.ok(app.includes("regla_del_tablero_ia: REGLA_TAREAS_EN_FEATURES,"), "la respuesta trae regla_del_tablero_ia");
  assert.ok(app.includes('tareas_a_features_tablero: await seguro("tareas_a_features_tablero", estadoDeTareasAFeatures),'), "la automatización, con no_se_pudo_leer si falla");
});

console.log(`\n${pruebas} pruebas: todas bien`);
