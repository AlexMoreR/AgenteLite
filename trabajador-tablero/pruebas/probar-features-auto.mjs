// Features se aprueba y sube solo (23-nov-2026): la regla en código, el falso positivo de "gasto en Meta Ads" (T-845 / T-855) y
// que lo demás siga igual. Sin red, sin disco: node trabajador-tablero/pruebas/probar-features-auto.mjs
import assert from "node:assert/strict";

import { FEATURES_TABLERO_ID, aplicaFeaturesAuto, esTarjetaDeFeatures, motivoFrenaEnFeatures, repoParaLaTarjeta } from "../lib/features-auto.mjs";
import { INSTRUCCION_DE_RIESGO, instruccionDeRiesgo, reglasDeZonasQueSubenSolas } from "../lib/etapas.mjs";
import { decidirRescate } from "../lib/rescate-por-revisar.mjs";
import { esperaAlDueno, motivoPorElQueNoSubeSola, planDeclaraGastoEnMetaAds, pruebaExtraDeLasZonas, senalesDeGastoEnMetaAds } from "../lib/zonas.mjs";

let pruebas = 0;
async function prueba(nombre, fn) {
  try {
    await fn();
    pruebas += 1;
    console.log(`ok  ${nombre}`);
  } catch (error) {
    console.error(`FALLA ${nombre}\n${error.stack}`);
    process.exit(1);
  }
}

const repoBase = {
  clave: "aizencrm",
  subirSolo: true,
  zonasQueSubenSolas: ["CHATS"],
  zonasProtegidas: { CHATS: ["src/chats/**"], BOT_VENTAS: ["src/bot/**"], LIBRO_V3: ["src/libro/**"], META_ADS: ["src/meta/**"] },
};
const features = { id: "t1", tableroId: FEATURES_TABLERO_ID };
const otra = { id: "t2", tableroId: "otro" };

await prueba("solo las tarjetas del tablero Features (por id) suben solas en todas las zonas", () => {
  assert.equal(esTarjetaDeFeatures(features), true);
  assert.equal(esTarjetaDeFeatures(otra), false);
  assert.equal(esTarjetaDeFeatures(null), false);
  const repo = repoParaLaTarjeta(repoBase, features, {});
  assert.equal(repo.featuresAuto, true);
  assert.deepEqual([...repo.zonasQueSubenSolas].sort(), ["BOT_VENTAS", "CHATS", "LIBRO_V3", "META_ADS"]);
  assert.equal(repoParaLaTarjeta(repoBase, otra, {}), repoBase, "las demás tarjetas no cambian");
  assert.equal(repoBase.zonasQueSubenSolas.length, 1, "no toca la configuración original");
});

await prueba("el interruptor de emergencia apaga la regla", () => {
  assert.equal(aplicaFeaturesAuto(features, { COORDINADOR_FEATURES_SUBE_SOLO: "0" }), false);
  assert.equal(aplicaFeaturesAuto(features, {}), true);
  assert.equal(repoParaLaTarjeta(repoBase, features, { COORDINADOR_FEATURES_SUBE_SOLO: "0" }), repoBase);
});

await prueba("en Features solo el gasto en Meta Ads frena; la falta de simulación V3 o de la frase no", () => {
  assert.equal(motivoFrenaEnFeatures("gasto en Meta Ads (daily_budget)", esperaAlDueno), true);
  assert.equal(motivoFrenaEnFeatures("falta la simulación V3 (...)", esperaAlDueno), false);
  assert.equal(motivoFrenaEnFeatures("falta la prueba de que los chats no mandan mensajes nuevos", esperaAlDueno), false);
  assert.equal(motivoFrenaEnFeatures("agrega un envío nuevo de mensaje a clientes en chats", esperaAlDueno), false);
  assert.equal(motivoFrenaEnFeatures(null, esperaAlDueno), false);
});

await prueba("falso positivo T-845 / T-855: el plan que MENCIONA la regla no es gasto en Meta Ads", () => {
  const menciones = [
    "GASTO EN META ADS: ninguno",
    "GASTO EN META ADS: no aplica",
    "**GASTO EN META ADS:** este cambio no sube presupuesto ni prende campañas",
    "GASTO EN META ADS (regla del dueño): se mantiene, esperar su sí si se sube presupuesto",
    "GASTO EN META ADS: se mantiene como está",
    "- GASTO EN META ADS — sin gasto",
    "**GASTO EN META ADS**\nninguno",
    "Regla: lo que sube presupuesto de Meta Ads espera el sí.",
    "No se toca nada de GASTO EN META ADS.",
  ];
  for (const plan of menciones) assert.equal(planDeclaraGastoEnMetaAds(plan), false, plan);
  // Lo que sí gasta se sigue declarando.
  for (const plan of ["GASTO EN META ADS: prende la campaña nueva", "**GASTO EN META ADS:** sube el presupuesto diario de 20 a 40 mil", "GASTO EN META ADS: crea 3 anuncios"]) {
    assert.equal(planDeclaraGastoEnMetaAds(plan), true, plan);
  }
  // Con la zona tocada y solo la mención, la tarjeta no queda esperando.
  const motivo = motivoPorElQueNoSubeSola({ zonas: ["META_ADS"], zonasQueSubenSolas: ["META_ADS"], diffs: { todo: "" }, plan: "GASTO EN META ADS: ninguno, solo se nombra la regla", texto: "", confirmaElCoordinador: true });
  assert.equal(motivo, null);
});

