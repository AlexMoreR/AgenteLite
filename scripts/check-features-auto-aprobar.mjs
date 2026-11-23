// Regla Features (23-nov-2026): lo que cuelga del área Features se aprueba, se construye y sube solo en todas las zonas.
// Única excepción: subir presupuesto, prender campañas o crear gasto nuevo en Meta Ads (sigue esperando a Alexander).
// Prueba la parte pura (reglas-features.ts, reglas-trabajador.ts), el SQL real contra PGlite (sin base ni red) y que el servicio la usa.
// Para apagar la regla: FEATURES_AUTO_APROBAR = false en reglas-features.ts (un solo lugar).
// Correr: npm run test:features-auto-aprobar
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { cargar } from "./supervisor-cargar.mjs";

const f = cargar("src/features/tableros-inteligentes/services/reglas-features.ts");
const trabajo = cargar("src/features/tableros-inteligentes/services/reglas-trabajador.ts");
const sql = cargar("src/features/tableros-inteligentes/services/sql-trabajador.ts");

let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const TABLERO = f.TABLERO_DE_FEATURES_ID;
const AREA = f.TARJETA_AREA_FEATURES_ID;

await prueba("el interruptor está prendido y los ids son los de Features (ids, no nombres)", () => {
  assert.equal(f.FEATURES_AUTO_APROBAR, true);
  assert.equal(TABLERO, "cmvg35cqq001i2io6q1hfwvio");
  assert.equal(AREA, "cmwbcu28700b732qmru2nd890");
});

await prueba("esDeFeatures: descendientes a cualquier profundidad; fuera de Features o sin repo no entran", () => {
  const hija = { tableroId: TABLERO, repo: "aizencrm", ancestros: [AREA] };
  assert.equal(f.esDeFeatures(hija), true, "hija directa");
  assert.equal(f.esDeFeatures({ ...hija, ancestros: ["x1", "x2", "x3", "x4", AREA, "raiz"] }), true, "nieta, bisnieta... a cualquier profundidad");
  assert.equal(f.esDeFeatures({ ...hija, ancestros: ["otra", "raiz"] }), false, "cuelga de otra área");
  assert.equal(f.esDeFeatures({ ...hija, ancestros: [] }), false, "sin madre");
  assert.equal(f.esDeFeatures({ ...hija, tableroId: "otroTablero" }), false, "otro tablero aunque el id de la madre coincida");
  assert.equal(f.esDeFeatures({ ...hija, repo: null }), false, "T-266: no es de código (sin repo), queda fuera");
  assert.equal(f.esDeFeatures({ ...hija, repo: "" }), false);
  assert.equal(f.esDeFeatures(hija, false), false, "apagada: nadie entra");
});

/* ── Falso positivo: T-845 / T-855 solo MENCIONAN la regla en su plan ── */
const PLAN_QUE_SOLO_MENCIONA = `1. Qué se cambia
Se ajusta el chequeo de gasto en Meta Ads en reglas-riesgo.ts para que mire lo que la tarjeta hace.
La regla del dueño sigue igual: lo que suba presupuesto, prenda campañas o cree gasto nuevo en Meta Ads sigue esperando el sí de Alexander.
El chequeo no marca un plan solo porque menciona presupuesto o activar campañas en el texto.
GASTO EN META ADS: ninguno (solo se cambia la regla, no se toca Meta).
APROBAR PLAN: SOLO
RIESGO: ALTO — toca el propio trabajador y las reglas de aprobación

FUERA DE ALCANCE:
- No se sube presupuesto ni se activan campañas.

CRITERIOS DE ACEPTACIÓN:
- Un plan que dice "prender campañas" como ejemplo de la regla no queda marcado.

PREGUNTAS ABIERTAS:
- ¿Se debe subir el presupuesto de la prueba?`;

await prueba("T-845 / T-855: un plan que solo MENCIONA la regla de gasto en Meta Ads NO se marca", () => {
  assert.equal(f.gastoDeVerdadEnMetaAds({ plan: PLAN_QUE_SOLO_MENCIONA, titulo: "Ajustar el chequeo de gasto en Meta Ads", detalle: "El chequeo marca por palabras sueltas del plan." }), null);
  // El chequeo viejo SÍ lo marcaba (por eso quedaron frenadas):
  const riesgo = cargar("src/features/tableros-inteligentes/services/reglas-riesgo.ts");
  assert.ok(riesgo.porQueElPlanEsperaTuSi(PLAN_QUE_SOLO_MENCIONA), "el chequeo viejo marcaba este plan (el falso positivo)");
});

