// Pruebas de las TARJETAS REPETIDAS antes de planear (27-nov-2026, parte 2 de «Coordinador: detectar tarjetas repetidas antes de
// planear»): comparar títulos y archivos, decidir (ya-hecha, repetida, posible, esperar), la revisión con un CRM falso y que
// recoger-errores nunca toca una posible repetida. Sin red de verdad ni CRM:
//   node trabajador-tablero/pruebas/probar-repetidas.mjs   (también corre dentro de npm run test:trabajador-tablero)
// El git falso es un repo con su "origin" en una carpeta temporal: un commit está en main y otro solo en una rama.
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

const T = fs.mkdtempSync(path.join(os.tmpdir(), "repetidas-"));
const REMOTO = path.join(T, "remoto.git");
const RUTA = path.join(T, "repo");
const g = (cwd, ...args) =>
  execFileSync("git", ["-c", "user.name=Prueba", "-c", "user.email=prueba@x.co", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

/* ── el git falso: EN_MAIN está en origin/main; FUERA solo en una rama ── */
fs.mkdirSync(RUTA);
execFileSync("git", ["init", "--bare", "-b", "main", REMOTO], { stdio: "ignore" });
g(RUTA, "init", "-b", "main");
fs.writeFileSync(path.join(RUTA, "a.txt"), "base\n");
g(RUTA, "add", "-A");
g(RUTA, "commit", "-m", "base");
g(RUTA, "remote", "add", "origin", REMOTO);
fs.writeFileSync(path.join(RUTA, "a.txt"), "lo hecho\n");
g(RUTA, "commit", "-am", "tablero: panel de ventas");
const EN_MAIN = g(RUTA, "rev-parse", "HEAD");
g(RUTA, "push", "-q", "-u", "origin", "main");
g(RUTA, "checkout", "-q", "-b", "otra-rama");
fs.writeFileSync(path.join(RUTA, "a.txt"), "sin subir\n");
g(RUTA, "commit", "-am", "tablero: algo sin subir");
const FUERA = g(RUTA, "rev-parse", "HEAD");
g(RUTA, "checkout", "-q", "main");
const repo = { ruta: RUTA, remoto: "origin", ramaBase: "main" };

const BASE = {
  urlCrm: "https://crm.ejemplo.com",
  claveTrabajador: "aizen_trab_x",
  carpetaTrabajo: path.join(T, "trabajo"),
  nube: { activa: false },
  repos: { aizencrm: { ruta: RUTA, subirSolo: false, ramaBase: "main" } },
};
const config = completarConfig(BASE);

const nueva = {
  id: "nueva",
  numero: 50,
  titulo: "Panel de ventas: mostrar el total del mes por asesora",
  detalle: "Cambiar src/app/cliente/ventas/page.tsx para que salga el total.",
  plan: "Archivos:\n1. src/app/cliente/ventas/page.tsx",
};
const otra = (extra) => ({ id: "otra", numero: 40, codigo: "T-40", titulo: nueva.titulo, detalle: "", plan: "", estado: "APROBADO", commit: null, ...extra });

await prueba("normalizarTitulo quita tildes, signos y los prefijos T-123 y Parte N", () => {
  assert.equal(normalizarTitulo("T-123: Parte 2 de 3 — Módulo de Ventas: ¡el total!"), "modulo de ventas el total");
  assert.equal(normalizarTitulo("Parte 1: Ventas"), "ventas");
});

await prueba("compararTarjetas: igual por título, por palabras o por palabras y archivo", () => {
  assert.equal(compararTarjetas({ titulo: "T-9: Panel de Ventas" }, { titulo: "panel de ventas!" }).nivel, "igual");
  const muchas = compararTarjetas(
    { titulo: "Mostrar total mensual ventas asesoras panel" },
    { titulo: "Panel: mostrar total mensual ventas asesoras" },
  );
  assert.equal(muchas.nivel, "igual");
  const conArchivo = compararTarjetas(
    { titulo: "Ventas mostrar total asesoras", plan: "Archivos:\n1. src/app/cliente/ventas/page.tsx" },
    { titulo: "Ventas mostrar total semanal clientes", detalle: "Tocar src/app/cliente/ventas/page.tsx" },
  );
  assert.equal(conArchivo.nivel, "igual");
  assert.match(conArchivo.porque, /src\/app\/cliente\/ventas\/page\.tsx/);
});

await prueba("compararTarjetas: posible (50-80 % sin archivo, o archivo con 30 %) y distinta", () => {
  assert.equal(compararTarjetas({ titulo: "Ventas mostrar total asesoras" }, { titulo: "Ventas mostrar total semanal clientes" }).nivel, "posible");
  const archivoPocas = compararTarjetas(
    { titulo: "Ventas filtro fecha", plan: "Archivos:\n1. src/app/cliente/ventas/page.tsx" },
    { titulo: "Ventas color botones", plan: "Archivos:\n1. src/app/cliente/ventas/page.tsx" },
  );
  assert.equal(archivoPocas.nivel, "posible");
  assert.equal(compararTarjetas({ titulo: "Bot de ventas saludo" }, { titulo: "Coordinador revisar memoria" }).nivel, "distinta");
  // El manual no cuenta como archivo en común.
  assert.equal(
    compararTarjetas(
      { titulo: "Ventas filtro fecha", plan: "docs/que-es-esta-aplicacion.md" },
      { titulo: "Ventas color botones", plan: "docs/que-es-esta-aplicacion.md" },
    ).nivel,
    "distinta",
  );
});

await prueba("decidirRepetida: HECHO igual con el commit en main -> ya-hecha; fuera de main no cuenta", async () => {
  const hecha = await decidirRepetida({ tarjeta: nueva, parecidas: { tarjetas: [otra({ estado: "HECHO", commit: EN_MAIN })] }, repo, config });
  assert.equal(hecha.accion, "ya-hecha");
  assert.equal(hecha.linea, `Ya lo hizo T-40 (commit ${EN_MAIN.slice(0, 7)})`);
  assert.equal(hecha.commit, EN_MAIN);
  const fuera = await decidirRepetida({ tarjeta: nueva, parecidas: { tarjetas: [otra({ estado: "HECHO", commit: FUERA })] }, repo, config });
  assert.equal(fuera.accion, "seguir");
});

await prueba("decidirRepetida: las dos pendientes -> repetida si la otra es más vieja; seguir si la otra es la nueva", async () => {
  const repetida = await decidirRepetida({ tarjeta: nueva, parecidas: { tarjetas: [otra({ estado: "PLAN_APROBADO" })] }, repo, config });
  assert.equal(repetida.accion, "repetida");
  assert.equal(repetida.linea, "Repetida de T-40");
  assert.equal(repetida.detalleParaLaOtra, nueva.detalle);
  const masNueva = await decidirRepetida({ tarjeta: nueva, parecidas: { tarjetas: [otra({ numero: 60, codigo: "T-60" })] }, repo, config });
  assert.equal(masNueva.accion, "seguir");
});

await prueba("decidirRepetida: EN_CURSO o SUBIENDO -> esperar; posible e igual con ERROR -> posible", async () => {
  for (const estado of ["EN_CURSO", "SUBIENDO"]) {
    const espera = await decidirRepetida({ tarjeta: nueva, parecidas: { tarjetas: [otra({ estado })] }, repo, config });
    assert.equal(espera.accion, "esperar", estado);
    assert.equal(espera.otra.id, "otra");
  }
  const conError = await decidirRepetida({ tarjeta: nueva, parecidas: { tarjetas: [otra({ estado: "ERROR" })] }, repo, config });
  assert.equal(conError.accion, "posible");
  assert.match(conError.linea, /^Posible repetida de T-40: /);
  const parecida = await decidirRepetida({
    tarjeta: { ...nueva, titulo: "Ventas mostrar total asesoras", detalle: "", plan: "" },
    parecidas: { tarjetas: [otra({ titulo: "Ventas mostrar total semanal clientes", estado: "HECHO", commit: EN_MAIN })] },
    repo,
    config,
  });
  assert.equal(parecida.accion, "posible");
});

await prueba("decidirRepetida: salta las parejas de repetidasRevisadas y ya-hecha gana a posible", async () => {
  const revisada = await decidirRepetida({ tarjeta: nueva, parecidas: { tarjetas: [otra({ estado: "PLAN_APROBADO" })], repetidasRevisadas: [40] }, repo, config });
  assert.equal(revisada.accion, "seguir");
  const enResultado = await decidirRepetida({ tarjeta: { ...nueva, resultado: { repetidasRevisadas: [40] } }, parecidas: [otra({ estado: "PLAN_APROBADO" })], repo, config });
  assert.equal(enResultado.accion, "seguir");
  const varias = await decidirRepetida({
    tarjeta: nueva,
    parecidas: { tarjetas: [otra({ id: "falla", estado: "ERROR" }), otra({ id: "hecha", numero: 30, codigo: "T-30", estado: "HECHO", commit: EN_MAIN })] },
    repo,
    config,
  });
  assert.equal(varias.accion, "ya-hecha");
  assert.equal(varias.otra.id, "hecha");
});

function crmFalso(parecidas) {
  const llamadas = [];
  return {
    llamadas,
    parecidas: async (id) => {
      llamadas.push(["parecidas", id]);
      if (parecidas instanceof Error) throw parecidas;
      return parecidas;
    },
    yaHecha: async (id, datos) => llamadas.push(["yaHecha", id, datos]),
    repetida: async (id, datos) => llamadas.push(["repetida", id, datos]),
  };
}
const avisos = [];
const registro = { info: () => {}, aviso: (mensaje) => avisos.push(mensaje) };

await prueba("revisarRepetidas: ya-hecha llama a yaHecha con repetidaDe", async () => {
  const crm = crmFalso({ tarjetas: [otra({ estado: "HECHO", commit: EN_MAIN })], repetidasRevisadas: [] });
  const r = await revisarRepetidas({ crm, config, registro, repo }, nueva);
  assert.equal(r.cerrada, true);
  const [, id, datos] = crm.llamadas.find(([nombre]) => nombre === "yaHecha");
  assert.equal(id, "nueva");
  assert.equal(datos.repetidaDe, "otra");
  assert.equal(datos.commit, EN_MAIN);
});

await prueba("revisarRepetidas: repetida y posible llaman a repetida con su tipo; esperar no cierra", async () => {
  const crm = crmFalso({ tarjetas: [otra({ estado: "APROBADO" })] });
  assert.equal((await revisarRepetidas({ crm, config, registro, repo }, nueva)).cerrada, true);
  const [, , datos] = crm.llamadas.find(([nombre]) => nombre === "repetida");
  assert.deepEqual([datos.tipo, datos.otraId, datos.linea, datos.detalleParaLaOtra], ["repetida", "otra", "Repetida de T-40", nueva.detalle]);

  const conError = crmFalso({ tarjetas: [otra({ estado: "FALLIDO" })] });
  assert.equal((await revisarRepetidas({ crm: conError, config, registro, repo }, nueva)).cerrada, true);
  const [, , posible] = conError.llamadas.find(([nombre]) => nombre === "repetida");
  assert.equal(posible.tipo, "posible");
  assert.equal(posible.detalleParaLaOtra, undefined);

  const enCurso = crmFalso({ tarjetas: [otra({ estado: "EN_CURSO" })] });
  assert.deepEqual(
    (({ cerrada, esperar }) => ({ cerrada, esperar }))(await revisarRepetidas({ crm: enCurso, config, registro, repo }, nueva)),
    { cerrada: false, esperar: "otra" },
  );
  assert.equal(enCurso.llamadas.length, 1);
});

await prueba("revisarRepetidas: si parecidas falla (CRM viejo, red) devuelve cerrada:false con un aviso", async () => {
  const crm = crmFalso(new Error("404 Not Found"));
  const r = await revisarRepetidas({ crm, config, registro, repo }, nueva);
  assert.deepEqual(r, { cerrada: false });
  assert.ok(avisos.some((aviso) => aviso.includes("404 Not Found")));
});

await prueba("recoger-errores: una posible repetida se salta (decide el dueño)", () => {
  const porCategoria = decidirRecogida({ titulo: "x", categoria: "posible_repetida", motivo: "otra cosa", recogidas: 0 });
  assert.equal(porCategoria.accion, "saltar");
  assert.equal(porCategoria.motivo, "posible repetida: decide el dueño");
  const porMotivo = decidirRecogida({ titulo: "x", plan: "p", motivo: "Posible repetida de T-40: comparten 60 % de las palabras del título", recogidas: 0 });
  assert.equal(porMotivo.accion, "saltar");
  assert.notEqual(decidirRecogida({ titulo: "x", motivo: "límite de uso de Claude", recogidas: 0 }).accion, "saltar");
});

await prueba("config: el bloque repetidas trae sus valores por defecto y se puede sobrescribir", () => {
  assert.deepEqual(config.repetidas, { igualPalabras: 0.8, igualConArchivo: 0.5, posibleSinArchivo: 0.5, posibleConArchivo: 0.3, dias: 30 });
  const otraConfig = completarConfig({ ...BASE, repetidas: { igualPalabras: 0.9 } });
  assert.equal(otraConfig.repetidas.igualPalabras, 0.9);
  assert.equal(otraConfig.repetidas.dias, 30);
});

fs.rmSync(T, { recursive: true, force: true });
console.log(`\n${pruebas} pruebas de repetidas pasaron.`);
process.exit(0);
