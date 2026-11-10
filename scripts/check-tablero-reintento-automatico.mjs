/**
 * Prueba del REINTENTO AUTOMÁTICO de las tarjetas caídas del Tablero IA (10-nov-2026, parte 1 de «que las tarjetas
 * trabadas se resuelvan solas»), sin tocar ninguna base real:
 *   npm run test:tablero-reintento-automatico
 *
 * 1. decidirCaida (reglas-trabajador.ts), la regla pura, en todos los casos: sin señal, con señal reciente, 1.º y 2.º
 *    reintento, el 3.º que pasa a ERROR, SUBIENDO a los 45 min y el orquestador antes de la primera señal.
 * 2. senalDeEntrada y caidaDelResultado (lo que guarda el latido y lo que lee el aviso urgente).
 * 3. Las consultas reales (sql-trabajador.ts) contra un Postgres embebido (PGlite) con TODAS las migraciones:
 *    SQL_TARJETAS_CAIDAS decide igual que decidirCaida, reintenta (PLANEANDO -> APROBADO, EN_CURSO -> PLAN_APROBADO,
 *    SUBIENDO -> SUBIENDO pendiente) hasta 2 veces y a la 3.ª pasa a ERROR; la vencida por el tope de la etapa y la
 *    huérfana siguen la misma regla; la vencida por falta de latido sigue igual que antes.
 * 4. El latido real (services/trabajador.ts, con un prisma falso): `senalEn` queda en resultado.construccion.ultimaSenalEn
 *    sin borrar lo que había; un latido sin `senalEn` corre el candado pero no cuenta como señal.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { cargar } from "./supervisor-cargar.mjs";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const reglas = cargar("src/features/tableros-inteligentes/services/reglas-trabajador.ts");
const sql = cargar("src/features/tableros-inteligentes/services/sql-trabajador.ts");

let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const MIN = 60_000;
const INICIO = new Date("2026-11-10T10:00:00.000Z");
const mas = (minutos, desde = INICIO) => new Date(desde.getTime() + minutos * MIN);
const decidir = (extra) => reglas.decidirCaida({ trabajoIniciadoEn: INICIO, reintentosAutomaticos: 0, ...extra });

/* ───────────────────────────────────────────────────────────────── 1. decidirCaida ── */

await prueba("las constantes: 90 / 90 / 45 min sin señal y 2 reintentos automáticos", async () => {
  assert.deepEqual({ ...reglas.MINUTOS_SIN_SENAL_PARA_CAIDA }, { planear: 90, construir: 90, subir: 45 });
  assert.equal(reglas.TOPE_DE_REINTENTOS_AUTOMATICOS, 2);
  assert.ok(reglas.CATEGORIAS_DE_INTENTO.includes("construccion_caida"));
  assert.ok(reglas.ACCIONES_DE_INTENTO.includes("reintentar"));
});

await prueba("sin señal: cuenta desde que se tomó (PLANEANDO y EN_CURSO en aizen1 caen pasados los 90 min, no antes)", async () => {
  assert.equal(decidir({ estado: "EN_CURSO", ahora: mas(90) }), "seguir", "a los 90 justos sigue");
  assert.equal(decidir({ estado: "EN_CURSO", ahora: mas(91) }), "reintentar");
  assert.equal(decidir({ estado: "EN_CURSO", lugar: "aizen1", ahora: mas(91) }), "reintentar");
  assert.equal(decidir({ estado: "PLANEANDO", ahora: mas(60) }), "seguir");
  assert.equal(decidir({ estado: "PLANEANDO", ahora: mas(91) }), "reintentar");
});