await prueba("lo que de verdad sube gasto en Meta Ads SÍ se marca", () => {
  assert.ok(f.gastoDeVerdadEnMetaAds({ plan: "Se sube el presupuesto diario de la campaña de camillas a 200.000." }), "sube presupuesto");
  assert.ok(f.gastoDeVerdadEnMetaAds({ plan: "Al terminar se activan las campañas nuevas de barberías." }), "prende campañas");
  assert.ok(f.gastoDeVerdadEnMetaAds({ plan: "1. Cambios\nGASTO EN META ADS: crea 3 anuncios nuevos con 50.000 diarios\nRIESGO: ALTO" }), "línea declarada");
  assert.ok(f.gastoDeVerdadEnMetaAds({ titulo: "Subir el presupuesto de Meta Ads", detalle: "" }), "en el título");
  assert.ok(f.gastoDeVerdadEnMetaAds({ esperaPor: "va a crear un gasto nuevo en Meta Ads" }), "lo que dice el Coordinador al terminar");
  assert.ok(f.gastoDeVerdadEnMetaAds({ archivos: ["src/features/pauta/servicios/subir-presupuesto-meta.ts"] }), "archivo de pauta que escribe presupuesto");
  assert.ok(f.gastoDeVerdadEnMetaAds({ plan: "Se edita src/features/pauta/servicios/crear-campanas-meta.ts" }), "ruta nombrada en el plan");
  // Una frase que niega no tapa a la que ordena.
  assert.ok(f.gastoDeVerdadEnMetaAds({ plan: "No se toca el bot. Se sube el presupuesto de la campaña principal." }));
});

await prueba("lo que solo LEE de Meta Ads o toca otras zonas NO es gasto", () => {
  assert.equal(f.gastoDeVerdadEnMetaAds({ archivos: ["src/features/pauta/servicios/meta-ads-lectura.ts", "src/features/pauta/servicios/ventas-de-gestion.ts"] }), null, "lectura");
  assert.equal(f.gastoDeVerdadEnMetaAds({ plan: "Se arregla el cálculo de saldos de Gestión y el libro V3.", titulo: "Corregir abonos" }), null, "dinero de Gestión no es Meta");
  assert.equal(f.gastoDeVerdadEnMetaAds({ plan: "GASTO EN META ADS: no", archivos: ["src/features/chats/bandeja.ts"] }), null);
  assert.equal(f.gastoDeVerdadEnMetaAds({ plan: "Mostrar el gasto en Meta Ads de ayer en el panel (solo lectura)." }), null, "mostrar el gasto no es crear gasto");
});

await prueba("las 8 tarjetas que deben quedar elegibles: planes típicos que mencionan la regla pasan", () => {
  for (const [codigo, plan] of [
    ["T-845", PLAN_QUE_SOLO_MENCIONA],
    ["T-855", PLAN_QUE_SOLO_MENCIONA.replace("ninguno", "no")],
    ["T-783", "Arreglar el chequeo de aprobaciones. La excepción de gasto en Meta Ads se mantiene como hoy: espera el sí de Alexander."],
    ["T-846", "Cambios en el libro V3 y el bot de ventas. Nunca se prende ni se crea gasto en Meta Ads desde este cambio."],
    ["T-849", "Ajuste de comisiones de Gestión (dinero). GASTO EN META ADS: ninguno."],
    ["T-180", "Chats: mejorar la bandeja. Sin tocar presupuesto ni campañas."],
    ["T-779", "Subir solo si pasan las pruebas; si el gasto en Meta Ads aparece, la regla pide el sí."],
    ["T-780", "Features: texto del plan. No se sube presupuesto."],
  ]) {
    assert.equal(f.gastoDeVerdadEnMetaAds({ plan, titulo: codigo }), null, codigo);
  }
});

