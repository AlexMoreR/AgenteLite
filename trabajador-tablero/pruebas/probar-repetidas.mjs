// Pruebas de las TARJETAS REPETIDAS del Coordinador (27-nov-2026), parte 2 de 3: comparar dos tarjetas, decidir qué hacer con
// la tarjeta según sus parecidas, la llamada al CRM y la recogida de una posible repetida. Sin red de verdad ni CRM:
//   node trabajador-tablero/pruebas/probar-repetidas.mjs   (también corre dentro de npm run test:trabajador-tablero)
// El git falso es un repo con su "origin" en una carpeta temporal: un commit está en main y otro solo en una rama.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { completarConfig } from "../lib/config.mjs";
import { decidirRecogida } from "../lib/recoger-errores.mjs";
import { REPETIDAS_POR_DEFECTO, compararTarjetas, decidirRepetida, normalizarTitulo, revisarRepetidas } from "../lib/repetidas.mjs";

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
fs.writeFileSync(path.join(RUTA, "a.txt"), "lo de la otra tarjeta\n");
g(RUTA, "commit", "-am", "tablero: banner de bienvenida");
const EN_MAIN = g(RUTA, "rev-parse", "HEAD");
g(RUTA, "remote", "add", "origin", REMOTO);
g(RUTA, "push", "-q", "-u", "origin", "main");
g(RUTA, "checkout", "-q", "-b", "otra-rama");
fs.writeFileSync(path.join(RUTA, "b.txt"), "sin subir\n");
g(RUTA, "add", "-A");
g(RUTA, "commit", "-m", "a medias");
const FUERA = g(RUTA, "rev-parse", "HEAD");
g(RUTA, "checkout", "-q", "main");
const repo = { ruta: RUTA, remoto: "origin", ramaBase: "main" };

const config = { repetidas: { ...REPETIDAS_POR_DEFECTO } };
const tarjeta = {
  id: "nueva",
  numero: 50,
  estado: "PLANEANDO",
  repo: "aizencrm",
  titulo: "Agregar banner de bienvenida en la portada del cliente",
  detalle: "Poner un banner en src/app/cliente/page.tsx con el saludo.",
  plan: null,
};
const otra = (cambios) => ({
  id: "otra",
  numero: 40,
  codigo: "T-40",
  titulo: tarjeta.titulo,
  detalle: "",
  estado: "APROBADO",
  plan: null,
  commit: null,
  creadaEn: "2026-11-20T00:00:00.000Z",
  ...cambios,
});

