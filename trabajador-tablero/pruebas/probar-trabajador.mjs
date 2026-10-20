// Pruebas del TRABAJADOR del Tablero IA, de punta a punta y sin tocar nada real:
//   npm run test:trabajador-tablero
//
// - un CRM FALSO (servidor HTTP local en esta prueba) con la misma máquina de estados que la API real
//   (usa TRANSICIONES_DEL_TRABAJADOR y AL_TOMAR de services/reglas-trabajador.ts);
// - un repo git TEMPORAL de ensayo con su "GitHub" (un repo bare local: los push van ahí);
// - `claude`, `ssh` y `gh` FALSOS (pruebas/*-falso.mjs) en vez de los de verdad.
// Recorre PLANEANDO -> PLAN_LISTO -> EN_CURSO -> POR_REVISAR -> SUBIENDO -> HECHO y los casos de ERROR:
// tiempo máximo, zona protegida, verificación (tsc) que falla, lint nuevo, conflicto al subir, Claude
// que no cambia nada, y el vencimiento por latido.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { cargar } from "../../scripts/supervisor-cargar.mjs";
import { unaVuelta } from "../lib/bucle.mjs";
import { completarConfig } from "../lib/config.mjs";
import { crearCrm } from "../lib/crm.mjs";
import { guionDeEnsayo, sqlParaEnsayo } from "../lib/ensayo.mjs";
import { esRamaDelTrabajador, nombreDeRama, webDeGithub } from "../lib/git.mjs";
import { crearRegistro } from "../lib/registro.mjs";
import { globARegex, zonasTocadas } from "../lib/zonas.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const reglas = cargar("src/features/tableros-inteligentes/services/reglas-trabajador.ts");

let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

/* ─────────────────────────────────────────────────────────── piezas puras ── */

await prueba("zonas: globs simples y qué zonas toca un cambio", async () => {
  assert.ok(globARegex("src/bot/**").test("src/bot/a/b.ts"));
  assert.ok(globARegex("src/**/agente*.ts").test("src/agente-v3.ts"));
  assert.ok(globARegex("src/**/agente*.ts").test("src/lib/x/agente-v3.ts"));
  assert.ok(!globARegex("src/*.ts").test("src/lib/a.ts"));
  assert.deepEqual(zonasTocadas(["src/bot/x.ts", "README.md", "src\\v3\\libro.ts"], { BOT_VENTAS: ["src/bot/**"], LIBRO_V3: ["src/v3/**"], META_ADS: ["ads/**"] }), {
    BOT_VENTAS: ["src/bot/x.ts"],
    LIBRO_V3: ["src\\v3\\libro.ts"],
  });
});

await prueba("ensayo: se quitan BEGIN/COMMIT del archivo, va dentro de BEGIN…ROLLBACK con ON_ERROR_STOP y lock_timeout", async () => {
  const guion = guionDeEnsayo('BEGIN;\nDO $$ BEGIN\n  CREATE TYPE "X" AS ENUM (\'A\');\nEXCEPTION WHEN duplicate_object THEN NULL;\nEND $$;\nCOMMIT;\n');
  assert.match(guion, /^\\set ON_ERROR_STOP on\nSET lock_timeout = '5s';\nBEGIN;\n/);
  assert.match(guion, /ROLLBACK;\n$/);
  assert.ok(!/^COMMIT;$/m.test(guion));
  assert.equal((guion.match(/^BEGIN;$/gm) ?? []).length, 1);
  assert.throws(() => sqlParaEnsayo("BEGIN;\nSELECT 1; COMMIT; SELECT 2;\nCOMMIT;"), /COMMIT/);
  assert.throws(() => sqlParaEnsayo("CREATE INDEX CONCURRENTLY x ON y (z);"), /CONCURRENTLY/);
});