await prueba("con señal reciente sigue aunque lleve horas tomada; la señal vieja (de antes de tomarla) no cuenta", async () => {
  assert.equal(decidir({ estado: "EN_CURSO", lugar: "nube", ultimaSenalEn: mas(200), ahora: mas(250) }), "seguir");
  assert.equal(decidir({ estado: "EN_CURSO", lugar: "orquestador", ultimaSenalEn: mas(200).toISOString(), ahora: mas(291) }), "reintentar", "91 min sin señal");
  assert.equal(decidir({ estado: "EN_CURSO", ultimaSenalEn: mas(-30), ahora: mas(91) }), "reintentar", "una señal de la vuelta anterior no cuenta: se mide desde que se tomó");
  assert.equal(decidir({ estado: "EN_CURSO", ultimaSenalEn: mas(-30), ahora: mas(80) }), "seguir");
  assert.equal(decidir({ estado: "EN_CURSO", ultimaSenalEn: "no es fecha", ahora: mas(80) }), "seguir");
});

await prueba("1.º y 2.º reintento; el 3.º pasa a ERROR", async () => {
  const caida = { estado: "EN_CURSO", ahora: mas(120) };
  assert.equal(decidir({ ...caida, reintentosAutomaticos: 0 }), "reintentar", "1.º");
  assert.equal(decidir({ ...caida, reintentosAutomaticos: 1 }), "reintentar", "2.º");
  assert.equal(decidir({ ...caida, reintentosAutomaticos: 2 }), "error", "3.º");
  assert.equal(decidir({ ...caida, reintentosAutomaticos: 7 }), "error");
  assert.equal(decidir({ ...caida, reintentosAutomaticos: null }), "reintentar", "sin contador es 0");
  assert.equal(decidir({ ...caida, reintentosAutomaticos: -3 }), "reintentar", "un contador raro es 0");
});

await prueba("SUBIENDO: con señal cae pasados los 45 min sin otra; sin ninguna señal sigue (manda el tope de la etapa)", async () => {
  assert.equal(decidir({ estado: "SUBIENDO", ultimaSenalEn: mas(5), ahora: mas(50) }), "seguir", "45 justos");
  assert.equal(decidir({ estado: "SUBIENDO", ultimaSenalEn: mas(5), ahora: mas(51) }), "reintentar");
  assert.equal(decidir({ estado: "SUBIENDO", ultimaSenalEn: mas(5), ahora: mas(51), reintentosAutomaticos: 2 }), "error");
  assert.equal(decidir({ estado: "SUBIENDO", ahora: mas(70) }), "seguir", "sin señal: la vigilancia de 30 min más la subida no se corta");
});

await prueba("orquestador y nube antes de la primera señal: siguen (manda el tope de 24 h / 180 min); con la primera señal, ya cuenta", async () => {
  assert.equal(decidir({ estado: "EN_CURSO", lugar: "orquestador", ahora: mas(600) }), "seguir");
  assert.equal(decidir({ estado: "EN_CURSO", lugar: "orquestador", ahora: mas(1400), reintentosAutomaticos: 2 }), "seguir");
  assert.equal(decidir({ estado: "EN_CURSO", lugar: "nube", ahora: mas(170) }), "seguir");
  assert.equal(decidir({ estado: "EN_CURSO", lugar: "orquestador", ultimaSenalEn: mas(10), ahora: mas(101) }), "reintentar");
});

await prueba("lo que no tiene el Coordinador no se toca: otros estados o sin trabajoIniciadoEn", async () => {
  for (const estado of ["APROBADO", "PLAN_APROBADO", "POR_REVISAR", "ERROR", "HECHO"]) assert.equal(decidir({ estado, ahora: mas(500) }), "seguir", estado);
  assert.equal(decidir({ estado: "EN_CURSO", trabajoIniciadoEn: null, ahora: mas(500) }), "seguir");
});

/* ───────────────────────────────────────────────────────────────── 2. entrada y lectura ── */

await prueba("senalDeEntrada: ISO válido; la futura vale ahora; la anterior a tomarla, un texto raro o nada se descartan", async () => {
  const ahora = mas(30);
  assert.equal(reglas.senalDeEntrada(mas(20).toISOString(), INICIO, ahora).toISOString(), mas(20).toISOString());
  assert.equal(reglas.senalDeEntrada(mas(90).toISOString(), INICIO, ahora).toISOString(), ahora.toISOString(), "futura -> ahora");
  assert.equal(reglas.senalDeEntrada(mas(-1).toISOString(), INICIO, ahora), null, "de antes de tomarla");
  assert.equal(reglas.senalDeEntrada("ayer", INICIO, ahora), null);
  assert.equal(reglas.senalDeEntrada(undefined, INICIO, ahora), null);
  assert.equal(reglas.senalDeEntrada(12345, INICIO, ahora), null);
});

