// Pruebas de TARJETAS REPETIDAS (27-nov-2026, parte 2 de 3 de «detectar tarjetas repetidas antes de planear»): la comparación
// (compararTarjetas), la decisión (decidirRepetida) con un repo git de prueba con su "origin", la revisión con un CRM falso
// (revisarRepetidas) y la recogida de errores que nunca toca una posible repetida. Sin red, sin CRM de verdad y sin Claude:
//   node trabajador-tablero/pruebas/probar-repetidas.mjs   (también corre dentro de npm run test:trabajador-tablero)
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { REPETIDAS_POR_DEFECTO, completarConfig } from "../lib/config.mjs";
import { crearCrm } from "../lib/crm.mjs";
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

/* ── el git de prueba: un commit en main (subido a origin) y otro solo en una rama local ── */
fs.mkdirSync(RUTA);
execFileSync("git", ["init", "--bare", "-b", "main", REMOTO], { stdio: "ignore" });
g(RUTA, "init", "-b", "main");
fs.writeFileSync(path.join(RUTA, "a.txt"), "base\n");
g(RUTA, "add", "-A");
g(RUTA, "commit", "-m", "base");
fs.writeFileSync(path.join(RUTA, "menu.ts"), "export const menu = 1;\n");
g(RUTA, "add", "-A");
g(RUTA, "commit", "-m", "tablero: menú de pedidos (abc12345)");
const EN_MAIN = g(RUTA, "rev-parse", "HEAD");
g(RUTA, "remote", "add", "origin", REMOTO);
g(RUTA, "push", "-q", "-u", "origin", "main");
g(RUTA, "checkout", "-q", "-b", "sin-subir");
fs.writeFileSync(path.join(RUTA, "otro.ts"), "export const otro = 2;\n");
g(RUTA, "add", "-A");
g(RUTA, "commit", "-m", "tablero: algo que no subió");
const FUERA_DE_MAIN = g(RUTA, "rev-parse", "HEAD");
g(RUTA, "checkout", "-q", "main");
const REPO = { ruta: RUTA, remoto: "origin", ramaBase: "main" };

const BASE = { urlCrm: "https://crm.ejemplo.co", claveTrabajador: "aizen_trab_x", carpetaTrabajo: T, repos: { aizencrm: { ruta: RUTA, subirSolo: false } } };
const config = completarConfig(BASE, T);

/** Una tarjeta de prueba. */
const tarjeta = (numero, titulo, extra = {}) => ({ id: `id${numero}`, numero, codigo: `T-${numero}`, titulo, detalle: "", plan: null, estado: "APROBADO", commit: null, ...extra });