try {
  await prueba("normalizarTitulo: minúsculas, sin tildes ni signos, sin «Parte N» al comienzo ni T-123", () => {
    assert.equal(normalizarTitulo("Parte 2: ¡Arreglar la Búsqueda! (T-123)"), "arreglar la busqueda");
    assert.equal(normalizarTitulo("parte 1 de 3 — Menú del CRM"), "menu del crm");
    assert.equal(normalizarTitulo(""), "");
  });

  await prueba("compararTarjetas: igual por título, por palabras y por palabras con archivo", () => {
    assert.equal(compararTarjetas({ titulo: "Arreglar la búsqueda de chats" }, { titulo: "T-7 arreglar la BUSQUEDA de chats." }).nivel, "igual");
    // 4 de 5 palabras en las dos direcciones (80 %).
    const a = { titulo: "Mostrar total ventas semana tablero panel" };
    const b = { titulo: "Mostrar total ventas semana tablero resumen" };
    assert.equal(compararTarjetas(a, b).nivel, "igual", compararTarjetas(a, b).porque);
    // 2 de 4 (50 %) y un archivo en común (del detalle de una y del plan de la otra).
    const c = { titulo: "Ventas semana botón exportar", detalle: "Tocar src/lib/ventas.ts" };
    const d = { titulo: "Ventas semana gráfico barras", plan: "Archivos:\n1. src/lib/ventas.ts" };
    const r = compararTarjetas(c, d);
    assert.equal(r.nivel, "igual", r.porque);
    assert.match(r.porque, /50 %.*src\/lib\/ventas\.ts/);
  });

  await prueba("compararTarjetas: posible sin archivo (50 a 80 %) y con archivo (30 % o más)", () => {
    const sinArchivo = compararTarjetas({ titulo: "Ventas semana botón exportar" }, { titulo: "Ventas semana gráfico barras" });
    assert.equal(sinArchivo.nivel, "posible", sinArchivo.porque);
    const conArchivo = compararTarjetas(
      { titulo: "Ventas mensuales filtro vendedor ciudad", detalle: "src/lib/ventas.ts" },
      { titulo: "Ventas mensuales gráfico barras colores", detalle: "src/lib/ventas.ts" },
    );
    assert.equal(conArchivo.nivel, "posible", conArchivo.porque);
  });

  await prueba("compararTarjetas: distinta, y package.json o el manual no cuentan como archivo en común", () => {
    assert.equal(compararTarjetas({ titulo: "Arreglar la búsqueda de chats" }, { titulo: "Cambiar el color del menú lateral" }).nivel, "distinta");
    const r = compararTarjetas(
      { titulo: "Ventas mensuales filtro vendedor ciudad", detalle: "package.json docs/que-es-esta-aplicacion.md" },
      { titulo: "Ventas mensuales gráfico barras colores", detalle: "package.json docs/que-es-esta-aplicacion.md" },
    );
    assert.equal(r.nivel, "distinta", r.porque);
  });

  await prueba("config: el bloque repetidas trae los valores por defecto y se puede sobrescribir", () => {
    const base = { urlCrm: "https://crm.test", claveTrabajador: "aizen_trab_x", repos: { a: { ruta: "." } } };
    assert.deepEqual(completarConfig(base).repetidas, REPETIDAS_POR_DEFECTO);
    const cambiada = completarConfig({ ...base, repetidas: { igualPalabras: 0.9 } });
    assert.equal(cambiada.repetidas.igualPalabras, 0.9);
    assert.equal(cambiada.repetidas.dias, 30);
    assert.throws(() => completarConfig({ ...base, repetidas: { posibleConArchivo: 2 } }), /repetidas\.posibleConArchivo/);
  });

  await prueba("decidirRepetida: la otra HECHO con su commit en main -> ya-hecha «Ya lo hizo T-40 (commit …)»", async () => {
    const d = await decidirRepetida({ tarjeta, parecidas: { tarjetas: [otra({ estado: "HECHO", commit: EN_MAIN })], repetidasRevisadas: [] }, repo, config });
    assert.equal(d.accion, "ya-hecha");
    assert.equal(d.commit, EN_MAIN);
    assert.equal(d.linea, `Ya lo hizo T-40 (commit ${EN_MAIN.slice(0, 7)})`);
  });

  await prueba("decidirRepetida: la otra HECHO con un commit que NO está en main no cuenta -> seguir", async () => {
    const d = await decidirRepetida({ tarjeta, parecidas: { tarjetas: [otra({ estado: "HECHO", commit: FUERA })] }, repo, config });
    assert.equal(d.accion, "seguir", JSON.stringify(d));
  });

  await prueba("decidirRepetida: las dos pendientes y la otra es más vieja -> repetida «Repetida de T-40» con el detalle", async () => {
    const d = await decidirRepetida({ tarjeta, parecidas: { tarjetas: [otra({ estado: "PLAN_APROBADO" })] }, repo, config });
    assert.equal(d.accion, "repetida");
    assert.equal(d.linea, "Repetida de T-40");
    assert.equal(d.otra.id, "otra");
    assert.equal(d.detalleParaLaOtra, tarjeta.detalle);
  });

  await prueba("decidirRepetida: si la otra es la nueva (número mayor) -> seguir", async () => {
    const d = await decidirRepetida({ tarjeta, parecidas: { tarjetas: [otra({ numero: 60, codigo: "T-60" })] }, repo, config });
    assert.equal(d.accion, "seguir");
  });

  await prueba("decidirRepetida: la otra EN_CURSO o SUBIENDO -> esperar", async () => {
    for (const estado of ["EN_CURSO", "SUBIENDO"]) {
      const d = await decidirRepetida({ tarjeta, parecidas: { tarjetas: [otra({ estado })] }, repo, config });
      assert.equal(d.accion, "esperar", estado);
      assert.equal(d.otra.id, "otra");
    }
  });

  await prueba("decidirRepetida: un parecido posible, o igual con la otra en ERROR o FALLIDO -> posible «Posible repetida de T-40: …»", async () => {
    for (const estado of ["ERROR", "FALLIDO"]) {
      const d = await decidirRepetida({ tarjeta, parecidas: { tarjetas: [otra({ estado })] }, repo, config });
      assert.equal(d.accion, "posible", estado);
      assert.match(d.linea, /^Posible repetida de T-40: /);
    }
    const d = await decidirRepetida({ tarjeta, parecidas: { tarjetas: [otra({ titulo: "Agregar banner de bienvenida en el correo" })] }, repo, config });
    assert.equal(d.accion, "posible", JSON.stringify(d));
    assert.match(d.linea, /^Posible repetida de T-40: comparten el \d+ % de las palabras/);
  });

  await prueba("decidirRepetida: salta las parejas de repetidasRevisadas y lo distinto -> seguir", async () => {
    const revisada = await decidirRepetida({ tarjeta, parecidas: { tarjetas: [otra({ estado: "PLAN_APROBADO" })], repetidasRevisadas: [40] }, repo, config });
    assert.equal(revisada.accion, "seguir");
    const enLaTarjeta = await decidirRepetida({ tarjeta: { ...tarjeta, resultado: { repetidasRevisadas: [40] } }, parecidas: [otra({})], repo, config });
    assert.equal(enLaTarjeta.accion, "seguir");
    const distinta = await decidirRepetida({ tarjeta, parecidas: { tarjetas: [otra({ titulo: "Cambiar el color del menú lateral" })] }, repo, config });
    assert.equal(distinta.accion, "seguir");
  });

  const crmFalso = (parecidas) => {
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
  };
  const registroFalso = () => {
    const avisos = [];
    return { avisos, info: () => {}, aviso: (texto) => avisos.push(texto) };
  };

  await prueba("revisarRepetidas: ya-hecha llama a crm.yaHecha con repetidaDe y queda cerrada", async () => {
    const crm = crmFalso({ tarjetas: [otra({ estado: "HECHO", commit: EN_MAIN })], repetidasRevisadas: [] });
    const r = await revisarRepetidas({ crm, config, registro: registroFalso(), repo }, tarjeta);
    assert.equal(r.cerrada, true);
    const [que, id, datos] = crm.llamadas.at(-1);
    assert.equal(que, "yaHecha");
    assert.equal(id, "nueva");
    assert.equal(datos.repetidaDe, "otra");
    assert.equal(datos.commit, EN_MAIN);
  });

  await prueba("revisarRepetidas: repetida y posible llaman a crm.repetida con su tipo", async () => {
    for (const [estado, tipo] of [["APROBADO", "repetida"], ["ERROR", "posible"]]) {
      const crm = crmFalso({ tarjetas: [otra({ estado })] });
      const r = await revisarRepetidas({ crm, config, registro: registroFalso(), repo }, tarjeta);
      assert.equal(r.cerrada, true, tipo);
      const [que, , datos] = crm.llamadas.at(-1);
      assert.equal(que, "repetida");
      assert.equal(datos.tipo, tipo);
      assert.equal(datos.otraId, "otra");
      assert.ok(datos.linea);
    }
  });

  await prueba("revisarRepetidas: esperar devuelve el id de la otra sin llamar al CRM; seguir no cierra", async () => {
    const crm = crmFalso({ tarjetas: [otra({ estado: "EN_CURSO" })] });
    assert.deepEqual((({ cerrada, esperar }) => ({ cerrada, esperar }))(await revisarRepetidas({ crm, config, registro: registroFalso(), repo }, tarjeta)), { cerrada: false, esperar: "otra" });
    assert.deepEqual(crm.llamadas.map(([que]) => que), ["parecidas"]);
    const vacio = crmFalso({ tarjetas: [] });
    assert.equal((await revisarRepetidas({ crm: vacio, config, registro: registroFalso(), repo }, tarjeta)).cerrada, false);
  });

  await prueba("revisarRepetidas: si parecidas falla (CRM viejo o sin red) deja un aviso y devuelve cerrada:false", async () => {
    const crm = crmFalso(new Error("404 ruta desconocida"));
    const registro = registroFalso();
    const r = await revisarRepetidas({ crm, config, registro, repo }, tarjeta);
    assert.deepEqual(r, { cerrada: false });
    assert.equal(registro.avisos.length, 1);
    assert.match(registro.avisos[0], /se planea igual/);
    // Y si git falla (la carpeta del repo no existe), tampoco frena.
    const conGitRoto = await revisarRepetidas(
      { crm: crmFalso({ tarjetas: [otra({ estado: "HECHO", commit: EN_MAIN })] }), config, registro: registroFalso(), repo: { ...repo, ruta: path.join(T, "no-existe") } },
      tarjeta,
    );
    assert.equal(conGitRoto.cerrada, false);
  });

  await prueba("recoger-errores: una posible repetida se salta (decide el dueño), aunque nunca se haya recogido", () => {
    const enError = { titulo: "x", plan: null, recogidas: 0, motivo: "Posible repetida de T-40: comparten el 60 % de las palabras del título", ultimoError: null, ultimosIntentos: [] };
    const d = decidirRecogida(enError);
    assert.equal(d.accion, "saltar");
    assert.equal(d.motivo, "posible repetida: decide el dueño");
    assert.equal(d.categoria, "posible_repetida");
    assert.equal(decidirRecogida({ ...enError, motivo: "algo", categoria: "posible_repetida" }).accion, "saltar");
    // Lo demás sigue igual: un error desconocido se reintenta una vez.
    assert.equal(decidirRecogida({ ...enError, motivo: "se cayó algo raro" }).accion, "reintentar");
  });

  console.log(`\n${pruebas} pruebas OK`);
} catch (error) {
  console.error(`not ok - ${error?.stack ?? error}`);
  process.exitCode = 1;
} finally {
  fs.rmSync(T, { recursive: true, force: true, maxRetries: 3 });
}