await prueba("caidaDelResultado: solo el ERROR con resultado.error.por = 'caida'; reintentosAutomaticosDelResultado lee el contador", async () => {
  assert.deepEqual(reglas.caidaDelResultado({ error: { motivo: "se cayó la construcción 3 veces", por: "caida" } }), { motivo: "se cayó la construcción 3 veces" });
  assert.equal(reglas.caidaDelResultado({ error: { motivo: "venció el candado" } }), null);
  assert.equal(reglas.caidaDelResultado({ error: "texto" }), null);
  assert.equal(reglas.caidaDelResultado(null), null);
  assert.equal(reglas.reintentosAutomaticosDelResultado({ reintentosAutomaticos: { veces: 2 } }), 2);
  assert.equal(reglas.reintentosAutomaticosDelResultado({}), 0);
});

/* ───────────────────────────────────────────────────────────────── 3. las consultas (PGlite) ── */

const CARPETA = path.join(RAIZ, "prisma", "migrations");
const migraciones = fs
  .readdirSync(CARPETA, { withFileTypes: true })
  .filter((entrada) => entrada.isDirectory())
  .map((entrada) => entrada.name)
  .sort();
const db = new PGlite();
for (const nombre of migraciones) {
  try {
    await db.exec(fs.readFileSync(path.join(CARPETA, nombre, "migration.sql"), "utf8"));
  } catch (fallo) {
    throw new Error(`La migración ${nombre} falló en PGlite: ${fallo.message}`);
  }
}
const filas = async (texto, valores = []) => (await db.query(texto, valores)).rows;

await db.exec(`
  INSERT INTO "User" ("id", "email", "password", "updatedAt") VALUES ('u1', 'dueno@x.co', 'x', now());
  INSERT INTO "Workspace" ("id", "name", "slug", "updatedAt", "ownerId") VALUES ('ws1', 'Magilus', 'magilus', now(), 'u1'), ('ws2', 'Otro', 'otro', now(), NULL);
  INSERT INTO "TableroInteligente" ("id", "workspaceId", "nombre") VALUES ('tab1', 'ws1', 'Sistemas'), ('tab2', 'ws2', 'Otro');
  INSERT INTO "TipoTarjeta" ("id", "tableroId", "nombre", "requiereAprobacion", "usaEstados", "orden") VALUES
    ('tarea', 'tab1', 'Tarea', true, true, 0), ('tarea2', 'tab2', 'Tarea', true, true, 0);
`);

/** Una tarjeta de prueba con repo y plan: tomada en `ini`, con el candado hasta `vence` (ISO o null). */
async function tarjeta(id, { estado, ini, vence, resultado = null, tablero = "tab1", tipo = "tarea", plan = "El plan", actualizado = null }) {
  await db.query(
    `INSERT INTO "TarjetaTablero" ("id", "tableroId", "titulo", "estado", "creadoPor", "actualizadoEn", "tipoId", "repo", "plan", "intentos", "trabajoIniciadoEn", "trabajoVenceEn", "resultado")
     VALUES ($1, $2, $3, $4::"EstadoTarjeta", 'u1', $5::timestamptz AT TIME ZONE 'UTC', $6, 'aizencrm', $7, 1,
             $8::timestamptz AT TIME ZONE 'UTC', $9::timestamptz AT TIME ZONE 'UTC', $10::jsonb)`,
    [id, tablero, `Tarjeta ${id}`, estado, actualizado ?? ini ?? INICIO.toISOString(), tipo, plan, ini, vence, resultado === null ? null : JSON.stringify(resultado)],
  );
}
const leer = async (id) => (await filas(`SELECT "estado"::text AS "estado", "trabajoVenceEn", "intentos", "resultado" FROM "TarjetaTablero" WHERE "id" = $1`, [id]))[0];
const intentosDe = async (id) =>
  filas(`SELECT "numero", "etapa", "categoria", "accion", "cuentaComoIntento", "causa" FROM "IntentoTarjeta" WHERE "tarjetaId" = $1 ORDER BY "numero"`, [id]);
