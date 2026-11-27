// Toda Tarea nueva cae sola en Features (27-nov-2026): el Coordinador solo toma lo que cuelga de Features (T-736).
// Una Tarea nueva sin padre del tablero de Features queda dentro de Features; si trae un padre fuera de Features, se crea
// igual con aviso_features. Prueba la parte pura (reglas-features.ts) y, por texto, que crearTarjeta, crear_tarjeta y
// las instrucciones del servidor MCP la usan. Sin base ni red.
// Parte 2: SQL_TAREAS_FUERA_DE_FEATURES en una base de pruebas (PGlite, con todas las migraciones), moverTareasAFeatures con
// un prisma falso sobre esa misma base, y por texto el reloj y que_es_esta_aplicacion.
// Correr: npm run test:tareas-a-features
import assert from "node:assert/strict";
import fs, { readFileSync } from "node:fs";
import path from "node:path";
import { abrirBaseDePruebas } from "./lib/base-de-pruebas.mjs";
import { cargar, RAIZ } from "./supervisor-cargar.mjs";

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


/* ─────────────────────────── parte 2: la revisión diaria que pasa a Features las Tareas aprobadas que quedaron fuera ── */

const sqlFeatures = cargar("src/features/tableros-inteligentes/services/sql-features.ts");
const SQL = sqlFeatures.SQL_TAREAS_FUERA_DE_FEATURES;

