// Pruebas de las TARJETAS REPETIDAS antes de planear (27-nov-2026, parte 2 de «Coordinador: detectar tarjetas repetidas antes de
// planear»): la comparación (compararTarjetas), la decisión (decidirRepetida, con un git de prueba donde un commit está en main y
// otro no), la revisión con un CRM falso (revisarRepetidas) y la recogida de errores, que salta las posibles repetidas.
//   node trabajador-tablero/pruebas/probar-repetidas.mjs   (también corre dentro de npm run test:trabajador-tablero)
// Sin red, sin CRM y sin Claude: el git es un repo con su "origin" en una carpeta temporal.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { completarConfig } from "../lib/config.mjs";
import { decidirRecogida } from "../lib/recoger-errores.mjs";
import { compararTarjetas, decidirRepetida, normalizarTitulo, revisarRepetidas } from "../lib/repetidas.mjs";

let pruebas = 0;
let fallas = 0;
async function prueba(nombre, fn) {
  try {
    await fn();
    pruebas += 1;
    console.log(`ok - ${nombre}`);
  } catch (error) {
    fallas += 1;
    console.log(`FALLÓ - ${nombre}\n${error?.stack ?? error}`);
  }
}

const T = fs.mkdtempSync(path.join(os.tmpdir(), "repetidas-"));
const REMOTO = path.join(T, "remoto.git");
const RUTA = path.join(T, "repo");
const g = (...args) =>
  execFileSync("git", ["-c", "user.name=Prueba", "-c", "user.email=prueba@x.co", ...args], { cwd: RUTA, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

/* ── el git de prueba: un commit en main (EN_MAIN) y otro solo en una rama (FUERA) ── */
fs.mkdirSync(RUTA);
execFileSync("git", ["init", "--bare", "-b", "main", REMOTO], { stdio: "ignore" });
g("init", "-b", "main");
fs.writeFileSync(path.join(RUTA, "a.txt"), "base\n");
g("add", "-A");
g("commit", "-m", "base");
g("remote", "add", "origin", REMOTO);
fs.writeFileSync(path.join(RUTA, "a.txt"), "lo de la tarjeta\n");
g("commit", "-am", "tablero: panel de cuentas");
const EN_MAIN = g("rev-parse", "HEAD");
g("push", "-q", "-u", "origin", "main");
g("checkout", "-q", "-b", "otra-rama");
fs.writeFileSync(path.join(RUTA, "b.txt"), "sin subir\n");
g("add", "-A");
g("commit", "-m", "lo que nunca subió");
const FUERA = g("rev-parse", "HEAD");
g("checkout", "-q", "main");
g("fetch", "-q", "origin");
const repo = { ruta: RUTA, remoto: "origin", ramaBase: "main" };
const datosDeConfig = (extra = {}) => ({
  urlCrm: "https://crm.ejemplo.com",
  claveTrabajador: "aizen_trab_x",
  carpetaTrabajo: path.join(T, "trabajo"),
  nube: { activa: false },
  repos: { aizencrm: { ruta: RUTA, subirSolo: false, ramaBase: "main", remoto: "origin" } },
  ...extra,
});
const config = completarConfig(datosDeConfig(), T);

const tarjeta = (numero, titulo, estado = "PLANEANDO", extra = {}) => ({ id: `t${numero}`, numero, codigo: `T-${numero}`, titulo, detalle: "", estado, plan: null, commit: null, ...extra });
const NUEVA = tarjeta(50, "Panel de cuentas: mostrar los últimos siete días en la tabla");

await prueba("config: el bloque repetidas trae sus valores por defecto y se puede sobrescribir", () => {
  assert.deepEqual(config.repetidas, { igualPalabras: 0.8, igualConArchivo: 0.5, posibleSinArchivo: 0.5, posibleConArchivo: 0.3, dias: 30 });
  const cambiada = completarConfig(datosDeConfig({ repetidas: { igualPalabras: 0.9 } }), T);
  assert.equal(cambiada.repetidas.igualPalabras, 0.9);
  assert.equal(cambiada.repetidas.dias, 30);
  assert.throws(() => completarConfig(datosDeConfig({ repetidas: { posibleConArchivo: 3 } }), T), /repetidas\.posibleConArchivo/);
});

await prueba("normalizarTitulo: sin tildes, sin signos y sin los prefijos Parte N y T-123", () => {
  assert.equal(normalizarTitulo("T-123 Parte 2: Panel de Cuentas — ¡ÚLTIMOS 7 días!"), "panel de cuentas ultimos 7 dias");
  assert.equal(normalizarTitulo("Panel de cuentas, últimos 7 días"), normalizarTitulo("parte 1 de 3: panel de cuentas: ultimos 7 dias"));
});

await prueba("compararTarjetas: igual, posible y distinta con casos claros", () => {
  // El mismo título con otros signos y prefijos.
  assert.equal(compararTarjetas({ titulo: "T-12 Panel de cuentas: últimos 7 días" }, { titulo: "panel de cuentas, ultimos 7 dias" }).nivel, "igual");
  // 80 % o más de las palabras en las dos direcciones (5 de 5 y 5 de 6).
  const casi = compararTarjetas(NUEVA, tarjeta(1, "Panel de cuentas: mostrar últimos siete días tabla resumida"));
  assert.equal(casi.nivel, "igual", casi.porque);
  // 50 % y un archivo en común (en el detalle de una y en el plan de la otra).
  const conArchivo = compararTarjetas(
    { titulo: "Panel cuentas lento móvil", detalle: "Tocar src/features/cuentas/panel.tsx" },
    { titulo: "Panel cuentas rápido escritorio", plan: "## 5. Archivos\n- src/features/cuentas/panel.tsx" },
  );
  assert.equal(conArchivo.nivel, "igual", conArchivo.porque);
  assert.match(conArchivo.porque, /src\/features\/cuentas\/panel\.tsx/);
  // 50 % sin archivo en común: posible.
  assert.equal(compararTarjetas({ titulo: "Panel cuentas lento móvil" }, { titulo: "Panel cuentas rápido escritorio" }).nivel, "posible");
  // 30 % con un archivo en común: posible (2 de 6).
  const pocas = compararTarjetas(
    { titulo: "Exportar ventas mensuales Excel desde panel cuentas", detalle: "src/features/cuentas/panel.tsx" },
    { titulo: "Colores nuevos panel cuentas botones grandes", detalle: "src/features/cuentas/panel.tsx" },
  );
  assert.equal(pocas.nivel, "posible", pocas.porque);
  // El mismo 30 % sin archivo: distinta. Y nada en común: distinta.
  assert.equal(compararTarjetas({ titulo: "Exportar ventas mensuales Excel desde panel cuentas" }, { titulo: "Colores nuevos panel cuentas botones grandes" }).nivel, "distinta");
  assert.equal(compararTarjetas({ titulo: "Recordatorio de pagos por WhatsApp" }, { titulo: "Panel de cuentas últimos días" }).nivel, "distinta");
  // El manual y las notas de cambios pendientes no cuentan como archivo en común.
  assert.equal(
    compararTarjetas(
      { titulo: "Exportar ventas mensuales Excel desde panel cuentas", detalle: "docs/que-es-esta-aplicacion.md" },
      { titulo: "Colores nuevos panel cuentas botones grandes", detalle: "docs/que-es-esta-aplicacion.md" },
    ).nivel,
    "distinta",
  );
});

await prueba("decidirRepetida: ya-hecha si la otra está HECHO, es igual y su commit está en main", async () => {
  const hecha = tarjeta(12, "Panel de cuentas: mostrar los últimos siete días en la tabla", "HECHO", { commit: EN_MAIN });
  const decision = await decidirRepetida({ tarjeta: NUEVA, parecidas: { tarjetas: [hecha], repetidasRevisadas: [] }, repo, config });
  assert.equal(decision.accion, "ya-hecha");
  assert.equal(decision.otra.id, "t12");
  assert.equal(decision.commit, EN_MAIN);
  assert.equal(decision.linea, `Ya lo hizo T-12 (commit ${EN_MAIN.slice(0, 7)})`);
});

await prueba("decidirRepetida: un HECHO cuyo commit no está en main no cuenta", async () => {
  const hecha = tarjeta(12, "Panel de cuentas: mostrar los últimos siete días en la tabla", "HECHO", { commit: FUERA });
  const decision = await decidirRepetida({ tarjeta: NUEVA, parecidas: { tarjetas: [hecha] }, repo, config });
  assert.equal(decision.accion, "seguir");
  const inventado = await decidirRepetida({ tarjeta: NUEVA, parecidas: { tarjetas: [{ ...hecha, commit: "zzz" }] }, repo, config });
  assert.equal(inventado.accion, "seguir");
});

await prueba("decidirRepetida: dos pendientes iguales -> repetida de la más vieja; si la otra es la nueva, seguir", async () => {
  const vieja = tarjeta(30, "Panel de cuentas: mostrar los últimos siete días en la tabla", "APROBADO", { detalle: "lo de la vieja" });
  const conDetalle = { ...NUEVA, detalle: "Mostrar también el total de la semana." };
  const decision = await decidirRepetida({ tarjeta: conDetalle, parecidas: [vieja], repo, config });
  assert.equal(decision.accion, "repetida");
  assert.equal(decision.linea, "Repetida de T-30");
  assert.equal(decision.otra.id, "t30");
  assert.equal(decision.detalleParaLaOtra, "Mostrar también el total de la semana.");
  // Con dos más viejas, gana la de número menor.
  const otraVieja = tarjeta(20, "Panel de cuentas, mostrar los últimos siete días en la tabla", "PLAN_LISTO");
  assert.equal((await decidirRepetida({ tarjeta: NUEVA, parecidas: [vieja, otraVieja], repo, config })).otra.id, "t20");
  const nueva = tarjeta(70, "Panel de cuentas: mostrar los últimos siete días en la tabla", "POR_APROBAR");
  const seguir = await decidirRepetida({ tarjeta: NUEVA, parecidas: [nueva], repo, config });
  assert.equal(seguir.accion, "seguir");
  assert.equal(seguir.otra.id, "t70");
  // Sin el número de esta no se sabe cuál es la nueva: no se cierra sola.
  const sinNumero = await decidirRepetida({ tarjeta: { ...NUEVA, numero: undefined, codigo: undefined }, parecidas: [vieja], repo, config });
  assert.equal(sinNumero.accion, "posible");
});

await prueba("decidirRepetida: esperar si la otra igual está EN_CURSO o subiendo", async () => {
  for (const estado of ["EN_CURSO", "SUBIENDO"]) {
    const enMarcha = tarjeta(40, "Panel de cuentas: mostrar los últimos siete días en la tabla", estado);
    const decision = await decidirRepetida({ tarjeta: NUEVA, parecidas: [enMarcha], repo, config });
    assert.equal(decision.accion, "esperar", estado);
    assert.equal(decision.otra.id, "t40");
  }
});

await prueba("decidirRepetida: posible con un parecido posible o con un igual en ERROR o FALLIDO", async () => {
  const parecida = tarjeta(8, "Panel de cuentas mostrar días semana anterior gráfico", "HECHO", { commit: EN_MAIN });
  const decision = await decidirRepetida({ tarjeta: NUEVA, parecidas: [parecida], repo, config });
  assert.equal(decision.accion, "posible");
  assert.match(decision.linea, /^Posible repetida de T-8: comparten \d+ % de las palabras del título/);
  for (const estado of ["ERROR", "FALLIDO"]) {
    const mal = tarjeta(9, "Panel de cuentas: mostrar los últimos siete días en la tabla", estado);
    const conMal = await decidirRepetida({ tarjeta: NUEVA, parecidas: [mal], repo, config });
    assert.equal(conMal.accion, "posible", estado);
    assert.match(conMal.linea, new RegExp(`^Posible repetida de T-9: .*quedó en ${estado}`));
  }
});

await prueba("decidirRepetida: salta las parejas de repetidasRevisadas y las distintas", async () => {
  const vieja = tarjeta(30, "Panel de cuentas: mostrar los últimos siete días en la tabla", "APROBADO");
  assert.equal((await decidirRepetida({ tarjeta: NUEVA, parecidas: { tarjetas: [vieja], repetidasRevisadas: [30] }, repo, config })).accion, "seguir");
  assert.equal((await decidirRepetida({ tarjeta: { ...NUEVA, resultado: { repetidasRevisadas: [30] } }, parecidas: [vieja], repo, config })).accion, "seguir");
  assert.equal((await decidirRepetida({ tarjeta: NUEVA, parecidas: [tarjeta(31, "Recordatorio de pagos por WhatsApp")], repo, config })).accion, "seguir");
  assert.equal((await decidirRepetida({ tarjeta: NUEVA, parecidas: { tarjetas: [] }, repo, config })).accion, "seguir");
});

/** Un CRM falso que guarda las llamadas. */
function crmFalso(respuesta) {
  const llamadas = [];
  return {
    llamadas,
    parecidas: async (id) => {
      llamadas.push(["parecidas", id]);
      if (respuesta instanceof Error) throw respuesta;
      return respuesta;
    },
    yaHecha: async (id, datos) => (llamadas.push(["yaHecha", id, datos]), { ok: true }),
    repetida: async (id, datos) => (llamadas.push(["repetida", id, datos]), { ok: true }),
  };
}
const registroFalso = () => {
  const lineas = [];
  return { lineas, info: (texto) => lineas.push(["info", texto]), aviso: (texto) => lineas.push(["aviso", texto]) };
};

await prueba("revisarRepetidas: llama a yaHecha con repetidaDe", async () => {
  const crm = crmFalso({ tarjetas: [tarjeta(12, NUEVA.titulo, "HECHO", { commit: EN_MAIN })], repetidasRevisadas: [] });
  const r = await revisarRepetidas({ crm, config, registro: registroFalso(), repo }, NUEVA);
  assert.deepEqual(r, { cerrada: true });
  const [, id, datos] = crm.llamadas.find(([nombre]) => nombre === "yaHecha");
  assert.equal(id, "t50");
  assert.equal(datos.repetidaDe, "t12");
  assert.equal(datos.commit, EN_MAIN);
  assert.equal(datos.nota, `Ya lo hizo T-12 (commit ${EN_MAIN.slice(0, 7)})`);
  assert.equal(datos.etapa, "planear");
});

await prueba("revisarRepetidas: llama a repetida con el tipo repetida o posible", async () => {
  const crm = crmFalso({ tarjetas: [tarjeta(30, NUEVA.titulo, "APROBADO")] });
  assert.deepEqual(await revisarRepetidas({ crm, config, registro: registroFalso(), repo }, NUEVA), { cerrada: true });
  const [, , datos] = crm.llamadas.find(([nombre]) => nombre === "repetida");
  assert.equal(datos.tipo, "repetida");
  assert.equal(datos.otraId, "t30");
  assert.equal(datos.linea, "Repetida de T-30");

  const crmPosible = crmFalso({ tarjetas: [tarjeta(9, NUEVA.titulo, "ERROR")] });
  assert.deepEqual(await revisarRepetidas({ crm: crmPosible, config, registro: registroFalso(), repo }, NUEVA), { cerrada: true });
  const [, , posible] = crmPosible.llamadas.find(([nombre]) => nombre === "repetida");
  assert.equal(posible.tipo, "posible");
  assert.equal(posible.otraId, "t9");
  assert.match(posible.linea, /^Posible repetida de T-9/);
});

await prueba("revisarRepetidas: esperar devuelve el id de la otra y seguir no llama a nada", async () => {
  const crm = crmFalso({ tarjetas: [tarjeta(40, NUEVA.titulo, "EN_CURSO")] });
  assert.deepEqual(await revisarRepetidas({ crm, config, registro: registroFalso(), repo }, NUEVA), { cerrada: false, esperar: "t40" });
  const vacio = crmFalso({ tarjetas: [] });
  assert.deepEqual(await revisarRepetidas({ crm: vacio, config, registro: registroFalso(), repo }, NUEVA), { cerrada: false });
  assert.deepEqual(vacio.llamadas.map(([nombre]) => nombre), ["parecidas"]);
});

await prueba("revisarRepetidas: si parecidas lanza un error (CRM viejo, red), avisa y devuelve cerrada:false", async () => {
  const registro = registroFalso();
  const crm = crmFalso(Object.assign(new Error("El CRM contestó 404."), { status: 404 }));
  assert.deepEqual(await revisarRepetidas({ crm, config, registro, repo }, NUEVA), { cerrada: false });
  assert.ok(registro.lineas.some(([tipo, texto]) => tipo === "aviso" && /404/.test(texto) && /se planea igual/.test(texto)));
  // Si falla la llamada que cierra, tampoco lanza.
  const cierraMal = crmFalso({ tarjetas: [tarjeta(30, NUEVA.titulo, "APROBADO")] });
  cierraMal.repetida = async () => {
    throw new Error("red cortada");
  };
  assert.deepEqual(await revisarRepetidas({ crm: cierraMal, config, registro, repo }, NUEVA), { cerrada: false });
});

await prueba("recoger errores: una posible repetida se salta (decide el dueño), nunca se reintenta ni se parte", () => {
  const base = { titulo: "Panel", plan: null, recogidas: 0, ultimosIntentos: [], ultimoError: "Timeout: se pasó de tiempo" };
  for (const variante of [{ categoria: "posible_repetida" }, { motivo: "Posible repetida de T-12: comparten 85 % de las palabras del título" }, { ultimosIntentos: [{ etapa: "planear", categoria: "posible_repetida" }] }]) {
    const decision = decidirRecogida({ ...base, ...variante });
    assert.equal(decision.accion, "saltar", JSON.stringify(variante));
    assert.equal(decision.motivo, "posible repetida: decide el dueño");
  }
  // Las demás siguen como antes.
  assert.notEqual(decidirRecogida({ ...base, motivo: "se pasó de tiempo" }).accion, "saltar");
});

fs.rmSync(T, { recursive: true, force: true });
if (fallas) {
  console.log(`\n${fallas} prueba(s) fallaron, ${pruebas} pasaron.`);
  process.exit(1);
}
console.log(`\n${pruebas} pruebas de repetidas pasaron.`);