await prueba("ramas y links: tablero/<id>-<slug>, solo esas se empujan, link de GitHub", async () => {
  assert.equal(nombreDeRama({ id: "cm9abc12345678", titulo: "Envío gratis 50/50 ¡ya!" }), "tablero/12345678-envio-gratis-50-50-ya");
  assert.ok(esRamaDelTrabajador("tablero/123-x"));
  assert.ok(!esRamaDelTrabajador("main"));
  assert.ok(!esRamaDelTrabajador("tablero/../main"));
  assert.equal(webDeGithub("https://github.com/AlexMoreR/AgenteLite.git"), "https://github.com/AlexMoreR/AgenteLite");
  assert.equal(webDeGithub("git@github.com:AlexMoreR/Gestion.git"), "https://github.com/AlexMoreR/Gestion");
  assert.equal(webDeGithub("C:/tmp/remoto.git"), null);
});

await prueba("configuración: exige https, la clave y un repo; agrega las herramientas prohibidas siempre", async () => {
  assert.throws(() => completarConfig({ urlCrm: "http://app.aizenbot.com", claveTrabajador: "aizen_trab_x", repos: { a: { ruta: "." } } }), /https/);
  assert.throws(() => completarConfig({ urlCrm: "https://app.aizenbot.com", claveTrabajador: "otra", repos: { a: { ruta: "." } } }), /claveTrabajador/);
  assert.throws(() => completarConfig({ urlCrm: "https://app.aizenbot.com", claveTrabajador: "aizen_trab_x" }), /repos/);
  const config = completarConfig({
    urlCrm: "https://app.aizenbot.com/",
    claveTrabajador: "aizen_trab_x",
    repos: { aizencrm: { ruta: "." } },
    herramientasProhibidas: ["Bash(rm:*)"],
  });
  assert.equal(config.urlCrm, "https://app.aizenbot.com");
  assert.ok(config.herramientasProhibidas.includes("Bash(git push:*)"));
  assert.ok(config.herramientasProhibidas.includes("Bash(rm:*)"));
  assert.ok(!config.herramientasPermitidas.some((h) => /push|migrate|db push/.test(h)));
});

/* ─────────────────────────────────────────────────────────── el escenario ── */

const T = fs.mkdtempSync(path.join(os.tmpdir(), "trabajador-tablero-"));
const REMOTO = path.join(T, "remoto.git");
const REPO = path.join(T, "repo");
const LOGS = { claude: path.join(T, "claude.log"), ssh: path.join(T, "ssh.log"), gh: path.join(T, "gh.log") };
process.env.CLAUDE_FALSO_LOG = LOGS.claude;
process.env.SSH_FALSO_LOG = LOGS.ssh;
process.env.GH_FALSO_LOG = LOGS.gh;