const caidas = (ahora, ws = "ws1") => filas(sql.SQL_TARJETAS_CAIDAS, [ws, ahora.toISOString(), ahora.toISOString()]);
const vencidas = (ahora, ws = "ws1") => filas(sql.SQL_PASAR_VENCIDAS_A_ERROR, [ws, ahora.toISOString(), "Se pasó del tiempo", ahora.toISOString(), 5]);
const huerfanas = (ahora, ws = "ws1") => filas(sql.SQL_PASAR_HUERFANAS_A_ERROR, [ws, ahora.toISOString(), ahora.toISOString(), 30]);
const iso = (fecha) => fecha.toISOString();

await prueba("SQL_TARJETAS_CAIDAS decide igual que decidirCaida (cada caso, con el candado vigente)", async () => {
  const AHORA = mas(300);
  const casos = [
    // id, estado, minutos desde que se tomó, última señal (min desde que se tomó) | null, lugar, reintentos
    ["s-obra-sin", "EN_CURSO", 100, null, "aizen1", 0],
    ["s-obra-reciente", "EN_CURSO", 250, 200, "nube", 0],
    ["s-obra-vieja", "EN_CURSO", 250, 100, "orquestador", 1],
    ["s-obra-tercera", "EN_CURSO", 250, 100, "nube", 2],
    ["s-orq-sin", "EN_CURSO", 290, null, "orquestador", 2],
    ["s-nube-sin", "EN_CURSO", 170, null, "nube", 0],
    ["s-sube-sin", "SUBIENDO", 70, null, null, 0],
    ["s-sube-44", "SUBIENDO", 70, 26, null, 0],
    ["s-sube-46", "SUBIENDO", 70, 24, null, 0],
    ["s-plan-sin", "PLANEANDO", 95, null, null, 0],
    ["s-plan-senal-vieja", "PLANEANDO", 95, -10, null, 0],
  ];
  for (const [id, estado, tomadaHace, senal, lugar, veces] of casos) {
    const ini = mas(-tomadaHace, AHORA);
    const construccion = { ...(lugar ? { lugar } : {}), ...(senal !== null ? { ultimaSenalEn: iso(mas(senal, ini)) } : {}) };
    await tarjeta(id, { estado, ini: iso(ini), vence: iso(mas(4, AHORA)), resultado: { construccion, reintentosAutomaticos: { veces, motivos: [] } } });
  }
  const movidas = Object.fromEntries((await caidas(AHORA)).map((f) => [f.id, f]));
  for (const [id, estado, tomadaHace, senal, lugar, veces] of casos) {
    const ini = mas(-tomadaHace, AHORA);
    const esperado = reglas.decidirCaida({
      estado,
      trabajoIniciadoEn: ini,
      ultimaSenalEn: senal !== null ? mas(senal, ini) : null,
      lugar,
      reintentosAutomaticos: veces,
      ahora: AHORA,
    });
    const obtenido = !movidas[id] ? "seguir" : movidas[id].tipo === "caida" ? "error" : "reintentar";
    assert.equal(obtenido, esperado, `${id}: SQL=${obtenido}, decidirCaida=${esperado}`);
  }
  // Lo que se espera, escrito a mano (para que las dos no se equivoquen juntas).
  assert.deepEqual(Object.keys(movidas).sort(), ["s-obra-sin", "s-obra-tercera", "s-obra-vieja", "s-plan-senal-vieja", "s-plan-sin", "s-sube-46"]);
  assert.equal(movidas["s-obra-tercera"].tipo, "caida");
  await db.exec(`DELETE FROM "TarjetaTablero" WHERE "id" LIKE 's-%'`);
});

