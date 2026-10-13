/**
 * El acuse de chat pausado ("En un momento una de nuestras asesoras te contacta") sale UNA vez por pausa.
 *
 * Corre la secuencia real (src/features/agente-v3/motor/aviso-pausa.ts) y su SQL contra un Postgres
 * embebido (PGlite), sin tocar ninguna base real:
 *   node scripts/check-aviso-pausa.mjs
 *
 * Falla real que cubre: 13-10-2026 10:36, dos mensajes de la clienta con 2 s de diferencia -> dos acuses.
 */
import { PGlite } from "@electric-sql/pglite";

import {
  enviarAvisoDePausaUnaVez,
  FUENTES_DE_ASESORA,
  sqlLiberarAvisoDePausa,
  sqlReclamarAvisoDePausa,
} from "../src/features/agente-v3/motor/aviso-pausa.ts";

const db = new PGlite();
await db.exec(`
  CREATE TABLE "AppSetting" (
    "key" text PRIMARY KEY,
    "value" text NOT NULL,
    "createdAt" timestamp(3) NOT NULL DEFAULT now(),
    "updatedAt" timestamp(3) NOT NULL
  );
  CREATE TABLE "Message" (
    "id" text PRIMARY KEY,
    "conversationId" text NOT NULL,
    "direction" text NOT NULL,
    "type" text NOT NULL,
    "rawPayload" jsonb,
    "createdAt" timestamp(3) NOT NULL
  );
`);

const correr = async (sql) => (await db.query(sql.text, sql.values)).rows;
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const clave = (c) => `agente-v3:estado:${c}`;
const estadoBase = (aviso) =>
  JSON.stringify({
    productoActivo: "p1",
    pasoActual: "PRESENTACION",
    flujosEnviados: ["f1"],
    esPrimerMensaje: false,
    seguimientosEnviados: [],
    avisoDePausaEnviado: aviso,
  });
async function leerFila(conversationId) {
  const filas = await correr({ text: `SELECT "value" FROM "AppSetting" WHERE "key" = $1`, values: [clave(conversationId)] });
  return filas[0] ? JSON.parse(filas[0].value) : null;
}

/** Una llegada de webhook, con las mismas consultas que hace route.ts. */
function llegada(conversationId, envios, { fallaEnvio = false, pausaLectura = 0 } = {}) {
  let valorSiNoHayFila = "";
  return enviarAvisoDePausaUnaVez({
    personaAtendiendo: async () => {
      const filas = await correr({
        text: `SELECT count(*)::int AS n FROM "Message" WHERE "conversationId" = $1 AND "direction" = 'OUTBOUND'
               AND ("rawPayload"->>'source') = ANY($2) AND "createdAt" > now() - interval '6 hours'`,
        values: [conversationId, [...FUENTES_DE_ASESORA]],
      });
      return filas[0].n > 0;
    },
    respuestaReciente: async () => {
      const filas = await correr({
        text: `SELECT count(*)::int AS n FROM "Message" WHERE "conversationId" = $1 AND "direction" = 'OUTBOUND'
               AND "type" <> 'SYSTEM' AND "createdAt" > now() - interval '3 minutes'`,
        values: [conversationId],
      });
      return filas[0].n > 0;
    },
    avisoYaEnviado: async () => {
      const fila = await leerFila(conversationId);
      valorSiNoHayFila = estadoBase(true);
      // Las dos llegadas leen ANTES de que cualquiera reclame: es exactamente la carrera del 13-oct.
      await esperar(pausaLectura);
      return fila?.avisoDePausaEnviado === true;
    },
    reclamar: async () => {
      const filas = await correr(sqlReclamarAvisoDePausa(clave(conversationId), valorSiNoHayFila));
      return filas[0] ? { insertado: filas[0].insertado === true } : null;
    },
    liberar: async (reclamo) => {
      await correr(sqlLiberarAvisoDePausa(clave(conversationId), { ...reclamo, valor: valorSiNoHayFila }));
    },
    enviar: async () => {
      await esperar(5);
      if (fallaEnvio) return false;
      envios.push(conversationId);
      return true;
    },
  });
}