await prueba("falso positivo: el código que COMPARA o nombra ACTIVE / activar no es gasto; el que lo hace, sí", () => {
  const diff = (archivo, linea) => `diff --git a/${archivo} b/${archivo}\n--- a/${archivo}\n+++ b/${archivo}\n@@ -1 +1 @@\n+${linea}\n`;
  const noGasta = [
    ["src/meta/guardia.ts", 'if (campana.status === "ACTIVE") return bloquear();'],
    ["src/meta/guardia.ts", 'const activas = lista.filter((c) => c.status !== "ACTIVE");'],
    ["src/meta/guardia.ts", 'if (["ACTIVE"].includes(estado)) avisar();'],
    ["src/meta/guardia.ts", "// regla: no subir daily_budget ni activar campañas"],
    ["src/meta/guardia.ts", 'throw new Error("No se puede activar una campaña sin el sí del dueño");'],
    ["src/meta/guardia.test.ts", "const c = { daily_budget: 5, status: 'ACTIVE' };"],
    ["docs/meta.md", "El daily_budget y status: ACTIVE necesitan sí."],
  ];
  for (const [archivo, linea] of noGasta) assert.deepEqual(senalesDeGastoEnMetaAds(diff(archivo, linea)), [], `${archivo}: ${linea}`);
  const gasta = [
    ["src/meta/api.ts", "const cuerpo = { daily_budget: 5000 };", "daily_budget"],
    ["src/meta/api.ts", 'await fb.update(id, { status: "ACTIVE" });', "pasa algo a ACTIVE"],
    ["src/meta/api.ts", 'await setStatus(id, "ACTIVE");', "pasa algo a ACTIVE"],
    ["src/meta/api.ts", "await activarCampana(id);", "activar"],
    ["src/meta/api.ts", "const nueva = await createCampaign(datos);", "crear campaña, conjunto o anuncio"],
  ];
  for (const [archivo, linea, motivo] of gasta) assert.ok(senalesDeGastoEnMetaAds(diff(archivo, linea)).includes(motivo), `${archivo}: ${linea}`);
});

await prueba("una tarjeta de Features con zonas sin simulación V3 sube sola; con gasto real en Meta Ads, no", async () => {
  const repo = repoParaLaTarjeta(repoBase, features, {});
  const rama = (diffTexto) => ({ archivos: ["src/libro/a.ts"], diffDe: async () => diffTexto });
  const sinSimulacion = await decidirRescate({ ...features, zonaProtegida: ["LIBRO_V3"], plan: "x" }, repo, rama("+export const x = 1;\n"));
  assert.equal(sinSimulacion.accion, "subir");
  // Sin la regla de Features, el libro V3 sin simulación se queda como antes.
  const antes = await decidirRescate({ ...otra, zonaProtegida: ["LIBRO_V3"], plan: "x" }, { ...repoBase, zonasQueSubenSolas: ["LIBRO_V3"] }, rama("+export const x = 1;\n"));
  assert.equal(antes.accion, "saltar");
  const gasto = await decidirRescate(
    { ...features, zonaProtegida: ["META_ADS"], plan: "GASTO EN META ADS: sube el presupuesto" },
    repo,
    { archivos: ["src/meta/a.ts"], diffDe: async () => "+const c = { daily_budget: 9000 };\n" },
  );
  assert.equal(gasto.accion, "esperar");
  assert.match(gasto.motivo, /gasto en Meta Ads/);
  const extra = pruebaExtraDeLasZonas({ zonas: ["META_ADS"], zonasQueSubenSolas: repo.zonasQueSubenSolas, diffs: { todo: "" }, plan: "GASTO EN META ADS: ninguno", texto: "" });
  assert.equal(extra.esperaPor, null);
});

await prueba("los prompts de Features: riesgo ALTO no frena, solo el gasto en Meta Ads; los demás tableros no cambian", () => {
  assert.equal(INSTRUCCION_DE_RIESGO, instruccionDeRiesgo(false));
  assert.match(INSTRUCCION_DE_RIESGO, /toca dinero en Gestión/);
  const f = instruccionDeRiesgo(true);
  assert.match(f, /ESPERA TU SÍ SOLO si el plan sube presupuesto/);
  assert.doesNotMatch(f, /toca dinero en Gestión \(abonos/);
  const reglas = reglasDeZonasQueSubenSolas(repoParaLaTarjeta(repoBase, features, {}));
  assert.match(reglas, /lo único que frena es el gasto en Meta Ads/);
  assert.match(reglasDeZonasQueSubenSolas({ zonasQueSubenSolas: ["CHATS"] }), /no sube sola/);
});

console.log(`\n${pruebas} pruebas de Features sube solo, todas bien`);