await prueba("caída: 1.º y 2.º vuelven solas a la fila (plan aprobado sigue aprobado), el 3.º pasa a ERROR con el motivo y el contador a 0", async () => {
  const ini1 = INICIO;
  await tarjeta("k1", { estado: "EN_CURSO", ini: iso(ini1), vence: iso(mas(95)), resultado: { rama: "tablero/k1", construccion: { lugar: "aizen1" } } });
  // 1.ª caída: 91 min sin señal.
  let movidas = await caidas(mas(91));
  assert.deepEqual(movidas.map((f) => [f.id, f.antes, f.estado, f.tipo]), [["k1", "EN_CURSO", "PLAN_APROBADO", "reintentada"]]);
  let fila = await leer("k1");
  assert.equal(fila.estado, "PLAN_APROBADO", "EN_CURSO -> PLAN_APROBADO: no se vuelve a pedir el sí del plan");
  assert.equal(fila.trabajoVenceEn, null, "suelta el candado");
  assert.equal(fila.intentos, 1, "cuenta como intento");
  assert.equal(fila.resultado.rama, "tablero/k1", "conserva el resultado");
  assert.equal(fila.resultado.construccion.lugar, "aizen1");
  assert.equal(fila.resultado.reintentosAutomaticos.veces, 1);
  assert.deepEqual(fila.resultado.reintentosAutomaticos.motivos.map((m) => [m.en, m.minutos, m.motivo]), [["EN_CURSO", 91, "EN_CURSO: 91 min sin señal del Coordinador"]]);
  assert.deepEqual(await intentosDe("k1"), [
    { numero: 1, etapa: "construir", categoria: "construccion_caida", accion: "reintentar", cuentaComoIntento: true, causa: "Se cayó (EN_CURSO: 91 min sin señal del Coordinador): vuelve sola a la fila, reintento 1 de 2." },
  ]);

  // 2.ª caída: la vuelve a tomar y tiene una señal, pero se queda 100 min sin otra.
  const ini2 = mas(100);
  await db.query(
    `UPDATE "TarjetaTablero" SET "estado" = 'EN_CURSO', "trabajoIniciadoEn" = $2::timestamptz AT TIME ZONE 'UTC', "trabajoVenceEn" = $3::timestamptz AT TIME ZONE 'UTC',
       "resultado" = jsonb_set("resultado", '{construccion,ultimaSenalEn}', to_jsonb($4::text)) WHERE "id" = $1`,
    ["k1", iso(ini2), iso(mas(250)), iso(mas(10, ini2))],
  );
  assert.deepEqual(await caidas(mas(95, ini2)), [], "85 min desde la señal: sigue");
  movidas = await caidas(mas(101, ini2));
  assert.deepEqual(movidas.map((f) => [f.id, f.estado, f.tipo]), [["k1", "PLAN_APROBADO", "reintentada"]]);
  fila = await leer("k1");
  assert.equal(fila.resultado.reintentosAutomaticos.veces, 2);
  assert.equal(fila.resultado.reintentosAutomaticos.motivos.length, 2);

  // 3.ª caída: pasa a ERROR.
  const ini3 = mas(300);
  await db.query(
    `UPDATE "TarjetaTablero" SET "estado" = 'EN_CURSO', "trabajoIniciadoEn" = $2::timestamptz AT TIME ZONE 'UTC', "trabajoVenceEn" = $3::timestamptz AT TIME ZONE 'UTC' WHERE "id" = $1`,
    ["k1", iso(ini3), iso(mas(400))],
  );
  movidas = await caidas(mas(92, ini3));
  assert.deepEqual(movidas.map((f) => [f.id, f.antes, f.estado, f.tipo]), [["k1", "EN_CURSO", "ERROR", "caida"]]);
  assert.equal(movidas[0].motivo, "se cayó la construcción 3 veces (último: EN_CURSO, 92 min sin señal)");
  fila = await leer("k1");
  assert.equal(fila.estado, "ERROR");
  assert.equal(fila.trabajoVenceEn, null);
  assert.deepEqual(
    { ...fila.resultado.error, cuando: undefined },
    { motivo: "se cayó la construcción 3 veces (último: EN_CURSO, 92 min sin señal)", en: "EN_CURSO", cuando: undefined, por: "caida" },
  );
  assert.equal(fila.resultado.reintentosAutomaticos.veces, 0, "el contador vuelve a 0: un Reintentar del dueño tiene otros 2");
  assert.equal(fila.resultado.reintentosAutomaticos.motivos.length, 3, "los motivos se guardan");
  assert.deepEqual(reglas.caidaDelResultado(fila.resultado), { motivo: "se cayó la construcción 3 veces (último: EN_CURSO, 92 min sin señal)" });
  const intentos = await intentosDe("k1");
  assert.deepEqual(intentos.map((i) => [i.numero, i.categoria, i.accion, i.cuentaComoIntento]), [
    [1, "construccion_caida", "reintentar", true],
    [2, "construccion_caida", "reintentar", true],
    [3, "construccion_caida", "escalar", true],
  ]);
  assert.deepEqual(await caidas(mas(200, ini3)), [], "en ERROR ya no se toca");
});