await prueba("destinoDelResultado con features: sube sola en todas las zonas; solo gasto en Meta y migración destructiva esperan", () => {
  const base = { paso: true, subeSolo: false, features: true };
  for (const zonas of [[], ["CHATS"], ["BOT_VENTAS"], ["LIBRO_V3"], ["META_ADS"], ["META_ADS", "LIBRO_V3", "CHATS"]]) {
    assert.equal(trabajo.destinoDelResultado({ ...base, zonaProtegida: zonas }), "SUBIENDO", `zonas ${zonas}`);
  }
  assert.equal(
    trabajo.destinoDelResultado({ ...base, zonaProtegida: ["LIBRO_V3"], esperaPor: "toca dinero de Gestión, sin sí humano a la tarea" }),
    "SUBIENDO",
    "el motivo de dinero del Coordinador ya no frena en Features",
  );
  assert.equal(trabajo.destinoDelResultado({ ...base, zonaProtegida: ["META_ADS"], gastoEnMetaAds: "sube presupuesto" }), "POR_REVISAR", "gasto de verdad en Meta: espera a Alexander");
  assert.equal(trabajo.destinoDelResultado({ ...base, zonaProtegida: [], migracionDestructiva: ["DROP TABLE x"] }), "POR_REVISAR", "migración destructiva: no sube sola");
  assert.equal(trabajo.destinoDelResultado({ ...base, zonaProtegida: ["CHATS"], esperaPor: "envío nuevo de mensajes a clientes" }), "ERROR", "prueba de zona que falló: ERROR con motivo, no espera un sí");
  assert.equal(trabajo.destinoDelResultado({ ...base, paso: false, zonaProtegida: [] }), "POR_REVISAR", "si no pasó las pruebas, no sube");
});

await prueba("destinoDelResultado SIN features: todo como hoy", () => {
  const d = (x) => trabajo.destinoDelResultado({ paso: true, subeSolo: true, zonaProtegida: [], ...x });
  assert.equal(d({}), "SUBIENDO");
  assert.equal(d({ subeSolo: false }), "POR_REVISAR");
  assert.equal(d({ subeSolo: false, zonaProtegida: ["CHATS"] }), "ERROR");
  assert.equal(d({ esperaPor: "gasto en Meta Ads" }), "POR_REVISAR");
  assert.equal(d({ esperaPor: "dinero de Gestión", tareaAprobadaPorElDueno: false }), "POR_REVISAR");
  assert.equal(d({ features: false, subeSolo: false }), "POR_REVISAR");
});

await prueba("registroDeAprobacionFeatures: vía automática y como/regla 'regla-features'", () => {
  const r = f.registroDeAprobacionFeatures({ estado: "APROBADO", momento: "tarea", motivo: "x" });
  assert.equal(r.via, "automatica");
  assert.equal(r.como, "regla-features");
  assert.equal(r.regla, "regla-features");
  assert.equal(r.automatica, true);
  assert.equal(r.estado, "APROBADO");
  // No cuenta como un sí humano (aprobacionDelDueno/tareaAprobada piden vía pantalla o voz).
  assert.equal(trabajo.tareaAprobadaPorElDuenoEnElHistorial([{ accion: "aprobar", despues: r }]), false);
});

await prueba("decisionDelCoordinador: deja escrita la opción recomendada cuando hay preguntas abiertas, NECESITO o riesgo ALTO", () => {
  const d = f.decisionDelCoordinador(PLAN_QUE_SOLO_MENCIONA, "ALTO");
  assert.match(d, /DECISIÓN DEL COORDINADOR/);
  assert.match(d, /opción recomendada/);
  assert.match(d, /riesgo ALTO/);
  assert.match(d, /subir el presupuesto de la prueba/);
  assert.match(f.decisionDelCoordinador("hola\nNECESITO: el número de la cuenta\nRIESGO: BAJO", "BAJO"), /NECESITO/);
  assert.equal(f.decisionDelCoordinador("Plan simple\nRIESGO: BAJO\nPREGUNTAS ABIERTAS: ninguna", "BAJO"), null);
  // La nota que se escribe en el plan no vuelve a marcar gasto.
  assert.equal(f.gastoDeVerdadEnMetaAds({ plan: `${PLAN_QUE_SOLO_MENCIONA}\n\n${d}` }), null);
});

await prueba("laAprobacionDejaArrancar: la vía de la regla arranca en todas las zonas; automática común sigue como antes", () => {
  for (const zonas of [["CHATS"], ["BOT_VENTAS"], ["LIBRO_V3"], ["META_ADS"], ["META_ADS", "LIBRO_V3"]]) {
    assert.equal(trabajo.laAprobacionDejaArrancar(zonas, f.VIA_REGLA_FEATURES), true, `features ${zonas}`);
  }
  assert.equal(trabajo.laAprobacionDejaArrancar(["LIBRO_V3"], "automatica"), false, "automática común: LIBRO_V3 sigue sin arrancar");
  assert.equal(trabajo.laAprobacionDejaArrancar(["META_ADS"], "automatica"), false);
  assert.equal(trabajo.laAprobacionDejaArrancar(["CHATS"], "automatica"), true);
  assert.equal(trabajo.laAprobacionDejaArrancar(["META_ADS"], "voz"), false);
});

