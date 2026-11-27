// Toda Tarea nueva cae sola en Features (27-nov-2026): el Coordinador solo toma lo que cuelga de Features (T-736).
// Una Tarea nueva sin padre del tablero de Features queda dentro de Features; si trae un padre fuera de Features, se crea
// igual con aviso_features. Prueba la parte pura (reglas-features.ts) y, por texto, que crearTarjeta, crear_tarjeta y
// las instrucciones del servidor MCP la usan. Parte 2: la revisión diaria (SQL_TAREAS_FUERA_DE_FEATURES contra PGlite, con
// todas las migraciones) y, por texto, el reloj y que_es_esta_aplicacion. Sin base real ni red.
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

/* ------------------------------------------------- parte 2: la revisión diaria, el SQL en PGlite */

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
const SUBSUB = "area-seo-ideas-0000000001";
const OTRA = "area-ventas-0000000000001";
const fila = (id, tablero, tipo, estado, repo, padre, dia = "2026-11-20 08:00:00") =>
  `('${id}', '${tablero}', '${id}', '${estado}', 'u-dueno', '${dia}', '${dia}', '${tipo}', ${repo ? `'${repo}'` : "NULL"}, ${padre ? `'${padre}'` : "NULL"})`;

await db.exec(`
  INSERT INTO "User" ("id", "email", "password", "updatedAt") VALUES ('u-dueno', 'dueno@x.co', 'x', now());
  INSERT INTO "Workspace" ("id", "name", "slug", "updatedAt", "ownerId") VALUES
    ('ws1', 'Magilus', 'magilus', now(), 'u-dueno'),
    ('ws2', 'Otro', 'otro', now(), 'u-dueno');
  INSERT INTO "TableroInteligente" ("id", "workspaceId", "nombre") VALUES
    ('${TABLERO}', 'ws1', 'Empresa Magilus'),
    ('tab-otro', 'ws1', 'Otro tablero'),
    ('tab-ws2', 'ws2', 'Tablero de otro negocio');
  INSERT INTO "TipoTarjeta" ("id", "tableroId", "nombre", "requiereAprobacion", "usaEstados", "orden") VALUES
    ('area', '${TABLERO}', 'Área', false, false, 0),
    ('idea', '${TABLERO}', 'Idea', false, true, 1),
    ('tarea', '${TABLERO}', 'Tarea', true, true, 2),
    ('tarea-otro', 'tab-otro', 'Tarea', true, true, 2),
    ('tarea-ws2', 'tab-ws2', ' tarea ', true, true, 2);
  INSERT INTO "TarjetaTablero" ("id", "tableroId", "titulo", "estado", "creadoPor", "creadoEn", "actualizadoEn", "tipoId", "repo", "padreId") VALUES
    ${[
      fila(FEATURES, TABLERO, "area", "IDEA", null, null, "2026-10-01 08:00:00"),
      fila(SUB, TABLERO, "area", "IDEA", null, FEATURES, "2026-10-01 08:00:00"),
      fila(SUBSUB, TABLERO, "area", "IDEA", null, SUB, "2026-10-01 08:00:00"),
      fila(OTRA, TABLERO, "area", "APROBADO", "aizencrm", null, "2026-10-01 08:00:00"),
      // Las que tienen que salir: fuera de Features, Tarea, APROBADO o PLAN_APROBADO, con repo.
      fila("fuera-suelta", TABLERO, "tarea", "APROBADO", "aizencrm", null, "2026-11-01 08:00:00"),
      fila("fuera-ventas", TABLERO, "tarea", "PLAN_APROBADO", "gestion", OTRA, "2026-11-02 08:00:00"),
      // Las que no.
      fila("dentro", TABLERO, "tarea", "APROBADO", "aizencrm", FEATURES),
      fila("dentro-sub", TABLERO, "tarea", "PLAN_APROBADO", "aizencrm", SUBSUB),
      fila("idea-fuera", TABLERO, "idea", "APROBADO", "aizencrm", null),
      fila("borrada", TABLERO, "tarea", "APROBADO", "aizencrm", null),
      fila("archivada", TABLERO, "tarea", "APROBADO", "aizencrm", null),
      fila("en-curso", TABLERO, "tarea", "EN_CURSO", "aizencrm", null),
      fila("por-aprobar", TABLERO, "tarea", "POR_APROBAR", "aizencrm", null),
      fila("planeando", TABLERO, "tarea", "PLANEANDO", "aizencrm", null),
      fila("subiendo", TABLERO, "tarea", "SUBIENDO", "aizencrm", null),
      fila("sin-repo", TABLERO, "tarea", "APROBADO", null, null),
      fila("repo-vacio", TABLERO, "tarea", "APROBADO", "  ", null),
      fila("otro-tablero", "tab-otro", "tarea-otro", "APROBADO", "aizencrm", null),
      fila("otro-negocio", "tab-ws2", "tarea-ws2", "APROBADO", "aizencrm", null),
    ].join(",\n    ")};
  UPDATE "TarjetaTablero" SET "borradoEn" = '2026-11-21 08:00:00' WHERE "id" = 'borrada';
  UPDATE "TarjetaTablero" SET "archivadaEn" = '2026-11-21 08:00:00' WHERE "id" = 'archivada';
`);