await prueba("caída: PLANEANDO vuelve a APROBADO y SUBIENDO a SUBIENDO pendiente; otro negocio no ve las de este", async () => {
  const AHORA = mas(1000);
  await tarjeta("p1", { estado: "PLANEANDO", ini: iso(mas(-95, AHORA)), vence: iso(mas(3, AHORA)) });
  await tarjeta("u1", { estado: "SUBIENDO", ini: iso(mas(-60, AHORA)), vence: iso(mas(3, AHORA)), resultado: { construccion: { ultimaSenalEn: iso(mas(-50, AHORA)) } } });
  await tarjeta("o1", { estado: "EN_CURSO", ini: iso(mas(-95, AHORA)), vence: iso(mas(3, AHORA)), tablero: "tab2", tipo: "tarea2" });
  const movidas = await caidas(AHORA);
  assert.deepEqual(movidas.map((f) => [f.id, f.antes, f.estado]).sort(), [["p1", "PLANEANDO", "APROBADO"], ["u1", "SUBIENDO", "SUBIENDO"]]);
  assert.equal((await leer("u1")).trabajoVenceEn, null, "SUBIENDO pendiente: sin candado");
  assert.deepEqual((await intentosDe("u1")).map((i) => [i.etapa, i.accion]), [["subir", "reintentar"]]);
  assert.equal((await leer("o1")).estado, "EN_CURSO", "la del otro negocio no se tocó");
  assert.deepEqual((await caidas(AHORA, "ws2")).map((f) => f.id), ["o1"]);
});

