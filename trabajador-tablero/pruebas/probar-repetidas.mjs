// Pruebas de las TARJETAS REPETIDAS del Coordinador (27-nov-2026), parte 2: comparar, decidir y revisar con un CRM falso, y que el
// recogedor de errores no reintente una "posible repetida". Sin red ni CRM de verdad; el git es un repo con su "origin" temporal:
//   node trabajador-tablero/pruebas/probar-repetidas.mjs   (también corre dentro de npm run test:trabajador-tablero)
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { completarConfig } from "../lib/config.mjs";
import { decidirRecogida } from "../lib/recoger-errores.mjs";
import { compararTarjetas, decidirRepetida, normalizarTitulo, revisarRepetidas } from "../lib/repetidas.mjs";

let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

/* ── el git falso: un commit que está en main de "origin" y otro que no ── */
const T = fs.mkdtempSync(path.join(os.tmpdir(), "repetidas-"));
const REMOTO = path.join(T, "remoto.git");
const REPO = path.join(T, "repo");
const g = (cwd, ...args) =>
  execFileSync("git", ["-c", "user.name=Prueba", "-c", "user.email=prueba@x.co", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
fs.mkdirSync(REPO);
execFileSync("git", ["init", "--bare", "-b", "main", REMOTO], { stdio: "ignore" });
g(REPO, "init", "-b", "main");
fs.writeFileSync(path.join(REPO, "a.txt"), "main\n");
g(REPO, "add", "-A");
g(REPO, "commit", "-m", "base");
g(REPO, "remote", "add", "origin", REMOTO);
g(REPO, "push", "-q", "-u", "origin", "main");
const enMain = g(REPO, "rev-parse", "HEAD");
g(REPO, "checkout", "-q", "-b", "otra-rama");
fs.writeFileSync(path.join(REPO, "b.txt"), "solo en la rama\n");
g(REPO, "add", "-A");
g(REPO, "commit", "-m", "fuera de main");
const fueraDeMain = g(REPO, "rev-parse", "HEAD");
g(REPO, "checkout", "-q", "main");
const repo = { ruta: REPO, remoto: "origin", ramaBase: "main" };

const TITULO = "Coordinador: detectar tarjetas repetidas antes de planear";
const nueva = { id: "nueva", numero: 50, titulo: TITULO, detalle: "Cambia trabajador-tablero/lib/bucle.mjs", repo: "aizencrm" };
const otra = (campos) => ({ id: "otra", numero: 10, codigo: "T-10", titulo: TITULO, detalle: "", estado: "APROBADO", plan: null, commit: null, ...campos });

await prueba("normalizarTitulo: sin tildes, signos, Parte N ni T-123", () => {
  assert.equal(normalizarTitulo("T-123 Cómo está: ¡Parte 2 de 3! (Revisión)"), "como esta revision");
  assert.equal(normalizarTitulo("Parte 1: Ñandú"), "nandu");
});

await prueba("compararTarjetas separa igual, posible y distinta", () => {
  assert.equal(compararTarjetas({ titulo: "Arreglar el menú de pagos" }, { titulo: "ARREGLAR el menu de pagos!" }).nivel, "igual");
  assert.equal(compararTarjetas({ titulo: "Parte 1 de 2: Detectar tarjetas repetidas" }, { titulo: "Detectar tarjetas repetidas (parte 2)" }).nivel, "igual");
  const a = { titulo: "Detectar tarjetas repetidas antes planear" };
  const b = { titulo: "Detectar tarjetas duplicadas antes ejecutar" };
  assert.equal(compararTarjetas(a, b).nivel, "posible"); // 3 de 5 palabras, sin archivo en común
  assert.equal(compararTarjetas({ titulo: "Mostrar ventas en el tablero" }, { titulo: "Cambiar colores de la página de login" }).nivel, "distinta");
  // con un archivo nombrado en las dos, 50 % ya es "igual" y 30 % ya es "posible"
  const conArchivo = (titulo) => ({ titulo, detalle: "Se toca src/lib/pagos.ts" });
  assert.equal(compararTarjetas(conArchivo("Corregir pagos duplicados nequi bancolombia"), conArchivo("Corregir pagos duplicados wompi epayco")).nivel, "igual");
  assert.equal(compararTarjetas(conArchivo("Corregir pagos duplicados nequi bancolombia"), conArchivo("Reporte pagos duplicados wompi epayco hoteles")).nivel, "posible");
  assert.equal(compararTarjetas({ titulo: "Corregir pagos duplicados", detalle: "src/lib/a.ts" }, { titulo: "Reporte mensual pagos wompi epayco hoteles", detalle: "src/lib/b.ts" }).nivel, "distinta");
});

await prueba("decidirRepetida: ya-hecha solo si el commit está en main", async () => {
  const hecha = await decidirRepetida({ tarjeta: nueva, parecidas: { tarjetas: [otra({ estado: "HECHO", commit: enMain })] }, repo, config: {} });
  assert.equal(hecha.accion, "ya-hecha");
  assert.equal(hecha.linea, `Ya lo hizo T-10 (commit ${enMain.slice(0, 7)})`);
  const fuera = await decidirRepetida({ tarjeta: nueva, parecidas: [otra({ estado: "HECHO", commit: fueraDeMain })], repo, config: {} });
  assert.equal(fuera.accion, "seguir"); // esa otra no cuenta
});

await prueba("decidirRepetida: repetida, seguir, esperar y posible", async () => {
  const repetida = await decidirRepetida({ tarjeta: nueva, parecidas: [otra({ estado: "APROBADO" })], repo, config: {} });
  assert.equal(repetida.accion, "repetida");
  assert.equal(repetida.linea, "Repetida de T-10");
  assert.equal(repetida.detalleParaLaOtra, nueva.detalle);
  const laNueva = await decidirRepetida({ tarjeta: nueva, parecidas: [otra({ numero: 90, estado: "APROBADO" })], repo, config: {} });
  assert.equal(laNueva.accion, "seguir");
  const esperar = await decidirRepetida({ tarjeta: nueva, parecidas: [otra({ estado: "EN_CURSO" })], repo, config: {} });
  assert.equal(esperar.accion, "esperar");
  assert.equal(esperar.otra.id, "otra");
  const fallida = await decidirRepetida({ tarjeta: nueva, parecidas: [otra({ estado: "ERROR" })], repo, config: {} });
  assert.equal(fallida.accion, "posible");
  assert.match(fallida.linea, /^Posible repetida de T-10: /);
  const parecida = await decidirRepetida({ tarjeta: { ...nueva, titulo: "Detectar tarjetas repetidas antes planear" }, parecidas: [otra({ titulo: "Detectar tarjetas duplicadas antes ejecutar" })], repo, config: {} });
  assert.equal(parecida.accion, "posible");
  // sin el número de la tarjeta nunca se cierra a ciegas: va al dueño
  const sinNumero = await decidirRepetida({ tarjeta: { ...nueva, numero: undefined }, parecidas: [otra({})], repo, config: {} });
  assert.equal(sinNumero.accion, "posible");
  // las parejas que el dueño ya revisó se saltan
  const revisada = await decidirRepetida({ tarjeta: nueva, parecidas: { tarjetas: [otra({ estado: "ERROR" })], repetidasRevisadas: [10] }, repo, config: {} });
  assert.equal(revisada.accion, "seguir");
});

/* ── el CRM falso ── */
function crmFalso(parecidas) {
  const llamadas = [];
  return {
    llamadas,
    parecidas: async (id) => {
      llamadas.push(["parecidas", id]);
      if (parecidas instanceof Error) throw parecidas;
      return parecidas;
    },
    yaHecha: async (id, datos) => (llamadas.push(["yaHecha", id, datos]), { ok: true }),
    repetida: async (id, datos) => (llamadas.push(["repetida", id, datos]), { ok: true }),
  };
}
const registroFalso = () => {
  const lineas = [];
  return { lineas, info: (m) => lineas.push(`INFO ${m}`), aviso: (m) => lineas.push(`AVISO ${m}`) };
};

await prueba("revisarRepetidas: llama a yaHecha con repetidaDe y a repetida con su tipo", async () => {
  const registro = registroFalso();
  let crm = crmFalso({ tarjetas: [otra({ estado: "HECHO", commit: enMain })], repetidasRevisadas: [] });
  assert.deepEqual(await revisarRepetidas({ crm, config: {}, registro, repo }, nueva), { cerrada: true });
  assert.equal(crm.llamadas[1][0], "yaHecha");
  assert.equal(crm.llamadas[1][2].repetidaDe, "otra");
  assert.equal(crm.llamadas[1][2].commit, enMain);

  crm = crmFalso({ tarjetas: [otra({ estado: "PLAN_LISTO" })] });
  assert.deepEqual(await revisarRepetidas({ crm, config: {}, registro, repo }, nueva), { cerrada: true });
  assert.equal(crm.llamadas[1][0], "repetida");
  assert.equal(crm.llamadas[1][2].tipo, "repetida");
  assert.equal(crm.llamadas[1][2].otraId, "otra");

  crm = crmFalso({ tarjetas: [otra({ estado: "ERROR" })] });
  assert.deepEqual(await revisarRepetidas({ crm, config: {}, registro, repo }, nueva), { cerrada: true });
  assert.equal(crm.llamadas[1][2].tipo, "posible");

  crm = crmFalso({ tarjetas: [otra({ estado: "SUBIENDO" })] });
  assert.deepEqual(await revisarRepetidas({ crm, config: {}, registro, repo }, nueva), { cerrada: false, esperar: "otra" });
  assert.equal(crm.llamadas.length, 1);

  crm = crmFalso({ tarjetas: [] });
  assert.deepEqual(await revisarRepetidas({ crm, config: {}, registro, repo }, nueva), { cerrada: false });
});

await prueba("revisarRepetidas: si parecidas falla, devuelve cerrada:false con un aviso", async () => {
  const registro = registroFalso();
  const crm = crmFalso(new Error("404 Not Found"));
  assert.deepEqual(await revisarRepetidas({ crm, config: {}, registro, repo }, nueva), { cerrada: false });
  assert.ok(registro.lineas.some((linea) => linea.startsWith("AVISO ") && linea.includes("404")));
  // y si git falla (carpeta que no existe) tampoco se rompe
  const roto = crmFalso({ tarjetas: [otra({ estado: "HECHO", commit: enMain })] });
  assert.deepEqual(await revisarRepetidas({ crm: roto, config: {}, registro, repo: { ...repo, ruta: path.join(T, "no-existe") } }, nueva), { cerrada: false });
});

await prueba("recoger-errores: una posible repetida se salta, nunca se reintenta", () => {
  const decision = decidirRecogida({ titulo: "X", categoria: "posible_repetida", recogidas: 0, motivo: "Claude no cambió ningún archivo" });
  assert.equal(decision.accion, "saltar");
  assert.equal(decision.motivo, "posible repetida: decide el dueño");
  // la lista del CRM no trae la categoría: se reconoce por el motivo
  const porMotivo = decidirRecogida({ titulo: "X", recogidas: 0, motivo: "Posible repetida de T-12: comparten el 60 % de las palabras del título" });
  assert.equal(porMotivo.accion, "saltar");
});

await prueba("config: el bloque repetidas trae los valores y se puede sobrescribir y validar", () => {
  const base = { urlCrm: "https://crm.example.com", claveTrabajador: "aizen_trab_x", repos: { gestion: { ruta: "." } } };
  const porDefecto = completarConfig(base, T);
  assert.deepEqual(porDefecto.repetidas, { igualPalabras: 0.8, igualConArchivo: 0.5, posibleSinArchivo: 0.5, posibleConArchivo: 0.3, dias: 30 });
  assert.equal(completarConfig({ ...base, repetidas: { dias: 7 } }, T).repetidas.dias, 7);
  assert.throws(() => completarConfig({ ...base, repetidas: { igualPalabras: 2 } }, T), /repetidas\.igualPalabras/);
  assert.throws(() => completarConfig({ ...base, repetidas: { dias: 0 } }, T), /repetidas\.dias/);
});

fs.rmSync(T, { recursive: true, force: true });
console.log(`\n${pruebas} pruebas de tarjetas repetidas, todas ok`);