let fallas = 0;
function verificar(nombre, ok, detalle = "") {
  console.log(`${ok ? "OK  " : "FALLA"} ${nombre}${detalle ? ` (${detalle})` : ""}`);
  if (!ok) fallas += 1;
}

// 1. Dos llegadas concurrentes, chat con estado previo (flag en false) -> 1 envio.
{
  const c = "conc-con-fila";
  await correr({ text: `INSERT INTO "AppSetting" VALUES ($1, $2, now(), now())`, values: [clave(c), estadoBase(false)] });
  const envios = [];
  const r = await Promise.all([llegada(c, envios, { pausaLectura: 20 }), llegada(c, envios, { pausaLectura: 20 })]);
  const fila = await leerFila(c);
  verificar("concurrentes con estado previo -> 1 envio", envios.length === 1, `envios=${envios.length} ${r.join(",")}`);
  verificar("  el resto del estado queda intacto", fila.productoActivo === "p1" && fila.flujosEnviados[0] === "f1" && fila.avisoDePausaEnviado === true);
}

// 1b. Cinco llegadas concurrentes, chat SIN estado previo -> 1 envio.
{
  const c = "conc-sin-fila";
  const envios = [];
  await Promise.all(Array.from({ length: 5 }, () => llegada(c, envios, { pausaLectura: 20 })));
  verificar("5 concurrentes sin estado previo -> 1 envio", envios.length === 1, `envios=${envios.length}`);
  verificar("  la marca quedo guardada", (await leerFila(c))?.avisoDePausaEnviado === true);
}

// 2. La asesora escribio desde el celular hace 1 h -> 0 envios.
{
  const c = "asesora-celular";
  await correr({
    text: `INSERT INTO "Message" VALUES ('m1', $1, 'OUTBOUND', 'TEXT', '{"source":"instance"}', now() - interval '1 hour')`,
    values: [c],
  });
  const envios = [];
  const r = await llegada(c, envios);
  verificar("asesora escribio desde el celular hace 1 h -> 0 envios", envios.length === 0 && r === "persona_atendiendo", r);
}

// 2b. Un eco de envio nuestro (source api) hace 1 h NO cuenta como persona -> 1 envio.
{
  const c = "eco-api";
  await correr({
    text: `INSERT INTO "Message" VALUES ('m2', $1, 'OUTBOUND', 'TEXT', '{"source":"api"}', now() - interval '1 hour')`,
    values: [c],
  });
  const envios = [];
  await llegada(c, envios);
  verificar("eco de la API hace 1 h no frena el acuse -> 1 envio", envios.length === 1);
}

// 3. Caso normal: una llegada -> 1 envio; una segunda llegada despues -> nada.
{
  const c = "normal";
  const envios = [];
  const r1 = await llegada(c, envios);
  const r2 = await llegada(c, envios);
  verificar("caso normal -> 1 envio", envios.length === 1 && r1 === "enviado" && r2 === "ya_enviado", `${r1},${r2}`);
}

// 4. Fallo de envio -> marca liberada; el siguiente mensaje lo vuelve a intentar.
{
  const c = "falla-sin-fila";
  const envios = [];
  const r = await llegada(c, envios, { fallaEnvio: true });
  verificar("fallo de envio sin estado previo -> fila retirada", r === "fallo_envio" && (await leerFila(c)) === null, r);
  await llegada(c, envios);
  verificar("  el siguiente mensaje si envia", envios.length === 1);

  const c2 = "falla-con-fila";
  await correr({ text: `INSERT INTO "AppSetting" VALUES ($1, $2, now(), now())`, values: [clave(c2), estadoBase(false)] });
  const envios2 = [];
  await llegada(c2, envios2, { fallaEnvio: true });
  const fila = await leerFila(c2);
  verificar("fallo de envio con estado previo -> marca en false", fila?.avisoDePausaEnviado === false && fila.productoActivo === "p1");
  await llegada(c2, envios2);
  verificar("  el siguiente mensaje si envia", envios2.length === 1);
}

if (fallas > 0) {
  console.error(`\n${fallas} verificacion(es) fallaron.`);
  process.exit(1);
}
console.log("\nTodo bien: el acuse sale una sola vez por pausa.");
