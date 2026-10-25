// Pruebas de la AUTOACTUALIZACIÓN del Coordinador, sin tocar nada real:
//   node trabajador-tablero/pruebas/probar-autoactualizar.mjs   (también corre dentro de npm run test:trabajador-tablero)
//
// Usa repos git TEMPORALES (un "origin" bare, la copia del Coordinador y un clon de quien sube código) y, para
// el lanzador, un Coordinador FALSO que se porta como se le pide. El real solo se usa para probar --probar-arranque.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  actualizarCuandoSeaPosible,
  aplicarVersion,
  buscarVersionNueva,
  crearVigilanteDeVersion,
  guardarEstado,
  leerEstado,
  marcarActualizacionOk,
  rutaDelEstado,
} from "../lib/autoactualizar.mjs";
import { completarConfig } from "../lib/config.mjs";
import { crearRegistro } from "../lib/registro.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const COORDINADOR = path.resolve(AQUI, "..");
const T = fs.mkdtempSync(path.join(os.tmpdir(), "autoactualizar-"));

const ENTORNO_GIT = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t.test", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t.test" };
const git = (cwd, ...args) => execFileSync("git", args, { cwd, env: ENTORNO_GIT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const config = completarConfig({ urlCrm: "https://crm.test", claveTrabajador: "aizen_trab_x", repos: { a: { ruta: "." } } });
assert.deepEqual(config.autoactualizar, { activo: true, cadaMinutos: 10, rama: "main", remoto: "origin" });

/** Un Coordinador falso: sale 0 con --probar-arranque si `arranca`; si no, sale 1. */
const coordinadorFalso = (arranca, version) =>
  `// v${version}\nif (process.argv.includes("--probar-arranque")) process.exit(${arranca ? 0 : 1});\nconsole.log("corriendo v${version}");\n`;

/** origin (bare) + copia (la del Coordinador) + dev (quien sube). Devuelve las rutas y ayudas. */
function armarRepos(nombre) {
  const base = path.join(T, nombre);
  fs.mkdirSync(base, { recursive: true });
  const origin = path.join(base, "origin.git");
  git(base, "init", "--bare", "-b", "main", origin);
  const dev = path.join(base, "dev");
  git(base, "clone", "-q", origin, dev);
  fs.mkdirSync(path.join(dev, "trabajador-tablero"), { recursive: true });
  fs.writeFileSync(path.join(dev, "trabajador-tablero", "trabajador.mjs"), coordinadorFalso(true, 1));
  fs.writeFileSync(path.join(dev, "otra-cosa.txt"), "1\n");
  git(dev, "add", "-A");
  git(dev, "commit", "-q", "-m", "v1");
  git(dev, "branch", "-M", "main");
  git(dev, "push", "-q", "origin", "main");
  const copia = path.join(base, "copia");
  git(base, "clone", "-q", origin, copia);
  const trabajo = path.join(base, "trabajo");
  const registro = crearRegistro(trabajo, { consola: false });
  const subir = (archivo, contenido, mensaje) => {
    fs.mkdirSync(path.dirname(path.join(dev, archivo)), { recursive: true });
    fs.writeFileSync(path.join(dev, archivo), contenido);
    git(dev, "add", "-A");
    git(dev, "commit", "-q", "-m", mensaje);
    git(dev, "push", "-q", "origin", "main");
    return git(dev, "rev-parse", "HEAD");
  };
  const log = () => fs.readdirSync(path.join(trabajo, "logs")).map((f) => fs.readFileSync(path.join(trabajo, "logs", f), "utf8")).join("\n");
  return { base, origin, dev, copia, trabajo, registro, subir, log, head: () => git(copia, "rev-parse", "HEAD") };
}

try {
  await prueba("detecta versión nueva solo si toca trabajador-tablero/", async () => {
    const r = armarRepos("detecta");
    let v = await buscarVersionNueva({ repo: r.copia });
    assert.equal(v.hayNueva, false);
    const otra = r.subir("otra-cosa.txt", "2\n", "no toca el coordinador");
    v = await buscarVersionNueva({ repo: r.copia });
    assert.equal(v.hayNueva, true);
    assert.equal(v.toca, false);
    assert.equal(v.nueva, otra);
    const toca = r.subir("trabajador-tablero/trabajador.mjs", coordinadorFalso(true, 2), "toca el coordinador");
    v = await buscarVersionNueva({ repo: r.copia });
    assert.equal(v.toca, true);
    assert.equal(v.nueva, toca);
  });

  await prueba("el vigilante mira cada N minutos; si no toca el Coordinador solo trae el código y no reinicia", async () => {
    const r = armarRepos("vigilante");
    let reloj = 0;
    const vigilante = crearVigilanteDeVersion({ repo: r.copia, config, carpetaTrabajo: r.trabajo, registro: r.registro, ahora: () => reloj });
    const otra = r.subir("otra-cosa.txt", "2\n", "no toca");
    reloj = 9 * 60_000;
    assert.equal(await vigilante.revisar(), null, "a los 9 min todavía no mira");
    assert.notEqual(r.head(), otra);
    reloj = 10 * 60_000;
    assert.equal(await vigilante.revisar(), null, "no toca el Coordinador: no pide reinicio");
    assert.equal(r.head(), otra, "pero la copia quedó al día");
    assert.match(r.log(), /no toca trabajador-tablero: sigo sin reiniciar/);
    const toca = r.subir("trabajador-tablero/trabajador.mjs", coordinadorFalso(true, 2), "toca");
    reloj = 19 * 60_000;
    assert.equal(await vigilante.revisar(), null);
    reloj = 20 * 60_000;
    const hay = await vigilante.revisar();
    assert.equal(hay.nueva, toca);
    assert.equal(r.head(), otra, "detectar no cambia el código: eso lo hace aplicarVersion con 0 tarjetas");
  });

  await prueba("no se reinicia con tarjetas corriendo: espera, y solo con 0 guarda el estado y se actualiza", async () => {
    const r = armarRepos("espera");
    const toca = r.subir("trabajador-tablero/trabajador.mjs", coordinadorFalso(true, 2), "toca");
    const anterior = r.head();
    let terminar;
    const planificador = {
      corriendo: () => 2,
      esperarTodas: () => new Promise((resolver) => (terminar = resolver)),
    };
    const avisos = [];
    const pendiente = actualizarCuandoSeaPosible({
      planificador,
      repo: r.copia,
      carpetaTrabajo: r.trabajo,
      config,
      nueva: toca,
      registro: r.registro,
      avisar: async (texto) => avisos.push(texto),
    });
    await new Promise((resolver) => setTimeout(resolver, 300));
    assert.equal(r.head(), anterior, "con tarjetas corriendo no toca el código");
    assert.equal(fs.existsSync(rutaDelEstado(r.trabajo)), false);
    assert.match(r.log(), new RegExp(`versión nueva ${toca.slice(0, 8)}: espero a que terminen 2 tarjetas`));
    terminar();
    const resultado = await pendiente;
    assert.equal(resultado.resultado, "reiniciar", "con 0 tarjetas sale para reiniciar");
    assert.equal(r.head(), toca);
    const estado = leerEstado(r.trabajo);
    assert.equal(estado.estado, "probando");
    assert.equal(estado.anterior, anterior);
    assert.equal(estado.nueva, toca);
    assert.equal(estado.salioParaReiniciar, true);
    assert.ok(estado.cuando);
    assert.deepEqual(avisos, []);
    // El proceso nuevo completa su primera vuelta: "ok".
    assert.equal(marcarActualizacionOk({ carpetaTrabajo: r.trabajo, versionActual: toca, registro: r.registro }), true);
    assert.equal(leerEstado(r.trabajo).estado, "ok");
    assert.match(r.log(), new RegExp(`actualizado a ${toca.slice(0, 8)}`));
    assert.equal(marcarActualizacionOk({ carpetaTrabajo: r.trabajo, versionActual: toca, registro: r.registro }), false, "solo una vez");
  });

  await prueba("si el código nuevo no pasa --probar-arranque: vuelve a la anterior, avisa y no lo reintenta", async () => {
    const r = armarRepos("revierte");
    const anterior = r.head();
    const mala = r.subir("trabajador-tablero/trabajador.mjs", coordinadorFalso(false, 2), "roto");
    const avisos = [];
    const resultado = await aplicarVersion({
      repo: r.copia,
      carpetaTrabajo: r.trabajo,
      config,
      nueva: mala,
      registro: r.registro,
      avisar: async (texto) => avisos.push(texto),
    });
    assert.equal(resultado.resultado, "revertida");
    assert.equal(r.head(), anterior, "git reset --hard a la versión anterior");
    assert.equal(fs.readFileSync(path.join(r.copia, "trabajador-tablero", "trabajador.mjs"), "utf8").replaceAll(String.fromCharCode(13), ""), coordinadorFalso(true, 1));
    assert.equal(avisos.length, 1);
    assert.match(avisos[0], new RegExp(`${mala.slice(0, 8)}.*no arrancó.*${anterior.slice(0, 8)}`));
    assert.ok(!avisos[0].includes("\n"), "el aviso es de una línea");
    const estado = leerEstado(r.trabajo);
    assert.equal(estado.estado, "revertida");
    assert.equal(estado.rechazada, mala);
    // El vigilante no vuelve a probar la misma versión mala cada 10 minutos.
    let reloj = 0;
    const vigilante = crearVigilanteDeVersion({ repo: r.copia, config, carpetaTrabajo: r.trabajo, registro: r.registro, ahora: () => reloj });
    reloj = 11 * 60_000;
    assert.equal(await vigilante.revisar(), null);
    // Pero una versión nueva distinta sí.
    const buena = r.subir("trabajador-tablero/trabajador.mjs", coordinadorFalso(true, 3), "arreglo");
    reloj = 22 * 60_000;
    assert.equal((await vigilante.revisar()).nueva, buena);
  });

  await prueba("si el aviso por WhatsApp falla (412 sin número), igual revierte y lo anota", async () => {
    const r = armarRepos("aviso-412");
    const anterior = r.head();
    const mala = r.subir("trabajador-tablero/trabajador.mjs", coordinadorFalso(false, 2), "roto");
    const resultado = await aplicarVersion({
      repo: r.copia,
      carpetaTrabajo: r.trabajo,
      config,
      nueva: mala,
      registro: r.registro,
      avisar: async () => {
        throw new Error("El CRM contestó 412.");
      },
    });
    assert.equal(resultado.resultado, "revertida");
    assert.equal(r.head(), anterior);
    assert.match(r.log(), /no se pudo avisar por WhatsApp \(El CRM contestó 412\.\)/);
  });

  await prueba("copia con cambios locales: no actualiza, avisa y no pierde los cambios", async () => {
    const r = armarRepos("sucia");
    const anterior = r.head();
    const toca = r.subir("trabajador-tablero/trabajador.mjs", coordinadorFalso(true, 2), "toca");
    fs.appendFileSync(path.join(r.copia, "otra-cosa.txt"), "cambio a mano\n");
    const avisos = [];
    const resultado = await aplicarVersion({ repo: r.copia, carpetaTrabajo: r.trabajo, config, nueva: toca, registro: r.registro, avisar: async (t) => avisos.push(t) });
    assert.equal(resultado.resultado, "no-actualiza");
    assert.equal(r.head(), anterior);
    assert.match(fs.readFileSync(path.join(r.copia, "otra-cosa.txt"), "utf8"), /cambio a mano/);
    assert.equal(avisos.length, 1);
    assert.match(avisos[0], /cambios locales/);
    assert.equal(leerEstado(r.trabajo).estado, "no-actualizada");
  });

  await prueba("sin fast-forward (la copia tiene un commit propio): no actualiza y avisa", async () => {
    const r = armarRepos("sin-ff");
    fs.writeFileSync(path.join(r.copia, "propio.txt"), "x\n");
    git(r.copia, "add", "-A");
    git(r.copia, "commit", "-q", "-m", "commit propio");
    const anterior = r.head();
    const toca = r.subir("trabajador-tablero/trabajador.mjs", coordinadorFalso(true, 2), "toca");
    const avisos = [];
    const resultado = await aplicarVersion({ repo: r.copia, carpetaTrabajo: r.trabajo, config, nueva: toca, registro: r.registro, avisar: async (t) => avisos.push(t) });
    assert.equal(resultado.resultado, "no-actualiza");
    assert.equal(r.head(), anterior, "no deshace el commit propio");
    assert.match(avisos[0], /pull --ff-only/);
  });

  await prueba("--probar-arranque del Coordinador real: sale 0 con la config buena y falla si un módulo no carga", async () => {
    const carpetaConfig = path.join(T, "config-real");
    fs.mkdirSync(carpetaConfig, { recursive: true });
    const rutaConfig = path.join(carpetaConfig, "config.json");
    fs.writeFileSync(rutaConfig, JSON.stringify({ urlCrm: "https://crm.test", claveTrabajador: "aizen_trab_x", carpetaTrabajo: "./trabajo", repos: { a: { ruta: "." } } }));
    const bueno = spawnSync(process.execPath, [path.join(COORDINADOR, "trabajador.mjs"), "--probar-arranque", "--config", rutaConfig], { encoding: "utf8" });
    assert.equal(bueno.status, 0, bueno.stderr);
    assert.equal(fs.existsSync(path.join(carpetaConfig, "trabajo")), false, "no crea carpetas ni toma tarjetas");
    // Una copia del Coordinador con un módulo roto.
    const copia = path.join(T, "coordinador-roto");
    fs.cpSync(COORDINADOR, copia, { recursive: true, filter: (origen) => !origen.includes(`${path.sep}pruebas`) && !origen.endsWith("config.local.json") });
    fs.writeFileSync(path.join(copia, "lib", "modulo-roto.mjs"), "import { noExiste } from './no-existe.mjs';\nexport default noExiste;\n");
    const malo = spawnSync(process.execPath, [path.join(copia, "trabajador.mjs"), "--probar-arranque", "--config", rutaConfig], { encoding: "utf8" });
    assert.notEqual(malo.status, 0);
    // Y con una config mala.
    fs.writeFileSync(rutaConfig, "{no es json");
    const sinConfig = spawnSync(process.execPath, [path.join(COORDINADOR, "trabajador.mjs"), "--probar-arranque", "--config", rutaConfig], { encoding: "utf8" });
    assert.notEqual(sinConfig.status, 0);
  });

  // ── el lanzador (con un Coordinador falso y un repo temporal) ─────────────────────────
  function armarLanzador(nombre) {
    const r = armarRepos(nombre);
    const carpetaConfig = path.join(r.base, "cfg");
    fs.mkdirSync(carpetaConfig, { recursive: true });
    const rutaConfig = path.join(carpetaConfig, "config.json");
    fs.writeFileSync(rutaConfig, JSON.stringify({ urlCrm: "http://127.0.0.1:1", claveTrabajador: "aizen_trab_x", carpetaTrabajo: r.trabajo }));
    const correr = () =>
      spawnSync(process.execPath, [path.join(COORDINADOR, "lanzador.mjs"), "--config", rutaConfig], {
        encoding: "utf8",
        timeout: 60_000,
        env: {
          ...process.env,
          LANZADOR_REPO: r.copia,
          LANZADOR_SCRIPT: path.join(r.copia, "trabajador-tablero", "trabajador.mjs"),
          LANZADOR_VENTANA_MINUTOS: "3",
        },
      });
    return { ...r, correr };
  }

  await prueba("lanzador: si el Coordinador recién actualizado se cae al arrancar, vuelve a la versión anterior", async () => {
    const r = armarLanzador("lanzador-revierte");
    const anterior = r.head();
    // La versión nueva pasa --probar-arranque pero se cae al correr de verdad (por ejemplo un import tardío).
    const caida = `if (process.argv.includes("--probar-arranque")) process.exit(0);\nconsole.error("se cae al arrancar");\nprocess.exit(3);\n`;
    const nueva = r.subir("trabajador-tablero/trabajador.mjs", caida, "se cae");
    git(r.copia, "pull", "-q", "--ff-only", "origin", "main");
    // Lo que deja el Coordinador viejo al salir para actualizarse.
    guardarEstado(r.trabajo, { anterior, nueva, cuando: new Date().toISOString(), estado: "probando", salioParaReiniciar: true });
    // El lanzador necesita un Coordinador "viejo" que corra y salga 0: la primera ejecución es el que se cae.
    // Como el estado ya dice salioParaReiniciar, la primera salida (código 3) NO es un reinicio: se simula
    // pasando por el relanzamiento con un script que primero sale 0.
    const guion = path.join(r.copia, "trabajador-tablero", "trabajador.mjs");
    fs.writeFileSync(
      guion,
      `import fs from "node:fs";\nconst marca = ${JSON.stringify(path.join(r.base, "marca"))};\n` +
        `if (!fs.existsSync(marca)) { fs.writeFileSync(marca, "1"); process.exit(0); }\n` +
        `console.error("se cae al arrancar"); process.exit(3);\n`,
    );
    // El guion de arriba es una edición local de la copia; el reset --hard la deshace igual que a cualquier cambio.
    const resultado = r.correr();
    assert.equal(r.head(), anterior, resultado.stdout + resultado.stderr);
    const estado = leerEstado(r.trabajo);
    assert.equal(estado.estado, "revertida");
    assert.equal(estado.rechazada, nueva);
    // Quedó la versión vieja, que arranca y sale 0.
    assert.equal(resultado.status, 0);
    assert.match(fs.readFileSync(path.join(r.trabajo, "logs", "lanzador.log"), "utf8"), /se cayó a los .* min \(código 3\)/);
    assert.match(fs.readFileSync(path.join(r.trabajo, "logs", "lanzador.log"), "utf8"), /el aviso por WhatsApp no salió/, "intentó avisar con fetch directo (aquí no hay CRM)");
  });

  await prueba("lanzador: si el nuevo arranca bien (estado ok), una salida posterior no revierte nada", async () => {
    const r = armarLanzador("lanzador-ok");
    const anterior = r.head();
    const nueva = r.subir("trabajador-tablero/trabajador.mjs", "process.exit(5);\n", "sale con error");
    git(r.copia, "pull", "-q", "--ff-only", "origin", "main");
    guardarEstado(r.trabajo, { anterior, nueva, cuando: new Date().toISOString(), estado: "ok", lanzado: true });
    const resultado = r.correr();
    assert.equal(resultado.status, 5);
    assert.equal(r.head(), nueva);
    assert.equal(leerEstado(r.trabajo).estado, "ok");
  });

  await prueba("lanzador: tras salir con 0 para actualizarse, relanza ya con el código nuevo", async () => {
    const r = armarLanzador("lanzador-relanza");
    const anterior = r.head();
    const nueva = r.subir("trabajador-tablero/trabajador.mjs", `console.log("hola desde la nueva");\nimport fs from "node:fs";\nfs.writeFileSync(${JSON.stringify(path.join(r.base, "corrio-nueva"))}, "1");\nprocess.exit(9);\n`, "nueva");
    git(r.copia, "pull", "-q", "--ff-only", "origin", "main");
    // Simula que el Coordinador viejo ya se actualizó y salió: el estado lo dice; el lanzador corre un script que sale 0 la primera vez.
    guardarEstado(r.trabajo, { anterior, nueva, cuando: new Date().toISOString(), estado: "probando", salioParaReiniciar: true });
    const guion = path.join(r.copia, "trabajador-tablero", "trabajador.mjs");
    const m = JSON.stringify(path.join(r.base, "m"));
    fs.writeFileSync(
      guion,
      `import fs from "node:fs";
if (!fs.existsSync(${m})) { fs.writeFileSync(${m}, "1"); process.exit(0); }
fs.writeFileSync(${JSON.stringify(path.join(r.base, "corrio-nueva"))}, "1");
process.exit(9);
`,
    );
    const resultado = r.correr();
    assert.ok(fs.existsSync(path.join(r.base, "corrio-nueva")), "la segunda corrida fue de inmediato, sin esperar a la tarea");
    assert.match(fs.readFileSync(path.join(r.trabajo, "logs", "lanzador.log"), "utf8"), /lo arranco de nuevo/);
    // La nueva sale con 9 a los pocos segundos con estado "probando" ya lanzado: se considera caída y revierte.
    assert.equal(leerEstado(r.trabajo).estado, "revertida");
    assert.equal(r.head(), anterior, resultado.stdout + resultado.stderr);
  });
} finally {
  try {
    fs.rmSync(T, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    // Windows a veces tiene un archivo abierto un instante: queda en la carpeta temporal.
  }
}

console.log(`\n${pruebas} pruebas de autoactualizar, todas bien`);