/* ── Historial de prueba (herencia de la madre) ── */
const T = (n) => new Date(Date.UTC(2026, 10, 23, 0, n));
const hist = {
  feat: [{ despues: { estado: "PLAN_APROBADO", momento: "plan", via: "automatica", como: "regla-features", regla: "regla-features" }, creadoEn: T(1) }],
  featDeshecha: [{ despues: { via: "automatica", como: "regla-features", regla: "regla-features" }, creadoEn: T(1), deshechoEn: T(2) }],
  autoComun: [{ despues: { via: "automatica", como: "aprobado automáticamente por regla de bajo riesgo" }, creadoEn: T(1) }],
  autoDueno: [{ despues: { via: "automatica", regla: "dueno-24-oct" }, creadoEn: T(1) }],
  hijaDeFeat: [{ despues: { estado: "APROBADO", momento: "tarea", como: "heredada", heredadaDe: "feat", via: "automatica" }, creadoEn: T(3) }],
  nietaDeFeat: [{ despues: { como: "heredada", heredadaDe: "hijaDeFeat", via: "automatica" }, creadoEn: T(4) }],
  luegoPantalla: [
    { despues: { via: "automatica", como: "regla-features", regla: "regla-features" }, creadoEn: T(1) },
    { despues: { via: "pantalla", momento: "plan" }, creadoEn: T(5) },
  ],
  hijaDeComun: [{ despues: { como: "heredada", heredadaDe: "autoComun", via: "automatica" }, creadoEn: T(3) }],
  sinAprobacion: [],
};
const ultima = (id) => (hist[id] ?? []).filter((x) => !x.deshechoEn).sort((a, b) => b.creadoEn - a.creadoEn)[0]?.despues ?? null;
const lector = async (id) => ultima(id);

await prueba("esReglaFeaturesConHerencia (TS): la última aprobación vigente (o la de su madre) es de la regla", async () => {
  assert.equal(await trabajo.esReglaFeaturesConHerencia("feat", lector), true);
  assert.equal(await trabajo.esReglaFeaturesConHerencia("hijaDeFeat", lector), true, "heredada de una de la regla");
  assert.equal(await trabajo.esReglaFeaturesConHerencia("nietaDeFeat", lector), true, "dos niveles");
  assert.equal(await trabajo.esReglaFeaturesConHerencia("featDeshecha", lector), false, "se deshizo");
  assert.equal(await trabajo.esReglaFeaturesConHerencia("autoComun", lector), false);
  assert.equal(await trabajo.esReglaFeaturesConHerencia("autoDueno", lector), false);
  assert.equal(await trabajo.esReglaFeaturesConHerencia("hijaDeComun", lector), false);
  assert.equal(await trabajo.esReglaFeaturesConHerencia("luegoPantalla", lector), false, "una aprobación humana posterior manda");
  assert.equal(await trabajo.esReglaFeaturesConHerencia("sinAprobacion", lector), false);
});

await prueba("SQL real (PGlite): CONDICION_DE_LA_VIA deja arrancar la regla en TODAS las zonas y nada más cambia", async () => {
  const db = new PGlite();
  await db.exec(`
    CREATE TABLE "TarjetaTablero" ("id" text, "zonaProtegida" text[] NOT NULL);
    CREATE TABLE "HistorialTarjeta" ("id" serial PRIMARY KEY, "tarjetaId" text, "accion" text, "despues" jsonb, "creadoEn" timestamp, "deshechoEn" timestamp);
  `);
  const zonasDePrueba = [[], ["CHATS"], ["BOT_VENTAS"], ["LIBRO_V3"], ["META_ADS"], ["CHATS", "META_ADS"], ["LIBRO_V3", "META_ADS", "CHATS", "BOT_VENTAS"]];
  for (const [id, filas] of Object.entries(hist)) {
    for (const zonas of zonasDePrueba) await db.query(`INSERT INTO "TarjetaTablero" VALUES ($1, $2)`, [id, zonas]);
    for (const fila of filas) {
      await db.query(
        `INSERT INTO "HistorialTarjeta" ("tarjetaId","accion","despues","creadoEn","deshechoEn") VALUES ($1,'aprobar',$2,$3,$4)`,
        [id, JSON.stringify(fila.despues), fila.creadoEn, fila.deshechoEn ?? null],
      );
    }
  }
  const { rows } = await db.query(`SELECT c."id", c."zonaProtegida", ${sql.CONDICION_DE_LA_VIA} AS "deja" FROM "TarjetaTablero" c`);
  for (const fila of rows) {
    const via = await trabajo.viaConHerencia(fila.id, lector);
    const esFeatures = via === "automatica" && (await trabajo.esReglaFeaturesConHerencia(fila.id, lector));
    const esperado = trabajo.laAprobacionDejaArrancar(fila.zonaProtegida, esFeatures ? f.VIA_REGLA_FEATURES : via);
    assert.equal(fila.deja, esperado, `${fila.id} ${JSON.stringify(fila.zonaProtegida)} via=${via} features=${esFeatures}`);
  }
  const deja = (id, zonas) => rows.find((x) => x.id === id && JSON.stringify(x.zonaProtegida) === JSON.stringify(zonas)).deja;
  for (const zonas of zonasDePrueba) {
    assert.equal(deja("feat", zonas), true, `feat ${zonas}`);
    assert.equal(deja("hijaDeFeat", zonas), true, `hija heredada ${zonas}`);
  }
  assert.equal(deja("autoComun", ["LIBRO_V3"]), false, "automática común: LIBRO_V3 sigue sin arrancar");
  assert.equal(deja("autoComun", ["META_ADS"]), false);
  assert.equal(deja("autoDueno", ["META_ADS"]), false);
  assert.equal(deja("hijaDeComun", ["META_ADS"]), false);
  assert.equal(deja("featDeshecha", ["META_ADS"]), false);
  assert.equal(deja("sinAprobacion", ["LIBRO_V3"]), false);
  assert.equal(deja("sinAprobacion", []), true, "sin zona siempre");
  await db.close();
});