const fuera = async (negocio = "ws1", tablero = TABLERO) =>
  (await db.query(sqlFeatures.SQL_TAREAS_FUERA_DE_FEATURES, [FEATURES, tablero, negocio])).rows;

await prueba("SQL_TAREAS_FUERA_DE_FEATURES: solo las Tareas APROBADO y PLAN_APROBADO con repo que están fuera", async () => {
  const filas = await fuera();
  assert.deepEqual(filas.map((f) => f.id), ["fuera-suelta", "fuera-ventas"], "las de dentro, sub-áreas, Ideas, Áreas, borradas, archivadas, otros estados y sin repo no salen");
  assert.deepEqual(filas.map((f) => [f.padreId, f.estado]), [[null, "APROBADO"], [OTRA, "PLAN_APROBADO"]]);
  assert.ok(filas.every((f) => f.actualizadoEn instanceof Date), "trae actualizadoEn para el cambio condicional");
});

await prueba("SQL_TAREAS_FUERA_DE_FEATURES: otro tablero u otro negocio no devuelven nada", async () => {
  assert.deepEqual(await fuera("ws2"), [], "otro negocio");
  assert.deepEqual(await fuera("ws1", "tab-otro"), [], "otro tablero (Features no está ahí)");
  assert.deepEqual(await fuera("ws2", "tab-ws2"), [], "otro negocio con su propio tablero");
});

await prueba("después de moverlas (cambio condicional), la consulta ya no devuelve nada", async () => {
  // El mismo cambio condicional de moverUna: solo si sigue con el padre, el estado y la fecha que se leyeron.
  const mover = (f) =>
    db.query(
      `UPDATE "TarjetaTablero" SET "padreId" = $1, "actualizadoEn" = now()
       WHERE "id" = $2 AND "padreId" IS NOT DISTINCT FROM $3 AND "estado"::text = $4 AND "actualizadoEn" = $5 AND "borradoEn" IS NULL AND "archivadaEn" IS NULL`,
      [FEATURES, f.id, f.padreId, f.estado, f.actualizadoEn],
    );
  const filas = await fuera();
  // Alguien cambió una mientras tanto: esa no se mueve.
  await db.exec(`UPDATE "TarjetaTablero" SET "actualizadoEn" = '2026-11-26 08:00:00' WHERE "id" = 'fuera-ventas'`);
  for (const f of filas) await mover(f);
  const [{ padre: padreVentas }] = (await db.query(`SELECT "padreId" AS padre FROM "TarjetaTablero" WHERE "id" = 'fuera-ventas'`)).rows;
  assert.equal(padreVentas, OTRA, "la que cambió en el medio no se pisó");
  // La vuelta siguiente la vuelve a leer y la mueve.
  for (const f of await fuera()) await mover(f);
  assert.deepEqual(await fuera(), [], "ya no queda ninguna fuera");
  const estados = (await db.query(`SELECT "id", "estado"::text AS estado, "padreId" FROM "TarjetaTablero" WHERE "id" IN ('fuera-suelta', 'fuera-ventas') ORDER BY "id"`)).rows;
  assert.deepEqual(estados.map((f) => [f.id, f.estado, f.padreId]), [["fuera-suelta", "APROBADO", FEATURES], ["fuera-ventas", "PLAN_APROBADO", FEATURES]], "el estado no cambia");
});

