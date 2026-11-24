// Toda tarjeta que crea el Coordinador solo cuelga de Features, nunca suelta (pedido del dueño, 23-nov-2026: T-819 y sus
// partes T-872, T-873 y T-874 quedaron en la vista principal). Prueba la regla en TypeScript (padreDeTarjetaDelCoordinador),
// el arreglo del arranque contra PGlite (sin base ni red) y que trabajador.ts usa la regla al crear.
// Correr: npm run test:coordinador-en-features
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { cargar } from "./supervisor-cargar.mjs";

const trabajo = cargar("src/features/tableros-inteligentes/services/reglas-trabajador.ts");
const features = cargar("src/features/tableros-inteligentes/services/reglas-features.ts");
const sql = cargar("src/features/tableros-inteligentes/services/sql-trabajador.ts");

const TABLERO = "cmvg35cqq001i2io6q1hfwvio";
const FEATURES = "cmwbcu28700b732qmru2nd890";
const MAGILUS = "magilus";

let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const padre = (datos) => trabajo.padreDeTarjetaDelCoordinador({ ancestrosDeLaOriginal: [], padreDeLaOriginal: null, idDeLaOriginal: "original", ...datos });

await prueba("los ids fijos de Features son los del tablero Empresa Magilus", () => {
  assert.equal(features.TABLERO_DE_FEATURES_ID, TABLERO);
  assert.equal(features.TARJETA_AREA_FEATURES_ID, FEATURES);
});

await prueba("causa externa y limpieza en el tablero de Features cuelgan de Features (suelta, dentro o en otra área)", () => {
  for (const caso of ["causa-externa", "limpieza"]) {
    assert.equal(padre({ caso, tableroId: TABLERO }), FEATURES, `${caso} de una suelta`);
    assert.equal(padre({ caso, tableroId: TABLERO, padreDeLaOriginal: FEATURES, ancestrosDeLaOriginal: [FEATURES, MAGILUS] }), FEATURES, `${caso} dentro`);
    assert.equal(padre({ caso, tableroId: TABLERO, padreDeLaOriginal: "otraArea", ancestrosDeLaOriginal: ["otraArea", MAGILUS] }), FEATURES, `${caso} de otra área`);
  }
});

await prueba("partes: de una suelta o fuera de Features -> Features; de una dentro de Features -> la regla de siempre", () => {
  assert.equal(padre({ caso: "parte", tableroId: TABLERO, padreDeLaParte: null }), FEATURES, "T-819 suelta: sus partes no quedan sueltas");
  assert.equal(padre({ caso: "parte", tableroId: TABLERO, padreDeLaParte: "original" }), FEATURES, "aunque su tipo deje colgar de ella");
  assert.equal(
    padre({ caso: "parte", tableroId: TABLERO, padreDeLaOriginal: "otraArea", ancestrosDeLaOriginal: ["otraArea", MAGILUS], padreDeLaParte: "otraArea" }),
    FEATURES,
    "de otra área del tablero",
  );
  assert.equal(
    padre({ caso: "parte", tableroId: TABLERO, padreDeLaOriginal: FEATURES, ancestrosDeLaOriginal: [FEATURES, MAGILUS], padreDeLaParte: "original" }),
    "original",
    "dentro de Features y su tipo deja: cuelga de la original",
  );
  assert.equal(
    padre({ caso: "parte", tableroId: TABLERO, padreDeLaOriginal: "subFeatures", ancestrosDeLaOriginal: ["subFeatures", FEATURES, MAGILUS], padreDeLaParte: "subFeatures" }),
    "subFeatures",
    "dentro de una sub-área de Features: el mismo padre que la original",
  );
});