await prueba("SQL_ANCESTROS (PGlite): sube por padreId a cualquier profundidad (la base del 'cuelga de Features')", async () => {
  const db = new PGlite();
  await db.exec(`CREATE TABLE "TarjetaTablero" ("id" text PRIMARY KEY, "padreId" text, "borradoEn" timestamp);`);
  const filas = [["raiz", null], [AREA, "raiz"], ["h1", AREA], ["h2", "h1"], ["h3", "h2"], ["suelta", null], ["otra", "suelta"]];
  for (const [id, padre] of filas) await db.query(`INSERT INTO "TarjetaTablero" VALUES ($1,$2,NULL)`, [id, padre]);
  const { rows } = await db.query(sql.SQL_ANCESTROS, [["h3", "otra", "suelta"]]);
  const de = (id) => rows.find((x) => x.id === id)?.ancestros ?? [];
  assert.equal(f.esDeFeatures({ tableroId: TABLERO, repo: "gestion", ancestros: de("h3") }), true, "bisnieta");
  assert.equal(f.esDeFeatures({ tableroId: TABLERO, repo: "gestion", ancestros: de("otra") }), false, "otra rama");
  assert.equal(f.esDeFeatures({ tableroId: TABLERO, repo: "gestion", ancestros: de("suelta") }), false, "sin madre (como T-266)");
  await db.close();
});

await prueba("el servicio usa la regla: tarea, plan, resultado, /tomar y el barrido; todo detrás de un solo interruptor", () => {
  const dir = "src/features/tableros-inteligentes/services/";
  const auto = readFileSync(`${dir}aprobacion-automatica.ts`, "utf8");
  const trab = readFileSync(`${dir}trabajador.ts`, "utf8");
  const reglas = readFileSync(`${dir}reglas-features.ts`, "utf8");
  assert.match(reglas, /export const FEATURES_AUTO_APROBAR = true;/);
  // Tarea: aprobarSolaLaTarea
  assert.match(auto, /const deFeatures = await tarjetaEsDeFeatures\(prisma, tarjeta\);/);
  assert.match(auto, /registroDeAprobacionFeatures\(\{ estado: "APROBADO", momento: "tarea"/);
  // Barrido del reloj (PLAN_LISTO que esperaban)
  assert.match(auto, /registroDeAprobacionFeatures\(\{ estado: "PLAN_APROBADO", momento: "plan"/);
  // Plan nuevo, resultado y /tomar
  assert.match(trab, /const deFeatures = await tarjetaEsDeFeatures\(prisma, actual\);/);
  assert.match(trab, /features: deFeatures,\s*gastoEnMetaAds,/);
  assert.match(trab, /planAprobadoPorElDueno: intentos\.planAprobadoPorElDueno \|\| features/);
  assert.match(trab, /gastoEnMetaAds: features \? gastoDeVerdadEnMetaAds/);
  // Las rutas de "sí final" no se tocan para las demás tarjetas.
  assert.match(trab, /zonasQuePidenTuSi\(actual\.zonaProtegida\)/);
});

console.log(`\n${pruebas} pruebas, todas bien`);