await prueba("vencida por el tope de la etapa: se reintenta en vez de ir directo a ERROR; por falta de latido sigue igual", async () => {
  const AHORA = mas(2000);
  // Tope de 90 (aizen1): tomada hace 95 min y el candado venció en el tope.
  await tarjeta("t1", { estado: "EN_CURSO", ini: iso(mas(-95, AHORA)), vence: iso(mas(-5, AHORA)), resultado: { construccion: { lugar: "aizen1" } } });
  // Orquestador (24 h): llegó al tope sin ninguna señal y ya llevaba 2 reintentos: ERROR por caída.
  await tarjeta("t2", { estado: "EN_CURSO", ini: iso(mas(-1445, AHORA)), vence: iso(mas(-5, AHORA)), resultado: { construccion: { lugar: "orquestador" }, reintentosAutomaticos: { veces: 2, motivos: [] } } });
  // Falta de latido (venció a los 10 min, mucho antes del tope): vuelve a la fila sin gastar el intento, como siempre.
  await tarjeta("t3", { estado: "EN_CURSO", ini: iso(mas(-15, AHORA)), vence: iso(mas(-5, AHORA)) });
  const movidas = Object.fromEntries((await vencidas(AHORA)).map((f) => [f.id, f]));
  assert.deepEqual(
    Object.values(movidas).map((f) => [f.id, f.estado, f.tipo]).sort(),
    [["t1", "PLAN_APROBADO", "reintentada"], ["t2", "ERROR", "caida"], ["t3", "PLAN_APROBADO", "suelta"]],
  );
  assert.equal(movidas.t2.motivo, "se cayó la construcción 3 veces (último: EN_CURSO, 1445 min sin señal)");
  assert.deepEqual((await intentosDe("t1")).map((i) => [i.categoria, i.accion, i.cuentaComoIntento]), [["construccion_caida", "reintentar", true]]);
  assert.match((await intentosDe("t1"))[0].causa, /se pasó del tiempo máximo de la etapa/);
  assert.deepEqual((await intentosDe("t2")).map((i) => [i.categoria, i.accion]), [["construccion_caida", "escalar"]]);
  assert.deepEqual((await intentosDe("t3")).map((i) => [i.categoria, i.accion, i.cuentaComoIntento]), [["coordinador_cortado", "esperar", false]]);
  const t3 = await leer("t3");
  assert.equal(t3.intentos, 0, "la suelta por falta de latido no gasta el intento");
  assert.equal(t3.resultado, null, "ni deja reintentos automáticos");
  assert.equal((await leer("t1")).intentos, 1, "la reintentada sí cuenta");
});

await prueba("huérfana: vuelve sola a la fila hasta 2 veces y a la 3.ª pasa a ERROR (antes iba directo a ERROR)", async () => {
  const AHORA = mas(3000);
  await tarjeta("h1", { estado: "EN_CURSO", ini: null, vence: null, actualizado: iso(mas(-40, AHORA)) });
  await tarjeta("h2", { estado: "PLANEANDO", ini: null, vence: null, actualizado: iso(mas(-40, AHORA)), resultado: { reintentosAutomaticos: { veces: 2, motivos: [{ motivo: "antes" }] } } });
  await tarjeta("h3", { estado: "EN_CURSO", ini: null, vence: null, actualizado: iso(mas(-10, AHORA)) });
  const movidas = Object.fromEntries((await huerfanas(AHORA)).map((f) => [f.id, f]));
  assert.deepEqual(Object.values(movidas).map((f) => [f.id, f.antes, f.estado, f.tipo]).sort(), [
    ["h1", "EN_CURSO", "PLAN_APROBADO", "reintentada"],
    ["h2", "PLANEANDO", "ERROR", "caida"],
  ]);
  assert.equal(movidas.h2.motivo, "se cayó la construcción 3 veces (último: PLANEANDO, 40 min sin señal)");
  const h2 = await leer("h2");
  assert.deepEqual(h2.resultado.reintentosAutomaticos.motivos.map((m) => m.motivo), ["antes", "huérfana: PLANEANDO sin candado, sin cambios hace 40 min"]);
  assert.equal(h2.resultado.error.por, "caida");
  assert.deepEqual((await intentosDe("h1")).map((i) => [i.etapa, i.categoria, i.accion, i.cuentaComoIntento]), [["construir", "construccion_caida", "reintentar", true]]);
  assert.equal((await leer("h3")).estado, "EN_CURSO", "la reciente no se toca");
});

await db.close();
/* ───────────────────────────────────────────────────────────────── 4. el latido (prisma falso) ── */

