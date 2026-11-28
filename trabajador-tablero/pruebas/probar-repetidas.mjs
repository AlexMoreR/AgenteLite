// Pruebas de las TARJETAS REPETIDAS del Coordinador (27-nov-2026), parte 2 de 3: comparar, decidir, revisar con un CRM falso y la
// decisión del recogedor para "posible repetida". Sin red, sin CRM y sin WhatsApp (el repo de prueba es una carpeta con su "origin"):
//   node trabajador-tablero/pruebas/probar-repetidas.mjs   (también corre dentro de npm run test:trabajador-tablero)
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { fileURLToPath } from "node:url";

import { procesar } from "../lib/bucle.mjs";
import { REPETIDAS_POR_DEFECTO, completarConfig } from "../lib/config.mjs";
import { cargar } from "../../scripts/supervisor-cargar.mjs";
import { compararTarjetas, decidirRepetida, normalizarTitulo, revisarRepetidas } from "../lib/repetidas.mjs";
import { decidirRecogida } from "../lib/recoger-errores.mjs";

let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const T = fs.mkdtempSync(path.join(os.tmpdir(), "repetidas-"));
const g = (cwd, ...args) =>
  execFileSync("git", ["-c", "user.name=Prueba", "-c", "user.email=prueba@x.co", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

try {
  // Un repo con su origin: un commit ya está en main y otro solo está en una rama que nunca subió.
  const remoto = path.join(T, "origen.git");
  const ruta = path.join(T, "repo");
  fs.mkdirSync(ruta);
  execFileSync("git", ["init", "--bare", "-b", "main", remoto], { stdio: "ignore" });
  g(ruta, "init", "-b", "main");
  fs.writeFileSync(path.join(ruta, "a.txt"), "a\n");
  g(ruta, "add", "-A");
  g(ruta, "commit", "-m", "base");
  g(ruta, "remote", "add", "origin", remoto);
  g(ruta, "push", "-q", "-u", "origin", "main");
  const enMain = g(ruta, "rev-parse", "HEAD");
  g(ruta, "checkout", "-q", "-b", "solo-local");
  fs.writeFileSync(path.join(ruta, "b.txt"), "b\n");
  g(ruta, "add", "-A");
  g(ruta, "commit", "-m", "fuera de main");
  const fueraDeMain = g(ruta, "rev-parse", "HEAD");
  g(ruta, "checkout", "-q", "main");
  const repo = { ruta, remoto: "origin", ramaBase: "main" };
  const config = completarConfig({ topeDeIntentosReales: 20, urlCrm: "https://crm.ejemplo.com", claveTrabajador: "aizen_trab_x", carpetaTrabajo: T, nube: { activa: false }, repos: { aizencrm: { ...repo, ruta, subirSolo: false, verificar: [["node", "-e", "0"]], pruebas: [["node", "-e", "0"]] } } });

  await prueba("completarConfig trae el bloque repetidas con sus valores por defecto", () => {
    assert.deepEqual(config.repetidas, REPETIDAS_POR_DEFECTO);
    assert.throws(() => completarConfig({ urlCrm: "https://crm.ejemplo.com", claveTrabajador: "aizen_trab_x", carpetaTrabajo: T, repetidas: { igualPalabras: 5 }, repos: {} }), /repetidas\.igualPalabras/);
  });

  await prueba("normalizarTitulo quita tildes, signos, 'Parte N' y T-123", () => {
    assert.equal(normalizarTitulo("T-123: Coordinador — detectar tarjetas REPETIDAS (parte 2 de 3)"), "coordinador detectar tarjetas repetidas");
    assert.equal(normalizarTitulo("Parte 1: Revisión nocturna"), "revision nocturna");
  });

  await prueba("compararTarjetas separa igual, posible y distinta", () => {
    const base = { titulo: "Coordinador: detectar tarjetas repetidas antes de planear", detalle: "", plan: "" };
    assert.equal(compararTarjetas(base, { titulo: "T-5 Coordinador: Detectar tarjetas repetidas antes de planear (parte 2 de 3)" }).nivel, "igual");
    assert.equal(compararTarjetas(base, { titulo: "Detectar tarjetas repetidas antes de planear en el Coordinador" }).nivel, "igual");
    const posible = compararTarjetas({ titulo: "Detectar tarjetas repetidas en el tablero" }, { titulo: "Detectar tarjetas repetidas antes de planear" });
    assert.equal(posible.nivel, "posible", posible.porque);
    assert.equal(compararTarjetas(base, { titulo: "Ajustar el color del botón de WhatsApp" }).nivel, "distinta");
    // 50 % con un archivo en común: igual; con 30 % y archivo: posible.
    const conArchivo = compararTarjetas(
      { titulo: "Mejorar lista de clientes nuevos hoy", detalle: "Tocar src/app/cliente/clientes/page.tsx" },
      { titulo: "Mejorar lista de clientes", detalle: "", plan: "## 5. Archivos\n- src/app/cliente/clientes/page.tsx" },
    );
    assert.equal(conArchivo.nivel, "igual", conArchivo.porque);
    const treinta = compararTarjetas(
      { titulo: "Pantalla de pagos pendientes semanales", detalle: "src/app/cliente/pagos/page.tsx" },
      { titulo: "Pantalla de reportes mensuales detallados", detalle: "src/app/cliente/pagos/page.tsx" },
    );
    assert.notEqual(treinta.nivel, "igual");
  });

  const mia = { id: "mia", numero: 50, titulo: "Detectar tarjetas repetidas antes de planear", detalle: "", plan: null, estado: "PLANEANDO" };
  const otra = (extra) => ({ id: "otra", numero: 40, titulo: "Detectar tarjetas repetidas antes de planear", detalle: "", plan: null, estado: "APROBADO", commit: null, ...extra });

  await prueba("decidirRepetida: ya-hecha solo si el commit está en main", async () => {
    const buena = await decidirRepetida({ tarjeta: mia, parecidas: [otra({ estado: "HECHO", commit: enMain })], repo, config });
    assert.equal(buena.accion, "ya-hecha");
    assert.equal(buena.linea, `Ya lo hizo T-40 (commit ${enMain.slice(0, 7)})`);
    const mala = await decidirRepetida({ tarjeta: mia, parecidas: [otra({ estado: "HECHO", commit: fueraDeMain })], repo, config });
    assert.equal(mala.accion, "seguir", "un commit fuera de main no cuenta");
  });

  await prueba("decidirRepetida: repetida de la más vieja; si la otra es la nueva, seguir", async () => {
    const vieja = await decidirRepetida({ tarjeta: mia, parecidas: [otra()], repo, config });
    assert.equal(vieja.accion, "repetida");
    assert.equal(vieja.linea, "Repetida de T-40");
    assert.equal(vieja.detalleParaLaOtra, "");
    const nueva = await decidirRepetida({ tarjeta: mia, parecidas: [otra({ numero: 60 })], repo, config });
    assert.equal(nueva.accion, "seguir");
  });

  await prueba("decidirRepetida: esperar, posible y parejas ya revisadas", async () => {
    for (const estado of ["EN_CURSO", "SUBIENDO"]) {
      assert.equal((await decidirRepetida({ tarjeta: mia, parecidas: [otra({ estado })], repo, config })).accion, "esperar", estado);
    }
    const conFalla = await decidirRepetida({ tarjeta: mia, parecidas: [otra({ estado: "ERROR" })], repo, config });
    assert.equal(conFalla.accion, "posible");
    assert.match(conFalla.linea, /^Posible repetida de T-40: /);
    const parecida = await decidirRepetida({ tarjeta: { ...mia, titulo: "Detectar tarjetas repetidas en el tablero" }, parecidas: [otra()], repo, config });
    assert.equal(parecida.accion, "posible");
    const revisada = await decidirRepetida({ tarjeta: { ...mia, resultado: { repetidasRevisadas: [40] } }, parecidas: [otra()], repo, config });
    assert.equal(revisada.accion, "seguir");
  });

  await prueba("decidirRepetida: estado raro o sin número nunca cierra; un git roto no tumba a las demás", async () => {
    assert.equal((await decidirRepetida({ tarjeta: mia, parecidas: [otra({ estado: "IDEA" })], repo, config })).accion, "posible");
    assert.equal((await decidirRepetida({ tarjeta: mia, parecidas: [otra({ numero: undefined })], repo, config })).accion, "posible");
    const roto = { ruta: path.join(T, "no-existe"), remoto: "origin", ramaBase: "main" };
    const varias = await decidirRepetida({ tarjeta: mia, parecidas: [otra({ id: "h", estado: "HECHO", commit: enMain }), otra({ id: "p", estado: "ERROR" })], repo: roto, config });
    assert.equal(varias.accion, "posible", "con git roto el HECHO no cuenta, pero la otra sí se evalúa");
  });

  /** Un CRM falso: guarda las llamadas; `parecidas` es lo que contesta (o lanza si es un Error). */
  const crmFalso = (parecidas) => {
    const llamadas = [];
    return {
      llamadas,
      crm: {
        parecidas: async (id) => {
          llamadas.push(["parecidas", id]);
          if (parecidas instanceof Error) throw parecidas;
          return parecidas;
        },
        yaHecha: async (id, datos) => (llamadas.push(["yaHecha", id, datos]), { ok: true }),
        repetida: async (id, datos) => (llamadas.push(["repetida", id, datos]), { ok: true }),
      },
    };
  };
  const avisos = [];
  const registro = { info: () => {}, aviso: (m) => avisos.push(m), error: () => {} };

  await prueba("revisarRepetidas llama a yaHecha con repetidaDe y a repetida con su tipo", async () => {
    const hecha = crmFalso({ tarjetas: [otra({ estado: "HECHO", commit: enMain })], repetidasRevisadas: [] });
    assert.deepEqual(await revisarRepetidas({ crm: hecha.crm, config, registro, repo }, mia), { cerrada: true });
    assert.equal(hecha.llamadas[1][0], "yaHecha");
    assert.equal(hecha.llamadas[1][2].repetidaDe, "otra");
    assert.equal(hecha.llamadas[1][2].commit, enMain);

    const repetida = crmFalso({ tarjetas: [otra()], repetidasRevisadas: [] });
    assert.deepEqual(await revisarRepetidas({ crm: repetida.crm, config, registro, repo }, mia), { cerrada: true });
    assert.equal(repetida.llamadas[1][0], "repetida");
    assert.equal(repetida.llamadas[1][2].tipo, "repetida");
    assert.equal(repetida.llamadas[1][2].otraId, "otra");
    assert.equal(repetida.llamadas[1][2].linea, "Repetida de T-40");

    const posible = crmFalso({ tarjetas: [otra({ estado: "FALLIDO" })], repetidasRevisadas: [] });
    assert.deepEqual(await revisarRepetidas({ crm: posible.crm, config, registro, repo }, mia), { cerrada: true });
    assert.equal(posible.llamadas[1][2].tipo, "posible");

    const espera = crmFalso({ tarjetas: [otra({ estado: "EN_CURSO" })], repetidasRevisadas: [] });
    assert.deepEqual(await revisarRepetidas({ crm: espera.crm, config, registro, repo }, mia), { cerrada: false, esperar: "otra" });
    assert.equal(espera.llamadas.length, 1, "esperar no cambia nada en el CRM");

    const nada = crmFalso({ tarjetas: [], repetidasRevisadas: [] });
    assert.deepEqual(await revisarRepetidas({ crm: nada.crm, config, registro, repo }, mia), { cerrada: false });
  });

  await prueba("revisarRepetidas: si parecidas lanza un error, cerrada:false y un aviso", async () => {
    const roto = crmFalso(new Error("404 sin la ruta"));
    assert.deepEqual(await revisarRepetidas({ crm: roto.crm, config, registro, repo }, mia), { cerrada: false });
    assert.ok(avisos.some((aviso) => aviso.includes("404 sin la ruta")));
  });

  await prueba("recoger-errores: una posible repetida se salta", () => {
    const porCategoria = decidirRecogida({ titulo: "X", categoria: "posible_repetida", recogidas: 0, motivo: "lo que sea" });
    assert.equal(porCategoria.accion, "saltar");
    assert.equal(porCategoria.motivo, "posible repetida: decide el dueño");
    const porMotivo = decidirRecogida({ titulo: "X", recogidas: 0, motivo: "Posible repetida de T-40: comparten 100 % de las palabras", ultimoError: "se pasó de tiempo" });
    assert.equal(porMotivo.accion, "saltar");
  });

  /* ── parte 3: de punta a punta con procesar(), el Claude falso, un CRM falso y las reglas reales ── */
  const CLAUDE_LOG = path.join(T, "claude-falso.log");
  process.env.CLAUDE_FALSO_LOG = CLAUDE_LOG;
  const configE2E = { ...config, comandoClaude: [process.execPath, fileURLToPath(new URL("./claude-falso.mjs", import.meta.url))] };
  const llamadasAClaude = () => (fs.existsSync(CLAUDE_LOG) ? fs.readFileSync(CLAUDE_LOG, "utf8").trim().split("\n").filter(Boolean) : []);
  const registroE2E = () => ({ info: () => {}, aviso: (m) => avisos.push(m), error: () => {}, carpeta: null, guardarIntento: () => null });
  /** Un CRM falso para planear: anota cada llamada por su nombre; `depender` contesta `respuestaDepender`. */
  const crmDePlanear = (parecidas, respuestaDepender = { ok: true }) => {
    const base = crmFalso(parecidas);
    const llamadas = base.llamadas;
    const anotar = (nombre, respuesta = { ok: true }) => async (...args) => (llamadas.push([nombre, ...args]), respuesta);
    return {
      llamadas,
      crm: { ...base.crm, depender: anotar("depender", respuestaDepender), plan: anotar("plan", { ok: true, estado: "PLAN_LISTO" }), latido: anotar("latido") },
    };
  };
  const planear = async (crm, tarjeta) => {
    fs.rmSync(CLAUDE_LOG, { force: true });
    const carpeta = fs.mkdtempSync(path.join(T, "trabajo-"));
    const salida = await procesar({ crm, config: { ...configE2E, carpetaTrabajo: carpeta }, registro: registroE2E() }, tarjeta, "planear");
    return salida;
  };
  const nombresDe = (llamadas) => llamadas.map(([que]) => que);
  const miTarjeta = { ...mia, repo: "aizencrm", topeReparaciones: 3, reparaciones: 0, intentos: 1, ultimosIntentos: [] };

  await prueba("de punta a punta: la otra HECHO con su commit en main -> una llamada yaHecha y el Claude falso no se llama", async () => {
    const { crm, llamadas } = crmDePlanear({ tarjetas: [otra({ estado: "HECHO", commit: enMain })], repetidasRevisadas: [] });
    const salida = await planear(crm, miTarjeta);
    assert.equal(salida.ok, true);
    assert.equal(salida.repetida, true);
    const hechas = llamadas.filter(([que]) => que === "yaHecha");
    assert.equal(hechas.length, 1, JSON.stringify(nombresDe(llamadas)));
    assert.equal(hechas[0][2].repetidaDe, "otra");
    assert.ok(hechas[0][2].motivo.includes("Ya lo hizo T-40"), hechas[0][2].motivo);
    assert.ok(!nombresDe(llamadas).includes("plan"));
    assert.equal(llamadasAClaude().length, 0, "no se abrió la sesión del plan");
  });

  await prueba("de punta a punta: la otra HECHO pero su commit no está en main -> se planea normal", async () => {
    const { crm, llamadas } = crmDePlanear({ tarjetas: [otra({ estado: "HECHO", commit: fueraDeMain })], repetidasRevisadas: [] });
    await planear(crm, miTarjeta);
    assert.ok(llamadasAClaude().length > 0, "el Claude falso sí se llamó");
    assert.ok(nombresDe(llamadas).includes("plan"), JSON.stringify(nombresDe(llamadas)));
    assert.ok(!nombresDe(llamadas).includes("yaHecha"));
    assert.ok(!nombresDe(llamadas).includes("repetida"));
  });

  await prueba("de punta a punta: dos pendientes -> la nueva se cierra repetida; la vieja se planea sin llamar a repetida", async () => {
    const nueva = crmDePlanear({ tarjetas: [otra()], repetidasRevisadas: [] });
    const salida = await planear(nueva.crm, miTarjeta);
    assert.equal(salida.repetida, true);
    const cierres = nueva.llamadas.filter(([que]) => que === "repetida");
    assert.equal(cierres.length, 1);
    assert.equal(cierres[0][2].tipo, "repetida");
    assert.equal(cierres[0][2].otraId, "otra");
    assert.ok(cierres[0][2].linea.includes("Repetida de T-40"), cierres[0][2].linea);
    assert.equal(llamadasAClaude().length, 0);

    // Al planear la vieja (T-40), la nueva (T-50) es la más reciente: sigue y se planea.
    const vieja = crmDePlanear({ tarjetas: [{ ...mia, id: "mia" }].map((t) => ({ ...t, estado: "APROBADO", commit: null })), repetidasRevisadas: [] });
    await planear(vieja.crm, { ...miTarjeta, id: "otra", numero: 40, estado: "PLANEANDO" });
    assert.ok(!nombresDe(vieja.llamadas).includes("repetida"));
    assert.ok(llamadasAClaude().length > 0, "la vieja sí llama al Claude falso");
  });

  await prueba("de punta a punta: parecido dudoso -> una llamada repetida con tipo posible", async () => {
    const { crm, llamadas } = crmDePlanear({ tarjetas: [otra({ estado: "FALLIDO" })], repetidasRevisadas: [] });
    const salida = await planear(crm, miTarjeta);
    assert.equal(salida.repetida, true);
    const cierres = llamadas.filter(([que]) => que === "repetida");
    assert.equal(cierres.length, 1);
    assert.equal(cierres[0][2].tipo, "posible");
    assert.ok(cierres[0][2].linea.includes("Posible repetida de T-40"), cierres[0][2].linea);
    assert.equal(llamadasAClaude().length, 0);
  });

  await prueba("de punta a punta: si parecidas lanza un error, la tarjeta se planea igual", async () => {
    const { crm, llamadas } = crmDePlanear(new Error("500 caído"));
    await planear(crm, miTarjeta);
    assert.ok(llamadasAClaude().length > 0);
    assert.ok(nombresDe(llamadas).includes("plan"));
  });

  await prueba("de punta a punta: la otra EN_CURSO -> flecha de dependencia, esperando y sin sesión", async () => {
    const espera = { ok: true, soltada: true, esperando: "Esperando a «Detectar tarjetas repetidas antes de planear»", estado: "APROBADO" };
    const { crm, llamadas } = crmDePlanear({ tarjetas: [otra({ estado: "EN_CURSO" })], repetidasRevisadas: [] }, espera);
    const salida = await planear(crm, miTarjeta);
    const flechas = llamadas.filter(([que]) => que === "depender");
    assert.equal(flechas.length, 1);
    assert.deepEqual(flechas[0][2].referencias, ["otra"]);
    assert.ok(salida.esperando);
    assert.equal(salida.estado, "APROBADO");
    assert.equal(llamadasAClaude().length, 0);
  });

  await prueba("con las reglas reales: repetida desde PLANEANDO se acepta y su destino es FALLIDO o ERROR", () => {
    const reglas = cargar("src/features/tableros-inteligentes/services/reglas-trabajador.ts");
    assert.equal(reglas.puedeElTrabajador("repetida", "PLANEANDO"), null);
    assert.equal(reglas.puedeElTrabajador("parecidas", "PLANEANDO"), null);
    assert.notEqual(reglas.puedeElTrabajador("repetida", "EN_CURSO"), null);
    assert.equal(reglas.destinoDeRepetida("repetida"), "FALLIDO");
    assert.equal(reglas.destinoDeRepetida("posible"), "ERROR");
  });

  console.log(`\n${pruebas} pruebas ok`);
} finally {
  fs.rmSync(T, { recursive: true, force: true });
}