await prueba("con Features borrada (o sin Features) no devuelve nada", async () => {
  await db.exec(`UPDATE "TarjetaTablero" SET "padreId" = NULL WHERE "id" = 'fuera-suelta'`);
  assert.deepEqual((await fuera()).map((f) => f.id), ["fuera-suelta"], "vuelve a estar fuera");
  await db.exec(`UPDATE "TarjetaTablero" SET "borradoEn" = '2026-11-27 08:00:00' WHERE "id" = '${FEATURES}'`);
  assert.deepEqual(await fuera(), [], "Features borrada");
  await db.exec(`UPDATE "TarjetaTablero" SET "borradoEn" = NULL WHERE "id" = '${FEATURES}'`);
  assert.deepEqual((await db.query(sqlFeatures.SQL_TAREAS_FUERA_DE_FEATURES, ["no-existe-000000000000001", TABLERO, "ws1"])).rows, [], "Features no existe");
});

await db.close();

/* ------------------------------------------------- parte 2: por texto, el reloj y que_es_esta_aplicacion */

await prueba("moverTareasAFeatures: una vez al día, interruptor, cambio condicional e historial 'mover'", () => {
  const texto = leer("src/features/tableros-inteligentes/services/tareas-a-features.ts");
  assert.ok(texto.includes("export async function moverTareasAFeatures(ahora: Date = new Date())"));
  assert.ok(texto.includes("const dia = diaDeBogota(ahora);"), "por fecha de Bogotá");
  assert.ok(texto.includes("`${PREFIJO_TAREAS_A_FEATURES}:${workspaceId}`") && texto.includes('const PREFIJO_TAREAS_A_FEATURES = "tablero:tareas-a-features"'));
  assert.ok(texto.includes('.trim().toLowerCase() !== "false"'), "solo \"false\" la apaga");
  assert.match(texto, /where: \{\s*id: fila\.id,\s*padreId: fila\.padreId,\s*estado: fila\.estado,\s*actualizadoEn: fila\.actualizadoEn,/);
  assert.match(texto, /data: \{ padreId: TARJETA_AREA_FEATURES_ID \}/, "solo cambia el padre");
  assert.ok(texto.includes('accion: "mover"') && texto.includes('export const QUIEN_MUEVE_A_FEATURES = "sistema:tareas-a-features"'));
  assert.ok(texto.includes("SQL_TAREAS_FUERA_DE_FEATURES, TARJETA_AREA_FEATURES_ID, TABLERO_DE_FEATURES_ID, negocio"), "parámetros: Features, tablero, negocio");
  assert.ok(texto.includes("return { movidas };"));
});

await prueba("el reloj llama a moverTareasAFeatures con candado", () => {
  const ruta = leer("src/app/api/cron/follows/route.ts");
  assert.ok(ruta.includes('import { moverTareasAFeatures } from "@/features/tableros-inteligentes/services/tareas-a-features";'));
  assert.ok(ruta.includes('await conCandado("tablero-tareas-a-features", () => moverTareasAFeatures());'));
});

await prueba("que_es_esta_aplicacion: la regla en la descripción, regla_del_tablero_ia y tareas_a_features_tablero", () => {
  const app = leer("src/lib/mcp/que-es-esta-aplicacion.ts");
  assert.match(app, /import \{ REGLA_TAREAS_EN_FEATURES \} from "@\/features\/tableros-inteligentes\/services\/reglas-features";/);
  const definicion = app.slice(app.indexOf('name: "que_es_esta_aplicacion"'), app.indexOf("inputSchema", app.indexOf('name: "que_es_esta_aplicacion"')));
  assert.ok(definicion.includes("REGLA_TAREAS_EN_FEATURES"), "la descripción usa la regla");
  assert.ok(app.includes("regla_del_tablero_ia: REGLA_TAREAS_EN_FEATURES,"));
  assert.ok(app.includes('tareas_a_features_tablero: await seguro("tareas_a_features_tablero", () => estadoDeTareasAFeatures(workspaceId)),'), "si falla, sale en no_se_pudo_leer");
});

await prueba("la nota del manual nocturno está bajo ## Automatizaciones", () => {
  const nota = leer("docs/cambios-pendientes/asfgbq9d.md");
  assert.match(nota, /^## Automatizaciones\n- `tareas_a_features_tablero`: /);
});

console.log(`\n${pruebas} pruebas: todas bien`);