const tarjetasFalsas = new Map();
const refrescos = [];
const prismaFalso = {
  tarjetaTablero: {
    findFirst: async ({ where }) => {
      const fila = tarjetasFalsas.get(where.id);
      return fila && fila.workspaceId === where.tablero.workspaceId && !fila.borradoEn ? structuredClone(fila) : null;
    },
    updateMany: async ({ where, data }) => {
      const fila = tarjetasFalsas.get(where.id);
      if (!fila || fila.estado !== where.estado || !(fila.trabajoVenceEn > where.trabajoVenceEn.gt)) return { count: 0 };
      Object.assign(fila, structuredClone(data));
      return { count: 1 };
    },
  },
  tableroInteligente: { updateMany: async ({ where }) => (refrescos.push(where.id), { count: 1 }) },
};
const trabajador = cargar("src/features/tableros-inteligentes/services/trabajador.ts", {
  "@/lib/prisma": { prisma: prismaFalso },
  "@prisma/client": { Prisma: {} },
});
const contexto = { workspaceId: "ws1", claveId: "k", nombre: "Coordinador" };
const conTarjeta = (extra = {}) =>
  tarjetasFalsas.set("l1", {
    id: "l1",
    tableroId: "tab1",
    workspaceId: "ws1",
    estado: "EN_CURSO",
    trabajoIniciadoEn: INICIO,
    trabajoVenceEn: mas(33),
    resultado: { rama: "tablero/l1", construccion: { lugar: "orquestador", linkSesion: "https://claude.ai/code/session_abc" } },
    tablero: { nombre: "Sistemas" },
    ...extra,
  });

await prueba("latido con senalEn: guarda resultado.construccion.ultimaSenalEn y conserva lugar, link y lo demás; sin senalEn corre el candado pero no es señal", async () => {
  conTarjeta();
  const ahora = mas(30);
  const sinSenal = await trabajador.accionDelTrabajador(contexto, "l1", "latido", {}, ahora);
  assert.equal(sinSenal.ultimaSenalEn, null);
  assert.equal(tarjetasFalsas.get("l1").trabajoVenceEn.toISOString(), mas(35).toISOString(), "corre el candado");
  assert.equal(tarjetasFalsas.get("l1").resultado.construccion.ultimaSenalEn, undefined, "un latido sin senalEn no cuenta como señal");

  const conSenal = await trabajador.accionDelTrabajador(contexto, "l1", "latido", { senalEn: mas(29).toISOString() }, ahora);
  assert.equal(conSenal.ultimaSenalEn, mas(29).toISOString());
  const { resultado } = tarjetasFalsas.get("l1");
  assert.deepEqual(resultado, {
    rama: "tablero/l1",
    construccion: { lugar: "orquestador", linkSesion: "https://claude.ai/code/session_abc", ultimaSenalEn: mas(29).toISOString() },
  });
  assert.deepEqual(refrescos, [], "la señal no refresca la pantalla");

  // Una futura vale "ahora"; una anterior a la guardada o a cuando se tomó no cambia nada; el lugar nuevo se suma.
  await trabajador.accionDelTrabajador(contexto, "l1", "latido", { senalEn: mas(500).toISOString(), lugar: "nube", sesion: "https://claude.ai/code/session_xyz" }, mas(31));
  assert.deepEqual(tarjetasFalsas.get("l1").resultado.construccion, { lugar: "nube", linkSesion: "https://claude.ai/code/session_xyz", ultimaSenalEn: mas(31).toISOString() });
  await trabajador.accionDelTrabajador(contexto, "l1", "latido", { senalEn: mas(10).toISOString() }, mas(32));
  await trabajador.accionDelTrabajador(contexto, "l1", "latido", { senalEn: mas(-10).toISOString() }, mas(32));
  await trabajador.accionDelTrabajador(contexto, "l1", "latido", { senalEn: "mañana" }, mas(32));
  assert.equal(tarjetasFalsas.get("l1").resultado.construccion.ultimaSenalEn, mas(31).toISOString());
});

await prueba("latido con senalEn en PLANEANDO y SUBIENDO también guarda la señal", async () => {
  for (const estado of ["PLANEANDO", "SUBIENDO"]) {
    conTarjeta({ estado, resultado: null });
    const r = await trabajador.accionDelTrabajador(contexto, "l1", "latido", { senalEn: mas(3).toISOString() }, mas(4));
    assert.equal(r.ultimaSenalEn, mas(3).toISOString(), estado);
    assert.deepEqual(tarjetasFalsas.get("l1").resultado, { construccion: { ultimaSenalEn: mas(3).toISOString() } });
  }
});

console.log(`\n${pruebas} pruebas, todas bien`);