await prueba("en otro tablero (sin Features): el padre de la original, nunca vacío si la original tenía padre", () => {
  assert.equal(padre({ caso: "causa-externa", tableroId: "otro", padreDeLaOriginal: "areaX" }), "areaX");
  assert.equal(padre({ caso: "limpieza", tableroId: "otro", padreDeLaOriginal: "areaX" }), "areaX");
  assert.equal(padre({ caso: "parte", tableroId: "otro", padreDeLaOriginal: "areaX", padreDeLaParte: "original" }), "original", "la regla de siempre");
  assert.equal(padre({ caso: "parte", tableroId: "otro", padreDeLaOriginal: "areaX", padreDeLaParte: "areaX" }), "areaX");
  assert.equal(padre({ caso: "parte", tableroId: "otro", padreDeLaOriginal: "areaX", padreDeLaParte: undefined }), "areaX");
  assert.equal(padre({ caso: "causa-externa", tableroId: "otro", padreDeLaOriginal: null }), null, "solo sin padre si la original tampoco tenía");
  assert.notEqual(padre({ caso: "causa-externa", tableroId: "otro", padreDeLaOriginal: "areaX" }), FEATURES, "no cuelga de Features de otro tablero");
});

await prueba("SQL real (PGlite): el arranque cuelga de Features solo las sueltas del Coordinador, sin cambiar el estado, y repetirlo no cambia nada", async () => {
  const db = new PGlite();
  await db.exec(`
    CREATE TABLE "TableroInteligente" ("id" text PRIMARY KEY, "workspaceId" text);
    CREATE TABLE "TarjetaTablero" ("id" text PRIMARY KEY, "tableroId" text, "padreId" text, "estado" text, "borradoEn" timestamp, "actualizadoEn" timestamp);
    CREATE TABLE "HistorialTarjeta" ("id" serial PRIMARY KEY, "tarjetaId" text, "origen" text, "accion" text);
    INSERT INTO "TableroInteligente" VALUES ('${TABLERO}', 'ws'), ('otro', 'ws'), ('ajeno', 'ws2');
    INSERT INTO "TarjetaTablero" VALUES
      ('${MAGILUS}', '${TABLERO}', NULL, NULL, NULL, '2026-11-01'),
      ('${FEATURES}', '${TABLERO}', '${MAGILUS}', NULL, NULL, '2026-11-01'),
      ('t819', '${TABLERO}', NULL, 'APROBADO', NULL, '2026-11-01'),
      ('t872', '${TABLERO}', NULL, 'PLAN_APROBADO', NULL, '2026-11-01'),
      ('viejaHecha', '${TABLERO}', NULL, 'HECHO', NULL, '2026-11-01'),
      ('dePersona', '${TABLERO}', NULL, 'IDEA', NULL, '2026-11-01'),
      ('delSeo', '${TABLERO}', NULL, 'POR_APROBAR', NULL, '2026-11-01'),
      ('borrada', '${TABLERO}', NULL, 'APROBADO', '2026-11-02', '2026-11-01'),
      ('yaDentro', '${TABLERO}', '${FEATURES}', 'APROBADO', NULL, '2026-11-01'),
      ('enOtraArea', '${TABLERO}', '${MAGILUS}', 'APROBADO', NULL, '2026-11-01'),
      ('deOtroTablero', 'otro', NULL, 'APROBADO', NULL, '2026-11-01');
    INSERT INTO "HistorialTarjeta" ("tarjetaId", "origen", "accion") VALUES
      ('t819', 'TRABAJADOR', 'crear'), ('t872', 'TRABAJADOR', 'crear'), ('t872', 'TRABAJADOR', 'aprobar'),
      ('viejaHecha', 'TRABAJADOR', 'crear'), ('dePersona', 'PANTALLA', 'crear'), ('dePersona', 'TRABAJADOR', 'estado'),
      ('delSeo', 'MCP', 'crear'), ('borrada', 'TRABAJADOR', 'crear'), ('yaDentro', 'TRABAJADOR', 'crear'),
      ('enOtraArea', 'TRABAJADOR', 'crear'), ('deOtroTablero', 'TRABAJADOR', 'crear');
  `);
  const estados = async () => Object.fromEntries((await db.query(`SELECT "id", "padreId", "estado" FROM "TarjetaTablero" ORDER BY "id"`)).rows.map((f) => [f.id, f]));
  const antes = await estados();
  const ahora = "2026-11-24T12:00:00.000Z";

  // De otro negocio: el Área no es suya, no mueve nada.
  const ajeno = await db.query(sql.SQL_SUELTAS_DEL_COORDINADOR_A_FEATURES, ["ws2", ahora, FEATURES, TABLERO]);
  assert.equal(ajeno.rows.length, 0, "otro negocio no mueve tarjetas");

  const { rows } = await db.query(sql.SQL_SUELTAS_DEL_COORDINADOR_A_FEATURES, ["ws", ahora, FEATURES, TABLERO]);
  assert.deepEqual(rows.map((f) => f.id).sort(), ["t819", "t872", "viejaHecha"], "solo las sueltas creadas por el Coordinador en ese tablero");
  const despues = await estados();
  for (const id of ["t819", "t872", "viejaHecha"]) assert.equal(despues[id].padreId, FEATURES, `${id} cuelga de Features`);
  for (const id of Object.keys(antes)) assert.equal(despues[id].estado, antes[id].estado, `${id} no cambia de estado`);
  assert.equal(rows.find((f) => f.id === "t819").estado, "APROBADO", "devuelve el estado tal cual");
  for (const id of ["dePersona", "delSeo", "borrada", "deOtroTablero", MAGILUS]) assert.equal(despues[id].padreId, null, `${id} no se mueve`);
  assert.equal(despues.enOtraArea.padreId, MAGILUS, "la que ya tiene padre no se toca");
  assert.equal(despues.yaDentro.padreId, FEATURES);

  const otraVez = await db.query(sql.SQL_SUELTAS_DEL_COORDINADOR_A_FEATURES, ["ws", ahora, FEATURES, TABLERO]);
  assert.equal(otraVez.rows.length, 0, "repetirlo no mueve nada más");
  assert.deepEqual(await estados(), despues, "repetirlo no cambia nada");

  // Si el Área Features está borrada, no mueve ninguna (no las cuelga de una borrada).
  await db.exec(`UPDATE "TarjetaTablero" SET "padreId" = NULL WHERE "id" = 't819'; UPDATE "TarjetaTablero" SET "borradoEn" = '2026-11-20' WHERE "id" = '${FEATURES}';`);
  const conAreaBorrada = await db.query(sql.SQL_SUELTAS_DEL_COORDINADOR_A_FEATURES, ["ws", ahora, FEATURES, TABLERO]);
  assert.equal(conAreaBorrada.rows.length, 0, "con Features borrada no mueve nada");
  await db.close();
});