try {
  await prueba("config: el bloque repetidas trae sus valores y se puede sobrescribir", () => {
    assert.deepEqual(config.repetidas, REPETIDAS_POR_DEFECTO);
    assert.deepEqual(REPETIDAS_POR_DEFECTO, { igualPalabras: 0.8, igualConArchivo: 0.5, posibleSinArchivo: 0.5, posibleConArchivo: 0.3, dias: 30 });
    const otra = completarConfig({ ...BASE, repetidas: { igualPalabras: 0.9 } }, T);
    assert.equal(otra.repetidas.igualPalabras, 0.9);
    assert.equal(otra.repetidas.dias, 30);
    assert.throws(() => completarConfig({ ...BASE, repetidas: { posibleConArchivo: 3 } }, T), /repetidas\.posibleConArchivo/);
  });

  await prueba("normalizarTitulo: minúsculas, sin tildes, sin signos ni prefijos Parte N / T-123", () => {
    assert.equal(normalizarTitulo("Parte 2 de 3: Cambiar el Menú de Pedidos!"), "cambiar el menu de pedidos");
    assert.equal(normalizarTitulo("T-123 — Cambiar el menú de pedidos"), "cambiar el menu de pedidos");
    assert.equal(normalizarTitulo(null), "");
  });

  await prueba("compararTarjetas: igual (mismo título, 80 % de palabras, o 50 % con un archivo en común)", () => {
    assert.equal(compararTarjetas(tarjeta(1, "Parte 1: Cambiar el menú de pedidos"), tarjeta(2, "T-9 cambiar el MENU de pedidos.")).nivel, "igual");
    const a = tarjeta(1, "Panel de cuentas: mostrar ventas últimos siete días");
    const b = tarjeta(2, "Mostrar ventas últimos siete días en panel de cuentas ya");
    assert.equal(compararTarjetas(a, b).nivel, "igual");
    const conArchivoA = tarjeta(1, "Bandeja: ordenar chats por último mensaje", { detalle: "Tocar src/features/chats/bandeja.ts" });
    const conArchivoB = tarjeta(2, "Ordenar chats de la bandeja por prioridad urgente", { plan: "## 5. Archivos\n- src/features/chats/bandeja.ts" });
    const resultado = compararTarjetas(conArchivoA, conArchivoB);
    assert.equal(resultado.nivel, "igual", resultado.porque);
    assert.match(resultado.porque, /src\/features\/chats\/bandeja\.ts/);
  });

  await prueba("compararTarjetas: posible (50-80 % sin archivo, o un archivo con 30 % o más) y distinta", () => {
    const a = tarjeta(1, "Bandeja: ordenar chats por último mensaje");
    const b = tarjeta(2, "Ordenar chats de la bandeja por prioridad urgente");
    assert.equal(compararTarjetas(a, b).nivel, "posible");
    const conArchivoA = tarjeta(1, "Arreglar reporte diario de ventas", { detalle: "src/lib/reporte.ts" });
    const conArchivoB = tarjeta(2, "Reporte diario: agregar columna ciudad", { detalle: "src/lib/reporte.ts" });
    assert.equal(compararTarjetas(conArchivoA, conArchivoB).nivel, "posible", compararTarjetas(conArchivoA, conArchivoB).porque);
    assert.equal(compararTarjetas(tarjeta(1, "Cambiar el color del botón verde"), tarjeta(2, "Exportar contactos a Excel")).nivel, "distinta");
    // El manual y las notas de cambios pendientes no cuentan como archivo en común.
    const manualA = tarjeta(1, "Arreglar reporte diario de ventas", { detalle: "docs/que-es-esta-aplicacion.md" });
    const manualB = tarjeta(2, "Reporte diario: agregar columna ciudad", { detalle: "docs/que-es-esta-aplicacion.md" });
    assert.equal(compararTarjetas(manualA, manualB).nivel, "distinta");
  });

  const nueva = tarjeta(20, "Cambiar el menú de pedidos", { estado: "PLANEANDO", detalle: "El menú de pedidos con fotos." });

  await prueba("decidirRepetida (1): la otra HECHO, igual y con el commit en main -> ya-hecha", async () => {
    const otra = tarjeta(10, "Cambiar el menú de pedidos", { estado: "HECHO", commit: EN_MAIN });
    const decision = await decidirRepetida({ tarjeta: nueva, parecidas: { tarjetas: [otra], repetidasRevisadas: [] }, repo: REPO, config });
    assert.equal(decision.accion, "ya-hecha");
    assert.equal(decision.otra.id, "id10");
    assert.equal(decision.commit, EN_MAIN);
    assert.equal(decision.linea, `Ya lo hizo T-10 (commit ${EN_MAIN.slice(0, 7)})`);
  });

  await prueba("decidirRepetida (1): si el commit de la HECHO no está en main, esa otra no cuenta", async () => {
    const otra = tarjeta(10, "Cambiar el menú de pedidos", { estado: "HECHO", commit: FUERA_DE_MAIN });
    assert.equal((await decidirRepetida({ tarjeta: nueva, parecidas: [otra], repo: REPO, config })).accion, "seguir");
    const inventado = tarjeta(11, "Cambiar el menú de pedidos", { estado: "HECHO", commit: "deadbeefdeadbeef" });
    assert.equal((await decidirRepetida({ tarjeta: nueva, parecidas: [inventado], repo: REPO, config })).accion, "seguir");
  });

  await prueba("decidirRepetida (2): las dos pendientes e iguales -> repetida de la de número menor; si la otra es la nueva, seguir", async () => {
    const vieja = tarjeta(12, "Cambiar el menú de pedidos", { estado: "PLAN_LISTO" });
    const decision = await decidirRepetida({ tarjeta: nueva, parecidas: [vieja], repo: REPO, config });
    assert.equal(decision.accion, "repetida");
    assert.equal(decision.linea, "Repetida de T-12");
    assert.equal(decision.detalleParaLaOtra, "El menú de pedidos con fotos.");
    const masNueva = tarjeta(30, "Cambiar el menú de pedidos", { estado: "APROBADO" });
    assert.equal((await decidirRepetida({ tarjeta: nueva, parecidas: [masNueva], repo: REPO, config })).accion, "seguir");
  });

  await prueba("decidirRepetida: la otra igual EN_CURSO o SUBIENDO -> esperar", async () => {
    for (const estado of ["EN_CURSO", "SUBIENDO"]) {
      const otra = tarjeta(13, "Cambiar el menú de pedidos", { estado });
      const decision = await decidirRepetida({ tarjeta: nueva, parecidas: [otra], repo: REPO, config });
      assert.equal(decision.accion, "esperar", estado);
      assert.equal(decision.otra.id, "id13");
    }
  });

  await prueba("decidirRepetida (3): un parecido posible, o una igual en ERROR o FALLIDO -> posible", async () => {
    const parecida = tarjeta(14, "Menú de pedidos: cambiar las fotos", { estado: "APROBADO" });
    const decision = await decidirRepetida({ tarjeta: nueva, parecidas: [parecida], repo: REPO, config });
    assert.equal(decision.accion, "posible", decision.motivo);
    assert.match(decision.linea, /^Posible repetida de T-14: comparten/);
    for (const estado of ["ERROR", "FALLIDO"]) {
      const igual = tarjeta(15, "Cambiar el menú de pedidos", { estado });
      const conError = await decidirRepetida({ tarjeta: nueva, parecidas: [igual], repo: REPO, config });
      assert.equal(conError.accion, "posible", estado);
      assert.match(conError.linea, new RegExp(`^Posible repetida de T-15: .*${estado}`));
    }
  });

  await prueba("decidirRepetida: el orden manda (ya-hecha antes que repetida) y salta las parejas ya revisadas", async () => {
    const hecha = tarjeta(10, "Cambiar el menú de pedidos", { estado: "HECHO", commit: EN_MAIN });
    const vieja = tarjeta(5, "Cambiar el menú de pedidos", { estado: "APROBADO" });
    assert.equal((await decidirRepetida({ tarjeta: nueva, parecidas: [vieja, hecha], repo: REPO, config })).accion, "ya-hecha");
    assert.equal((await decidirRepetida({ tarjeta: nueva, parecidas: { tarjetas: [vieja, hecha], repetidasRevisadas: [10] }, repo: REPO, config })).accion, "repetida");
    const revisadaEnEsta = { ...nueva, resultado: { repetidasRevisadas: [5, 10] } };
    assert.equal((await decidirRepetida({ tarjeta: revisadaEnEsta, parecidas: [vieja, hecha], repo: REPO, config })).accion, "seguir");
  });

  /** Un CRM falso con las funciones que usa revisarRepetidas; anota cada llamada. */
  const crmFalso = (parecidas) => {
    const llamadas = [];
    return {
      llamadas,
      parecidas: async (id) => {
        llamadas.push(["parecidas", id]);
        if (parecidas instanceof Error) throw parecidas;
        return { ok: true, tarjetas: parecidas, repetidasRevisadas: [] };
      },
      yaHecha: async (id, datos) => (llamadas.push(["yaHecha", id, datos]), { ok: true, estado: "HECHO" }),
      repetida: async (id, datos) => (llamadas.push(["repetida", id, datos]), { ok: true }),
    };
  };
  const registroFalso = () => {
    const lineas = [];
    return { lineas, info: (texto) => lineas.push(["info", texto]), aviso: (texto) => lineas.push(["aviso", texto]) };
  };

  await prueba("revisarRepetidas: ya-hecha llama a crm.yaHecha con repetidaDe", async () => {
    const crm = crmFalso([tarjeta(10, "Cambiar el menú de pedidos", { estado: "HECHO", commit: EN_MAIN })]);
    const salida = await revisarRepetidas({ crm, config, registro: registroFalso(), repo: REPO }, nueva);
    assert.equal(salida.cerrada, true);
    const [que, id, datos] = crm.llamadas.at(-1);
    assert.equal(que, "yaHecha");
    assert.equal(id, "id20");
    assert.equal(datos.repetidaDe, "id10");
    assert.equal(datos.commit, EN_MAIN);
    assert.equal(datos.nota, `Ya lo hizo T-10 (commit ${EN_MAIN.slice(0, 7)})`);
  });

  await prueba("revisarRepetidas: repetida y posible llaman a crm.repetida con su tipo; esperar y seguir no cierran", async () => {
    const repetida = crmFalso([tarjeta(12, "Cambiar el menú de pedidos", { estado: "APROBADO" })]);
    assert.deepEqual(await revisarRepetidas({ crm: repetida, config, registro: registroFalso(), repo: REPO }, nueva), { cerrada: true, accion: "repetida" });
    const [, , datos] = repetida.llamadas.at(-1);
    assert.equal(datos.tipo, "repetida");
    assert.equal(datos.otraId, "id12");
    assert.equal(datos.linea, "Repetida de T-12");
    assert.equal(datos.detalleParaLaOtra, "El menú de pedidos con fotos.");

    const posible = crmFalso([tarjeta(14, "Menú de pedidos: cambiar las fotos", { estado: "APROBADO" })]);
    assert.equal((await revisarRepetidas({ crm: posible, config, registro: registroFalso(), repo: REPO }, nueva)).cerrada, true);
    const [que, , datosPosible] = posible.llamadas.at(-1);
    assert.equal(que, "repetida");
    assert.equal(datosPosible.tipo, "posible");
    assert.equal(datosPosible.detalleParaLaOtra, undefined);

    const esperar = crmFalso([tarjeta(13, "Cambiar el menú de pedidos", { estado: "EN_CURSO" })]);
    assert.deepEqual(await revisarRepetidas({ crm: esperar, config, registro: registroFalso(), repo: REPO }, nueva), { cerrada: false, esperar: "id13", accion: "esperar" });
    const seguir = crmFalso([]);
    assert.deepEqual(await revisarRepetidas({ crm: seguir, config, registro: registroFalso(), repo: REPO }, nueva), { cerrada: false, accion: "seguir" });
    for (const crm of [esperar, seguir]) assert.ok(!crm.llamadas.some(([nombre]) => nombre !== "parecidas"));
  });

  await prueba("revisarRepetidas: si parecidas falla (CRM viejo, red) o el cierre falla, avisa y devuelve cerrada:false", async () => {
    const registro = registroFalso();
    const salida = await revisarRepetidas({ crm: crmFalso(new Error("El CRM contestó 404.")), config, registro, repo: REPO }, nueva);
    assert.deepEqual(salida, { cerrada: false });
    assert.equal(registro.lineas.at(-1)[0], "aviso");
    assert.match(registro.lineas.at(-1)[1], /404.*se planea igual/);

    const rompe = crmFalso([tarjeta(12, "Cambiar el menú de pedidos", { estado: "APROBADO" })]);
    rompe.repetida = async () => {
      throw new Error("El CRM contestó 409.");
    };
    assert.deepEqual(await revisarRepetidas({ crm: rompe, config, registro: registroFalso(), repo: REPO }, nueva), { cerrada: false });
    // Git roto (la carpeta del repo no existe): tampoco frena.
    const hecha = crmFalso([tarjeta(10, "Cambiar el menú de pedidos", { estado: "HECHO", commit: EN_MAIN })]);
    const sinRepo = await revisarRepetidas({ crm: hecha, config, registro: registroFalso(), repo: { ruta: path.join(T, "no-existe"), remoto: "origin", ramaBase: "main" } }, nueva);
    assert.equal(sinRepo.cerrada, false);
  });

  await prueba("crm.parecidas y crm.repetida piden las rutas del CRM (repetida sin campos vacíos)", async () => {
    const pedidos = [];
    const fetchFalso = async (url, opciones) => {
      pedidos.push([url, JSON.parse(opciones.body)]);
      return { ok: true, status: 200, json: async () => ({ ok: true, tarjetas: [] }) };
    };
    const crm = crearCrm({ urlCrm: "https://crm.ejemplo.co", claveTrabajador: "x" }, { fetch: fetchFalso });
    await crm.parecidas("a b");
    await crm.repetida("id20", { tipo: "posible", otraId: "id14", linea: "Posible repetida de T-14: x", detalleParaLaOtra: undefined });
    await crm.yaHecha("id20", { commit: EN_MAIN, repetidaDe: "id10" });
    assert.deepEqual(pedidos[0], ["https://crm.ejemplo.co/api/trabajador/tablero/a%20b/parecidas", {}]);
    assert.deepEqual(pedidos[1], ["https://crm.ejemplo.co/api/trabajador/tablero/id20/repetida", { tipo: "posible", otraId: "id14", linea: "Posible repetida de T-14: x" }]);
    assert.equal(pedidos[2][1].repetidaDe, "id10");
  });

  await prueba("recoger errores: una posible repetida se salta (decide el dueño), nunca se reintenta ni se parte", () => {
    const base = { titulo: "x", plan: null, esParte: false, recogidas: 0, ultimoError: "Timeout de la sesión", ultimosIntentos: [] };
    const porMotivo = decidirRecogida({ ...base, motivo: "Posible repetida de T-14: comparten 60 % de las palabras del título" });
    assert.equal(porMotivo.accion, "saltar");
    assert.equal(porMotivo.motivo, "posible repetida: decide el dueño");
    assert.equal(porMotivo.categoria, "posible_repetida");
    assert.equal(decidirRecogida({ ...base, categoria: "posible_repetida", motivo: "otra cosa" }).accion, "saltar");
    // Antes que las demás reglas: ni siquiera por tamaño (que partiría) ni por las veces que ya se recogió.
    assert.equal(decidirRecogida({ ...base, motivo: "Posible repetida de T-3: x", ultimoError: "tarea muy grande, se acabó el tiempo", recogidas: 5 }).motivo, "posible repetida: decide el dueño");
    // Una tarjeta normal sigue igual que antes.
    assert.notEqual(decidirRecogida({ ...base, motivo: "Falló el build" }).motivo, "posible repetida: decide el dueño");
  });

  console.log(`\n${pruebas} pruebas OK`);
} catch (error) {
  console.error(`not ok - ${error?.stack ?? error}`);
  process.exitCode = 1;
} finally {
  fs.rmSync(T, { recursive: true, force: true, maxRetries: 3 });
}