const g = (cwd, ...args) =>
  execFileSync("git", ["-c", "user.name=Prueba", "-c", "user.email=prueba@x.co", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

fs.mkdirSync(REPO);
execFileSync("git", ["init", "--bare", "-b", "main", REMOTO], { stdio: "ignore" });
g(REPO, "init", "-b", "main");
const archivo = (relativo, texto) => {
  fs.mkdirSync(path.dirname(path.join(REPO, relativo)), { recursive: true });
  fs.writeFileSync(path.join(REPO, relativo), texto);
};
archivo("package.json", '{ "name": "repo-de-prueba", "private": true }\n');
archivo("verificar.mjs", 'import fs from "node:fs";\nif (fs.existsSync("ROMPER_TSC")) { console.error("error TS2322: el tipo no calza"); process.exit(1); }\nconsole.log("tsc ok");\n');
archivo(
  "lint.mjs",
  [
    'import fs from "node:fs"; import path from "node:path";',
    "const salida = [];",
    'const recorrer = (d) => { for (const n of fs.readdirSync(d)) { if (n === ".git" || n === "node_modules") continue; const p = path.join(d, n);',
    '  if (fs.statSync(p).isDirectory()) recorrer(p); else if (fs.readFileSync(p, "utf8").includes("ERROR_" + "LINT")) salida.push({ filePath: path.resolve(p), messages: [{ severity: 2, ruleId: "regla-falsa", message: "error de lint" }] }); } };',
    'recorrer("."); console.log(JSON.stringify(salida)); process.exit(salida.length ? 1 : 0);',
  ].join("\n"),
);
archivo(
  "ensayo.mjs",
  'import fs from "node:fs";\nconst c = "prisma/migrations";\nfor (const d of fs.readdirSync(c)) { if (fs.readFileSync(`${c}/${d}/migration.sql`, "utf8").includes("FALLA_PGLITE")) { console.error("falló " + d); process.exit(1); } }\nconsole.log("pglite ok");\n',
);
archivo("viejo.txt", "ERROR_LINT (ya estaba en main: no cuenta)\n");
archivo("conflicto.txt", "lo de main\n");
archivo("prisma/migrations/20260101000000_base/migration.sql", "SELECT 1;\n");
g(REPO, "add", "-A");
g(REPO, "commit", "-m", "base");
g(REPO, "remote", "add", "origin", REMOTO);
g(REPO, "push", "-u", "origin", "main");

const shaDe = (ref) => execFileSync("git", ["--git-dir", REMOTO, "rev-parse", ref], { encoding: "utf8" }).trim();
const ramasDelRemoto = () =>
  execFileSync("git", ["--git-dir", REMOTO, "for-each-ref", "--format=%(refname:short)", "refs/heads"], { encoding: "utf8" })
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);

/* ── El CRM falso: la misma máquina de estados que /api/trabajador/tablero ── */

const CLAVE = "aizen_trab_prueba";
const tarjetas = new Map();
const llamadas = [];
const latidoVencido = new Set();
let siguienteId = 1;
const nueva = (titulo, estado, extra = {}) => {
  const id = `tarjeta${String(siguienteId++).padStart(4, "0")}`;
  tarjetas.set(id, { id, titulo, detalle: "", tablero: "Pruebas", estado, repo: "aizencrm", plan: null, resultado: null, zonaProtegida: [], intentos: 0, venceEn: null, ...extra });
  return id;
};
const paraElTrabajador = (t) => ({ ...t, zonasAprobadas: t.zonaProtegida, link: `https://crm.falso/cliente/tablero-ia?tarjeta=${t.id}` });

const servidor = http.createServer(async (pedido, respuesta) => {
  const contestar = (codigo, datos) => {
    respuesta.writeHead(codigo, { "Content-Type": "application/json" });
    respuesta.end(JSON.stringify(datos));
  };
  if (pedido.method === "GET" && pedido.url === "/api/version") return contestar(200, { version: shaDe("main") });
  if (pedido.headers.authorization !== `Bearer ${CLAVE}`) return contestar(401, { ok: false, error: "Clave inválida" });
  let texto = "";
  for await (const pedazo of pedido) texto += pedazo;
  const cuerpo = texto ? JSON.parse(texto) : {};
  const ahora = Date.now();
  if (pedido.url === "/api/trabajador/tablero/tomar") {
    llamadas.push({ accion: "tomar" });
    const ocupada = [...tarjetas.values()].find((t) => ["PLANEANDO", "EN_CURSO", "SUBIENDO"].includes(t.estado) && t.venceEn && t.venceEn > ahora);
    if (ocupada) return contestar(200, { ok: true, tarjeta: null, motivo: "ocupado" });
    const elegida = [...tarjetas.values()].find(
      (t) => t.estado === "APROBADO" || (t.estado === "PLAN_APROBADO" && t.plan) || (t.estado === "SUBIENDO" && !t.venceEn),
    );
    if (!elegida) return contestar(200, { ok: true, tarjeta: null, motivo: "nada" });
    const regla = reglas.AL_TOMAR[elegida.estado];
    Object.assign(elegida, { estado: regla.a, venceEn: ahora + 5 * 60_000, intentos: elegida.intentos + 1 });
    return contestar(200, { ok: true, tarjeta: paraElTrabajador(elegida), hacer: regla.etapa });
  }
  const [, id, accion] = pedido.url.match(/^\/api\/trabajador\/tablero\/([^/]+)\/([a-z]+)$/) ?? [];
  const tarjeta = tarjetas.get(id);
  llamadas.push({ accion, id, cuerpo });
  if (!tarjeta) return contestar(404, { ok: false, error: "No existe" });
  const veredicto = reglas.puedeElTrabajador(accion, tarjeta.estado);
  if (veredicto) return contestar(409, { ok: false, error: veredicto });
  if (accion === "latido") {
    if (latidoVencido.has(id)) return contestar(409, { ok: false, error: "El candado de esta tarjeta ya venció" });
    tarjeta.venceEn = ahora + 5 * 60_000;
    return contestar(200, { ok: true });
  }
  tarjeta.estado = reglas.TRANSICIONES_DEL_TRABAJADOR[accion].a;
  tarjeta.venceEn = null;
  if (accion === "plan") Object.assign(tarjeta, { plan: reglas.planDeEntrada(cuerpo.plan), resultado: null });
  if (accion === "resultado") tarjeta.resultado = reglas.resultadoDeEntrada(cuerpo);
  if (accion === "subida") tarjeta.resultado = { ...tarjeta.resultado, subida: { commit: cuerpo.commit, version: cuerpo.version } };
  if (accion === "error") {
    tarjeta.resultado = { ...(tarjeta.resultado ?? {}), error: { motivo: reglas.motivoDeEntrada(cuerpo.motivo) } };
    if (cuerpo.zonaProtegida) tarjeta.zonaProtegida = reglas.unirZonas(tarjeta.zonaProtegida, reglas.zonasDeEntrada(cuerpo.zonaProtegida));
  }
  return contestar(200, { ok: true, estado: tarjeta.estado });
});
await new Promise((resolver) => servidor.listen(0, "127.0.0.1", resolver));
const PUERTO = servidor.address().port;

const node = process.execPath;
const falso = (nombre) => path.join(AQUI, nombre);
const crearConfig = (tiempos = {}) =>
  completarConfig({
    urlCrm: `http://127.0.0.1:${PUERTO}`,
    claveTrabajador: CLAVE,
    carpetaTrabajo: path.join(T, "trabajo"),
    comandoClaude: [node, falso("claude-falso.mjs")],
    tiempos: { latidoSegundos: 1, planMinutos: 0.3, construirMinutos: 1, subirMinutos: 1, comandoMinutos: 1, ...tiempos },
    git: { nombre: "Trabajador de prueba", correo: "trabajador@x.co" },
    ssh: { comando: [node, falso("ssh-falso.mjs")], destino: "prueba@servidor-falso", psql: "psql -U postgres" },
    repos: {
      aizencrm: {
        ruta: REPO,
        ramaBase: "main",
        remoto: "origin",
        verificar: [[node, "verificar.mjs"]],
        pruebas: [[node, "-e", "console.log('pruebas ok')"]],
        lint: { comando: [node, "lint.mjs"] },
        carpetaMigraciones: "prisma/migrations",
        ensayoPglite: [node, "ensayo.mjs"],
        ensayoProduccion: { tablaGuia: "TarjetaTablero" },
        zonasProtegidas: { BOT_VENTAS: ["src/bot/**"], LIBRO_V3: ["src/agente-v3/**"], META_ADS: ["src/ads/**"] },
        subida: {
          ciBuscar: [node, falso("gh-falso.mjs"), "buscar", "{commit}"],
          ciEsperar: [node, falso("gh-falso.mjs"), "esperar", "{run}"],
          urlVersion: `http://127.0.0.1:${PUERTO}/api/version`,
          campoVersion: "version",
          versionMinutos: 1,
        },
      },
    },
  });

const registro = crearRegistro(path.join(T, "trabajo"), { consola: false, ocultar: [CLAVE] });
const config = crearConfig();
const crm = crearCrm(config);
const vuelta = (otraConfig = config) => unaVuelta({ crm, config: otraConfig, registro });
const leerLog = (archivoLog) =>
  fs.existsSync(archivoLog) ? fs.readFileSync(archivoLog, "utf8").trim().split(/\r?\n/).filter(Boolean).map((linea) => JSON.parse(linea)) : [];
const sinRestos = () => {
  const worktrees = g(REPO, "worktree", "list", "--porcelain").split(/\r?\n/).filter((linea) => linea.startsWith("worktree "));
  assert.equal(worktrees.length, 1, `quedaron worktrees: ${worktrees.join(", ")}`);
  const ramas = g(REPO, "branch", "--format=%(refname:short)").split(/\r?\n/).filter(Boolean);
  assert.deepEqual(ramas, ["main"], "no quedan ramas locales del trabajador");
};

try {
  await prueba("sin nada aprobado: no hace nada", async () => {
    assert.deepEqual(await vuelta(), { hizo: null, motivo: "nada" });
  });

  await prueba("clave equivocada: el CRM contesta 401 y el trabajador no hace nada", async () => {
    const otro = crearCrm({ ...config, claveTrabajador: "aizen_trab_otra" });
    await assert.rejects(unaVuelta({ crm: otro, config, registro }), (error) => error.status === 401);
  });

  // ── El camino feliz completo, con migración ──
  const feliz = nueva("Agregar tabla nueva [migracion]", "APROBADO");
  const mainAntes = shaDe("main");

  await prueba("APROBADO -> PLANEANDO -> PLAN_LISTO: claude en modo plan escribe el plan, con latidos", async () => {
    const resultado = await vuelta();
    assert.equal(resultado.hizo, "planear");
    assert.equal(resultado.ok, true, resultado.motivo);
    const t = tarjetas.get(feliz);
    assert.equal(t.estado, "PLAN_LISTO");
    assert.match(t.plan, /^PLAN para "Agregar tabla nueva \[migracion\]"/);
    assert.ok(llamadas.some((l) => l.accion === "latido" && l.id === feliz), "dio al menos un latido");
    const [llamada] = leerLog(LOGS.claude).slice(-1);
    assert.equal(llamada.modo, "plan");
    assert.ok(llamada.argumentos.includes("-p"));
    assert.equal(shaDe("main"), mainAntes, "planear no toca main");
    sinRestos();
  });

  await prueba("PLAN_APROBADO -> EN_CURSO -> POR_REVISAR: construye, verifica, ensaya la migración y empuja SOLO la rama", async () => {
    tarjetas.get(feliz).estado = "PLAN_APROBADO"; // el dueño aprobó el plan
    const resultado = await vuelta();
    assert.equal(resultado.hizo, "construir");
    assert.equal(resultado.ok, true, resultado.motivo);
    const t = tarjetas.get(feliz);
    assert.equal(t.estado, "POR_REVISAR");
    const rama = `tablero/${feliz.slice(-8)}-agregar-tabla-nueva-migracion`;
    assert.equal(t.resultado.rama, rama);
    assert.equal(t.resultado.paso, true);
    assert.equal(t.resultado.linkRama, null, "el remoto de prueba no es GitHub");
    assert.equal(t.resultado.commit, shaDe(rama));
    assert.match(t.resultado.resumen, /RESUMEN: hice/);
    assert.match(t.resultado.resumen, /prisma\/migrations\/20261020130000_nueva\/migration\.sql/);
    assert.match(t.resultado.pruebas, /verificar\.mjs/);
    assert.match(t.resultado.pruebas, /lint sin errores nuevos/);
    assert.match(t.resultado.migracion, /PGlite: ok; producción \(magilus\) dentro de BEGIN…ROLLBACK: ok/);
    assert.equal(shaDe("main"), mainAntes, "construir NUNCA toca main");
    assert.deepEqual(ramasDelRemoto().sort(), ["main", rama].sort());
    // Claude con acceptEdits, herramientas acotadas y sin push.
    const [llamada] = leerLog(LOGS.claude).slice(-1);
    assert.equal(llamada.modo, "acceptEdits");
    const prohibidas = llamada.argumentos.slice(llamada.argumentos.indexOf("--disallowedTools") + 1);
    assert.ok(prohibidas.includes("Bash(git push:*)"));
    assert.ok(prohibidas.includes("Bash(npx prisma migrate:*)"));
    // El ensayo en "producción": localizó la base con la tabla y corrió BEGIN…ROLLBACK, sin COMMIT.
    const ssh = leerLog(LOGS.ssh);
    const ensayo = ssh.find((l) => l.entrada.includes("CREATE TABLE"));
    assert.match(ensayo.remoto, /-v ON_ERROR_STOP=1 -q -d magilus$/);
    assert.match(ensayo.entrada, /SET lock_timeout = '5s';\nBEGIN;\n/);
    assert.match(ensayo.entrada, /ROLLBACK;\n$/);
    assert.ok(!/^COMMIT;$/m.test(ensayo.entrada));
    sinRestos();
  });

  await prueba("SUBIENDO -> HECHO: rebase, verifica de nuevo, push a main, espera el CI y comprueba la versión", async () => {
    tarjetas.get(feliz).estado = "SUBIENDO"; // el sí final del dueño (pendiente: sin candado)
    tarjetas.get(feliz).venceEn = null;
    const resultado = await vuelta();
    assert.equal(resultado.hizo, "subir");
    assert.equal(resultado.ok, true, resultado.motivo);
    const t = tarjetas.get(feliz);
    assert.equal(t.estado, "HECHO");
    assert.notEqual(shaDe("main"), mainAntes);
    assert.equal(t.resultado.subida.commit, shaDe("main"));
    assert.equal(t.resultado.subida.version, shaDe("main"));
    assert.ok(fs.existsSync(path.join(REMOTO)) && g(REPO, "fetch", "origin") === "");
    assert.ok(g(REPO, "show", "origin/main:prisma/migrations/20261020130000_nueva/migration.sql").includes("CREATE TABLE"));
    const gh = leerLog(LOGS.gh);
    assert.deepEqual(gh.slice(-2), [
      { accion: "buscar", valor: shaDe("main") },
      { accion: "esperar", valor: "4242" },
    ]);
    sinRestos();
  });

  // ── Los ERROR ──
  await prueba("ERROR por tiempo: Claude no termina el plan, se le mata el proceso y queda ERROR", async () => {
    const id = nueva("Plan que no termina [lento]", "APROBADO");
    const inicio = Date.now();
    const resultado = await vuelta(crearConfig({ planMinutos: 0.08 }));
    assert.equal(resultado.ok, false);
    assert.ok(Date.now() - inicio < 30_000, "no esperó los 10 minutos de Claude");
    assert.equal(tarjetas.get(id).estado, "ERROR");
    assert.match(tarjetas.get(id).resultado.error.motivo, /tardó más de|Se pasó del tiempo/);
    sinRestos();
  });

  await prueba("ERROR por zona protegida: toca src/bot/, se marca BOT_VENTAS y no se empuja nada", async () => {
    const id = nueva("Cambiar el saludo [zona]", "PLAN_APROBADO", { plan: "El plan" });
    const ramasAntes = ramasDelRemoto();
    const resultado = await vuelta();
    assert.equal(resultado.ok, false);
    const t = tarjetas.get(id);
    assert.equal(t.estado, "ERROR");
    assert.match(t.resultado.error.motivo, /Toca zona protegida, aprobar en pantalla: BOT_VENTAS \(src\/bot\/respuesta\.ts\)/);
    assert.deepEqual(t.zonaProtegida, ["BOT_VENTAS"]);
    assert.deepEqual(ramasDelRemoto(), ramasAntes, "no se empujó la rama");
    sinRestos();
  });

  await prueba("con la zona aprobada en la pantalla, el mismo cambio sí pasa", async () => {
    const id = nueva("Cambiar el saludo aprobado [zona]", "PLAN_APROBADO", { plan: "El plan", zonaProtegida: ["BOT_VENTAS"] });
    const resultado = await vuelta();
    assert.equal(resultado.ok, true, resultado.motivo);
    assert.equal(tarjetas.get(id).estado, "POR_REVISAR");
    sinRestos();
  });

  await prueba("ERROR si falla la verificación (tsc): el detalle queda en el motivo", async () => {
    const id = nueva("Romper los tipos [tsc]", "PLAN_APROBADO", { plan: "El plan" });
    const resultado = await vuelta();
    assert.equal(resultado.ok, false);
    assert.equal(tarjetas.get(id).estado, "ERROR");
    assert.match(tarjetas.get(id).resultado.error.motivo, /Falló la verificación[\s\S]*error TS2322/);
    sinRestos();
  });

  await prueba("ERROR si hay errores NUEVOS de lint (los que ya estaban en main no cuentan)", async () => {
    const id = nueva("Ensuciar el lint [lint]", "PLAN_APROBADO", { plan: "El plan" });
    const resultado = await vuelta();
    assert.equal(resultado.ok, false);
    assert.match(tarjetas.get(id).resultado.error.motivo, /1 error\(es\) nuevo\(s\):\nnuevo\.txt\|regla-falsa/);
    sinRestos();
  });

  await prueba("ERROR si Claude no cambió nada", async () => {
    const id = nueva("No hacer nada [nada]", "PLAN_APROBADO", { plan: "El plan" });
    await vuelta();
    assert.match(tarjetas.get(id).resultado.error.motivo, /no cambió ningún archivo/);
    sinRestos();
  });

  await prueba("ERROR al subir si la rama choca con main (conflicto): main no cambia", async () => {
    const id = nueva("Tocar el archivo compartido [conflicto]", "PLAN_APROBADO", { plan: "El plan" });
    assert.equal((await vuelta()).ok, true);
    assert.equal(tarjetas.get(id).estado, "POR_REVISAR");
    // Mientras tanto alguien cambió lo mismo en main (la copia del repo no la tocó el trabajador: está atrás).
    g(REPO, "pull", "--ff-only", "origin", "main");
    archivo("conflicto.txt", "lo nuevo de main\n");
    g(REPO, "commit", "-am", "otro cambio en main");
    g(REPO, "push", "origin", "main");
    const mainAhora = shaDe("main");
    Object.assign(tarjetas.get(id), { estado: "SUBIENDO", venceEn: null });
    const resultado = await vuelta();
    assert.equal(resultado.ok, false);
    assert.equal(tarjetas.get(id).estado, "ERROR");
    assert.match(tarjetas.get(id).resultado.error.motivo, /conflicto en el rebase/);
    assert.equal(shaDe("main"), mainAhora, "no subió nada");
    sinRestos();
  });

  await prueba("una a la vez: con una tarjeta trabajando (candado vigente) /tomar contesta ocupado", async () => {
    const id = nueva("Ocupada", "PLANEANDO", { venceEn: Date.now() + 60_000 });
    nueva("Espera su turno", "APROBADO");
    assert.deepEqual(await vuelta(), { hizo: null, motivo: "ocupado" });
    tarjetas.get(id).estado = "HECHO";
  });

  await prueba("vencida: si el latido dice 409, se corta lo que corre y NO se llama /error (el CRM la pasa a ERROR)", async () => {
    // La que esperaba su turno se planea normal; después, una que el CRM da por vencida a mitad del plan.
    assert.equal((await vuelta()).ok, true);
    const id = nueva("Plan largo [medio]", "APROBADO");
    latidoVencido.add(id);
    const inicio = Date.now();
    const resultado = await vuelta();
    assert.equal(resultado.vencida, true);
    assert.ok(Date.now() - inicio < 6000, "cortó a Claude antes de los 6 s");
    assert.ok(!llamadas.some((l) => l.accion === "error" && l.id === id), "no llamó /error");
    assert.equal(tarjetas.get(id).estado, "PLANEANDO");
    sinRestos();
  });

  await prueba("el registro se escribe por día en carpetaTrabajo/logs y nunca muestra la clave", async () => {
    const archivos = fs.readdirSync(path.join(T, "trabajo", "logs"));
    assert.equal(archivos.length, 1);
    assert.match(archivos[0], /^trabajador-\d{4}-\d{2}-\d{2}\.log$/);
    const texto = fs.readFileSync(path.join(T, "trabajo", "logs", archivos[0]), "utf8");
    assert.match(texto, /tomé "Agregar tabla nueva/);
    assert.ok(!texto.includes(CLAVE));
  });
} finally {
  servidor.close();
  try {
    fs.rmSync(T, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    // Windows a veces tiene un archivo abierto un instante: queda en la carpeta temporal.
  }
}

console.log(`\n${pruebas} pruebas, todas bien`);