await prueba("trabajador.ts: ninguna tarjetaTablero.create del Coordinador queda sin padre; las tres toman el padre de padreDeTarjetaDelCoordinador", () => {
  const codigo = readFileSync("src/features/tableros-inteligentes/services/trabajador.ts", "utf8");
  const cuerpoDe = (nombre) => {
    const inicio = codigo.indexOf(`async function ${nombre}(`);
    assert.ok(inicio >= 0, `existe ${nombre}`);
    const fin = codigo.indexOf("\nasync function ", inicio + 10);
    return codigo.slice(inicio, fin < 0 ? undefined : fin);
  };
  const casos = { partirTarjeta: "parte", pedirLimpieza: "limpieza", pedirCausaExterna: "causa-externa" };
  for (const [nombre, caso] of Object.entries(casos)) {
    const cuerpo = cuerpoDe(nombre);
    assert.match(cuerpo, new RegExp(`const padreId = padreDeTarjetaDelCoordinador\\(\\{\\s*caso: "${caso}"`), `${nombre} decide el padre con la regla`);
    const creates = [...cuerpo.matchAll(/tx\.tarjetaTablero\.create\(\{\s*data: \{([\s\S]*?)\}/g)];
    assert.ok(creates.length >= 1, `${nombre} crea una tarjeta`);
    for (const [, data] of creates) assert.match(data, /\bpadreId\b/, `${nombre}: el create lleva padreId`);
  }
  const todos = (codigo.match(/tx\.tarjetaTablero\.create\(/g) ?? []).length;
  assert.equal(todos, 3, "trabajador.ts crea tarjetas solo en esas tres funciones");
  assert.match(cuerpoDe("arranqueDelTrabajador"), /SQL_SUELTAS_DEL_COORDINADOR_A_FEATURES/, "el arranque arregla las sueltas");
});

console.log(`\n${pruebas} pruebas, todas bien`);