const db = await abrirBaseDePruebas();
const MIGRACIONES = path.join(RAIZ, "prisma", "migrations");
for (const nombre of fs.readdirSync(MIGRACIONES, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort()) {
  try {
    await db.exec(fs.readFileSync(path.join(MIGRACIONES, nombre, "migration.sql"), "utf8"));
  } catch (fallo) {
    throw new Error(`La migración ${nombre} falló en la base de pruebas: ${fallo.message}`);
  }
}

const SUB = "area-seo-000000000000001";
const SUBSUB = "area-seo-ideas-0000000001";
const SUB_BORRADA = "area-vieja-borrada-000001";
const OTRA = "area-ventas-0000000000001";
const fila = (id, tablero, tipo, estado, repo, padre, creado) =>
  `('${id}', '${tablero}', '${id}', '${estado}', 'u-dueno', '${creado}', '${creado}', '${tipo}', ${repo === null ? "NULL" : `'${repo}'`}, 'El plan de ${id}', ${padre === null ? "NULL" : `'${padre}'`}, 0)`;

await db.exec(`
  INSERT INTO "User" ("id", "email", "password", "updatedAt") VALUES ('u-dueno', 'dueno@x.co', 'x', now());
  INSERT INTO "Workspace" ("id", "name", "slug", "updatedAt", "ownerId") VALUES
    ('ws1', 'Magilus', 'magilus', now(), 'u-dueno'),
    ('ws2', 'Otro negocio', 'otro', now(), 'u-dueno');
  INSERT INTO "TableroInteligente" ("id", "workspaceId", "nombre") VALUES
    ('${TABLERO}', 'ws1', 'Empresa Magilus'),
    ('tab-otro-0000000000000001', 'ws1', 'Otro tablero'),
    ('tab-ws2-00000000000000001', 'ws2', 'Tablero de otro negocio');
  INSERT INTO "TipoTarjeta" ("id", "tableroId", "nombre", "requiereAprobacion", "usaEstados", "orden") VALUES
    ('area', '${TABLERO}', 'Área', false, false, 0),
    ('idea', '${TABLERO}', 'Idea', false, true, 1),
    ('tarea', '${TABLERO}', 'Tarea', true, true, 2),
    ('tarea-otro', 'tab-otro-0000000000000001', 'Tarea', true, true, 2),
    ('tarea-ws2', 'tab-ws2-00000000000000001', ' TAREA ', true, true, 2);
  INSERT INTO "TarjetaTablero" ("id", "tableroId", "titulo", "estado", "creadoPor", "creadoEn", "actualizadoEn", "tipoId", "repo", "plan", "padreId", "intentos") VALUES
    ${[
      fila(FEATURES, TABLERO, "area", "IDEA", null, null, "2026-10-01 08:00:00"),
      fila(SUB, TABLERO, "area", "IDEA", null, FEATURES, "2026-10-01 08:00:00"),
      fila(SUBSUB, TABLERO, "area", "IDEA", null, SUB, "2026-10-01 08:00:00"),
      fila(SUB_BORRADA, TABLERO, "area", "IDEA", null, FEATURES, "2026-10-01 08:00:00"),
      fila(OTRA, TABLERO, "area", "IDEA", null, null, "2026-10-01 08:00:00"),
      // Las que tienen que salir (fuera de Features, Tarea, APROBADO o PLAN_APROBADO, con repo):
      fila("fuera-suelta", TABLERO, "tarea", "APROBADO", "aizencrm", null, "2026-11-01 08:00:00"),
      fila("fuera-otra-area", TABLERO, "tarea", "PLAN_APROBADO", "gestion", OTRA, "2026-11-02 08:00:00"),
      fila("fuera-bajo-borrada", TABLERO, "tarea", "APROBADO", "aizencrm", SUB_BORRADA, "2026-11-03 08:00:00"),
      // Las que no:
      fila("dentro", TABLERO, "tarea", "APROBADO", "aizencrm", FEATURES, "2026-10-02 08:00:00"),
      fila("dentro-sub", TABLERO, "tarea", "PLAN_APROBADO", "aizencrm", SUBSUB, "2026-10-02 08:00:00"),
      fila("idea-aprobada", TABLERO, "idea", "APROBADO", "aizencrm", null, "2026-10-02 08:00:00"),
      fila("area-aprobada", TABLERO, "area", "APROBADO", "aizencrm", null, "2026-10-02 08:00:00"),
      fila("borrada", TABLERO, "tarea", "APROBADO", "aizencrm", null, "2026-10-02 08:00:00"),
      fila("archivada", TABLERO, "tarea", "PLAN_APROBADO", "aizencrm", null, "2026-10-02 08:00:00"),
      fila("en-curso", TABLERO, "tarea", "EN_CURSO", "aizencrm", null, "2026-10-02 08:00:00"),
      fila("por-aprobar", TABLERO, "tarea", "POR_APROBAR", "aizencrm", null, "2026-10-02 08:00:00"),
      fila("planeando", TABLERO, "tarea", "PLANEANDO", "aizencrm", null, "2026-10-02 08:00:00"),
      fila("subiendo", TABLERO, "tarea", "SUBIENDO", "aizencrm", null, "2026-10-02 08:00:00"),
      fila("sin-repo", TABLERO, "tarea", "APROBADO", null, null, "2026-10-02 08:00:00"),
      fila("repo-vacio", TABLERO, "tarea", "APROBADO", "  ", null, "2026-10-02 08:00:00"),
      fila("otro-tablero", "tab-otro-0000000000000001", "tarea-otro", "APROBADO", "aizencrm", null, "2026-10-02 08:00:00"),
      fila("otro-negocio", "tab-ws2-00000000000000001", "tarea-ws2", "APROBADO", "aizencrm", null, "2026-10-02 08:00:00"),
    ].join(",\n    ")};
  UPDATE "TarjetaTablero" SET "borradoEn" = '2026-11-05 08:00:00' WHERE "id" IN ('borrada', '${SUB_BORRADA}');
  UPDATE "TarjetaTablero" SET "archivadaEn" = '2026-11-05 08:00:00' WHERE "id" = 'archivada';
`);

const fueraDe = async (features = FEATURES, tablero = TABLERO, negocio = "ws1") =>
  (await db.query(SQL, [features, tablero, negocio])).rows.map((f) => f.id);
const tarjetaEnBase = async (id) => (await db.query(`SELECT * FROM "TarjetaTablero" WHERE "id" = $1`, [id])).rows[0];

await prueba("SQL_TAREAS_FUERA_DE_FEATURES: solo las Tareas APROBADO/PLAN_APROBADO con repo que están fuera de Features", async () => {
  // Una que cuelga de una sub-área borrada ya no está en Features (el recorrido no pasa por borradas, como el Coordinador).
  assert.deepEqual(await fueraDe(), ["fuera-suelta", "fuera-otra-area", "fuera-bajo-borrada"]);
  const [primera] = (await db.query(SQL, [FEATURES, TABLERO, "ws1"])).rows;
  assert.deepEqual(Object.keys(primera).sort(), ["actualizadoEn", "estado", "id", "padreId"]);
  assert.equal(primera.estado, "APROBADO");
  assert.ok(primera.actualizadoEn instanceof Date);
});

await prueba("SQL_TAREAS_FUERA_DE_FEATURES: otro negocio, otro tablero o un Features que no existe no devuelven nada", async () => {
  assert.deepEqual(await fueraDe(FEATURES, TABLERO, "ws2"), [], "Features no es de ese negocio");
  assert.deepEqual(await fueraDe(FEATURES, "tab-otro-0000000000000001", "ws1"), [], "Features no está en ese tablero");
  assert.deepEqual(await fueraDe("no-existe-000000000000001", TABLERO, "ws1"), [], "Features no existe");
});

// moverTareasAFeatures con un prisma falso que escribe en la misma base de pruebas.
const ajustes = new Map();
const historial = [];
const tablerosTocados = [];
let antesDeMover = null;
const tx = {
  tarjetaTablero: {
    async updateMany({ where, data }) {
      assert.deepEqual(Object.keys(where).sort(), ["actualizadoEn", "archivadaEn", "borradoEn", "estado", "id", "padreId"], "update condicional");
      assert.deepEqual(data, { padreId: FEATURES }, "solo cambia padreId: estado, plan y orden quedan igual");
      assert.equal(where.borradoEn, null);
      assert.equal(where.archivadaEn, null);
      const res = await db.query(
        `UPDATE "TarjetaTablero" SET "padreId" = $1, "actualizadoEn" = now()
         WHERE "id" = $2 AND "padreId" IS NOT DISTINCT FROM $3 AND "estado"::text = $4 AND "actualizadoEn" = $5
           AND "borradoEn" IS NULL AND "archivadaEn" IS NULL`,
        [data.padreId, where.id, where.padreId, where.estado, where.actualizadoEn],
      );
      return { count: res.affectedRows ?? 0 };
    },
  },
  historialTarjeta: {
    async create({ data }) {
      historial.push(data);
      return { id: `h${historial.length}` };
    },
  },
};
const prismaFalso = {
  tableroInteligente: {
    async findUnique({ where }) {
      const [t] = (await db.query(`SELECT "workspaceId" FROM "TableroInteligente" WHERE "id" = $1`, [where.id])).rows;
      return t ?? null;
    },
    async updateMany({ where }) {
      tablerosTocados.push(where.id);
      return { count: 1 };
    },
  },
  appSetting: {
    async findUnique({ where }) {
      return ajustes.has(where.key) ? { value: ajustes.get(where.key) } : null;
    },
    async upsert({ where, update }) {
      ajustes.set(where.key, update.value);
      return { key: where.key, value: update.value };
    },
  },
  async $queryRawUnsafe(texto, ...valores) {
    assert.equal(texto, SQL, "usa SQL_TAREAS_FUERA_DE_FEATURES");
    assert.deepEqual(valores, [FEATURES, TABLERO, "ws1"], "$1 = Features, $2 = tablero, $3 = negocio");
    return (await db.query(texto, valores)).rows;
  },
  async $transaction(fn) {
    if (antesDeMover) await antesDeMover();
    return fn(tx);
  },
};
const mover = cargar("src/features/tableros-inteligentes/services/tareas-a-features.ts", { "@/lib/prisma": { prisma: prismaFalso } });
const DIA_1 = new Date("2026-11-28T15:00:00Z");
const DIA_1_NOCHE = new Date("2026-11-29T04:30:00Z"); // 11:30 p. m. del 28 en Bogotá: mismo día
const DIA_2 = new Date("2026-11-29T15:00:00Z");

await prueba("moverTareasAFeatures: mueve cada una por separado y no pisa a la que alguien cambió mientras tanto", async () => {
  const otraAntes = await tarjetaEnBase("fuera-otra-area");
  let primera = true;
  // Alguien edita fuera-otra-area justo después de la lectura: su actualizadoEn ya no es el leído.
  antesDeMover = async () => {
    if (!primera) return;
    primera = false;
    await db.query(`UPDATE "TarjetaTablero" SET "actualizadoEn" = '2026-11-28 14:59:00' WHERE "id" = 'fuera-otra-area'`);
  };
  assert.deepEqual(await mover.moverTareasAFeatures(DIA_1), { movidas: 2 });
  antesDeMover = null;
  const suelta = await tarjetaEnBase("fuera-suelta");
  assert.equal(suelta.padreId, FEATURES);
  assert.equal(suelta.estado, "APROBADO", "el estado queda igual");
  assert.equal(suelta.plan, "El plan de fuera-suelta", "el plan queda igual");
  assert.equal((await tarjetaEnBase("fuera-bajo-borrada")).padreId, FEATURES);
  const otra = await tarjetaEnBase("fuera-otra-area");
  assert.equal(otra.padreId, OTRA, "la que cambió mientras tanto no se movió");
  assert.equal(otra.estado, otraAntes.estado);
  assert.deepEqual(historial[0], {
    tarjetaId: "fuera-suelta",
    quien: "sistema:tareas-a-features",
    origen: "TRABAJADOR",
    accion: "mover",
    antes: { estado: "APROBADO", padreId: null },
    despues: { estado: "APROBADO", padreId: FEATURES, nota: mover.NOTA_TAREA_MOVIDA_A_FEATURES },
  });
  assert.equal(historial[1].tarjetaId, "fuera-bajo-borrada");
  assert.deepEqual(historial[1].antes, { estado: "APROBADO", padreId: SUB_BORRADA });
  assert.equal(historial.length, 2);
  assert.deepEqual(tablerosTocados, [TABLERO], "el tablero se refresca una vez");
  assert.equal(ajustes.get("tablero:tareas-a-features:ultimo-dia:ws1"), "2026-11-28");
  assert.equal(ajustes.get("tablero:tareas-a-features:movidas:ws1"), "2");
});

await prueba("moverTareasAFeatures: una vez al día por fecha de Bogotá; al día siguiente toma la que quedó", async () => {
  assert.deepEqual(await mover.moverTareasAFeatures(DIA_1_NOCHE), { movidas: 0 }, "mismo día en Bogotá: no vuelve a correr");
  assert.equal(historial.length, 2);
  assert.deepEqual(await mover.moverTareasAFeatures(DIA_2), { movidas: 1 });
  assert.equal((await tarjetaEnBase("fuera-otra-area")).padreId, FEATURES);
  assert.equal((await tarjetaEnBase("fuera-otra-area")).estado, "PLAN_APROBADO", "el estado queda igual");
  assert.equal(ajustes.get("tablero:tareas-a-features:ultimo-dia:ws1"), "2026-11-29");
  assert.equal(ajustes.get("tablero:tareas-a-features:movidas:ws1"), "1");
});

await prueba("después de moverlas, la consulta no devuelve nada; nada de lo que no tocaba se movió", async () => {
  assert.deepEqual(await fueraDe(), []);
  for (const id of ["idea-aprobada", "area-aprobada", "borrada", "archivada", "en-curso", "por-aprobar", "planeando", "subiendo", "sin-repo", "repo-vacio", "otro-tablero", "otro-negocio"]) {
    assert.equal((await tarjetaEnBase(id)).padreId, null, `${id} sigue donde estaba`);
  }
  assert.equal((await tarjetaEnBase("dentro-sub")).padreId, SUBSUB, "la de la sub-área sigue en su sub-área");
});

await prueba("moverTareasAFeatures: con tablero:tareas-a-features:<negocio> = false no mueve nada", async () => {
  await db.exec(`INSERT INTO "TarjetaTablero" ("id", "tableroId", "titulo", "estado", "creadoPor", "tipoId", "repo", "actualizadoEn") VALUES ('nueva-suelta', '${TABLERO}', 'Nueva', 'APROBADO', 'u-dueno', 'tarea', 'aizencrm', now())`);
  ajustes.set("tablero:tareas-a-features:ws1", "false");
  assert.deepEqual(await mover.moverTareasAFeatures(new Date("2026-11-30T15:00:00Z")), { movidas: 0 });
  assert.equal((await tarjetaEnBase("nueva-suelta")).padreId, null);
  assert.equal(ajustes.get("tablero:tareas-a-features:ultimo-dia:ws1"), "2026-11-29", "apagada no pone la marca del día");
  assert.match(await mover.estadoDeTareasAFeatures("ws1"), /^apagada \(tablero:tareas-a-features:<negocio> = false\); última vuelta: 2026-11-29 \(movió 1\)$/);
  ajustes.delete("tablero:tareas-a-features:ws1");
  assert.match(await mover.estadoDeTareasAFeatures("ws1"), /^prendida: .*última vuelta: 2026-11-29 \(movió 1\)$/);
  assert.match(await mover.estadoDeTareasAFeatures("ws2"), /última vuelta: todavía ninguna$/);
  assert.equal(mover.tareasAFeaturesPrendida(null), true, "sin fila está prendida");
  assert.equal(mover.tareasAFeaturesPrendida(" FALSE "), false);
  assert.equal(mover.tareasAFeaturesPrendida("true"), true);
});

await prueba("con Features borrada la consulta no devuelve nada (y no se mueve nada)", async () => {
  assert.deepEqual(await fueraDe(), ["nueva-suelta"]);
  await db.query(`UPDATE "TarjetaTablero" SET "borradoEn" = now() WHERE "id" = $1`, [FEATURES]);
  assert.deepEqual(await fueraDe(), []);
  assert.deepEqual(await mover.moverTareasAFeatures(new Date("2026-12-01T15:00:00Z")), { movidas: 0 });
  assert.equal((await tarjetaEnBase("nueva-suelta")).padreId, null);
});

await db.close();

await prueba("el reloj llama a moverTareasAFeatures con candado, al lado del archivado diario", () => {
  const reloj = leer("src/app/api/cron/follows/route.ts");
  assert.match(reloj, /import \{ moverTareasAFeatures \} from "@\/features\/tableros-inteligentes\/services\/tareas-a-features";/);
  const archivar = reloj.indexOf('conCandado("tablero-archivar-terminadas", archivarLasTerminadas)');
  const tareas = reloj.indexOf('await conCandado("tablero-tareas-a-features", () => moverTareasAFeatures());');
  assert.ok(archivar > 0 && tareas > archivar && tareas - archivar < 600, "va justo después del archivado diario");
});

await prueba("que_es_esta_aplicacion tiene la regla en la descripción, regla_del_tablero_ia y tareas_a_features_tablero", () => {
  const mcp = leer("src/lib/mcp/que-es-esta-aplicacion.ts");
  assert.match(mcp, /import \{ REGLA_TAREAS_EN_FEATURES \} from "@\/features\/tableros-inteligentes\/services\/reglas-features";/);
  const definicion = mcp.slice(mcp.indexOf('name: "que_es_esta_aplicacion"'), mcp.indexOf("inputSchema", mcp.indexOf('name: "que_es_esta_aplicacion"')));
  assert.ok(definicion.includes("REGLA_TAREAS_EN_FEATURES"), "la descripción de la herramienta lleva la regla");
  assert.ok(mcp.includes("regla_del_tablero_ia: REGLA_TAREAS_EN_FEATURES,"), "la respuesta trae regla_del_tablero_ia");
  assert.ok(
    mcp.includes('tareas_a_features_tablero: await seguro("tareas_a_features_tablero", () => estadoDeTareasAFeatures(workspaceId)),'),
    "la automatización, con no_se_pudo_leer si falla",
  );
  const nota = leer("docs/cambios-pendientes/asfgbq9d.md");
  assert.match(nota, /^## Automatizaciones\n- `tareas_a_features_tablero`: /);
});

console.log(`\n${pruebas} pruebas: todas bien`);
