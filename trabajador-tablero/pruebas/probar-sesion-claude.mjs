// Pruebas de la PAUSA POR SESIÓN DE CLAUDE VENCIDA (lib/sesion-claude.mjs y su lugar en el planificador y el latido):
//   node trabajador-tablero/pruebas/probar-sesion-claude.mjs   (también corre dentro de npm run test:trabajador-tablero)
// Un CRM FALSO (servidor HTTP local) anota cada pedido y el `claude` FALSO (pruebas/claude-falso.mjs) hace de sesión vencida
// mientras exista el archivo de CLAUDE_FALSO_SIN_SESION. El reloj se adelanta a mano.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { crearPlanificador, procesar } from "../lib/bucle.mjs";
import { completarConfig } from "../lib/config.mjs";
import { esErrorDeSesionClaude } from "../lib/diagnostico.mjs";
import { crearCrm } from "../lib/crm.mjs";
import { armarLatido, crearLatido } from "../lib/latido.mjs";
import { crearEstadoDeMotores } from "../lib/motores.mjs";
import { REVISAR_MINUTOS_POR_DEFECTO, crearPausaPorSesion, esErrorDeSesion, leerEstadoDeSesion } from "../lib/sesion-claude.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const CLAUDE_FALSO = path.join(AQUI, "claude-falso.mjs");
const MIN = 60_000;
const T = fs.mkdtempSync(path.join(os.tmpdir(), "sesion-claude-"));
const SIN_SESION = path.join(T, "sin-sesion");
process.env.CLAUDE_FALSO_SIN_SESION = SIN_SESION;
// Este archivo no mira el log del claude falso de las otras pruebas.
delete process.env.CLAUDE_FALSO_LOG;

let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const registroFalso = () => {
  const lineas = [];
  return { lineas, info: (m) => lineas.push(`INFO ${m}`), aviso: (m) => lineas.push(`AVISO ${m}`), error: (m) => lineas.push(`ERROR ${m}`) };
};
/** Un reloj que se adelanta: `reloj.pasar(minutos)`. */
function crearReloj(inicio = Date.parse("2026-11-24T12:00:00Z")) {
  let ahora = inicio;
  return { ahora: () => ahora, pasar: (minutos) => (ahora += minutos * MIN) };
}

/* ── El CRM falso: 3 tarjetas en fila; anota cada pedido (método y ruta) ── */
const pedidos = [];
let fila = [];
const servidor = http.createServer(async (pedido, respuesta) => {
  let cuerpo = "";
  for await (const pedazo of pedido) cuerpo += pedazo;
  const ruta = pedido.url.split("?")[0];
  pedidos.push({ metodo: pedido.method, ruta, cuerpo: cuerpo ? JSON.parse(cuerpo) : null });
  const contestar = (datos) => {
    respuesta.writeHead(200, { "Content-Type": "application/json" });
    respuesta.end(JSON.stringify(datos));
  };
  if (ruta === "/api/trabajador/tablero/candidatas") return contestar({ candidatas: fila.filter((t) => !t.tomada) });
  if (ruta === "/api/trabajador/tablero/tomar") {
    const excluir = cuerpo ? (JSON.parse(cuerpo).excluir ?? []) : [];
    const tarjeta = fila.find((t) => !t.tomada && !excluir.includes(t.id));
    if (!tarjeta) return contestar({ tarjeta: null, motivo: "nada" });
    tarjeta.tomada = true;
    return contestar({ tarjeta, hacer: tarjeta.hacer });
  }
  return contestar({ ok: true });
});
await new Promise((resolver) => servidor.listen(0, "127.0.0.1", resolver));
const PUERTO = servidor.address().port;

let numero = 0;
const nuevaConfig = (extra = {}) =>
  completarConfig({
    urlCrm: `http://127.0.0.1:${PUERTO}`,
    claveTrabajador: "aizen_trab_prueba",
    carpetaTrabajo: path.join(T, `trabajo${numero++}`),
    comandoClaude: [process.execPath, CLAUDE_FALSO],
    vigilarUsoMinutos: 0,
    maxParalelo: 3,
    limites: { esperaMaximaMinutos: 0 },
    nube: { activa: false },
    repos: { aizencrm: { ruta: T, subirSolo: false, ramaBase: "main", remoto: "origin", verificar: [["true"]] } },
    ...extra,
  });
const tresTarjetas = () => {
  fila = ["a", "b", "c"].map((letra) => ({ id: `tarjeta-${letra}`, titulo: `Tarjeta ${letra}`, repo: "aizencrm", hacer: "planear", plan: null, zonaProtegida: [], ultimosIntentos: [] }));
};
const rutas = () => pedidos.map((p) => p.ruta);
const sinSesion = () => fs.writeFileSync(SIN_SESION, "vencida\n");
const conSesion = () => fs.rmSync(SIN_SESION, { force: true });

/** Un repo de verdad (remoto pelado + copia con un commit en main): planear corre el `claude` falso dentro de un worktree. */
function crearRepo() {
  const remoto = path.join(T, `remoto${numero}.git`);
  const ruta = path.join(T, `repo${numero++}`);
  const git = (cwd, ...args) => execFileSync("git", args, { cwd, stdio: "ignore" });
  execFileSync("git", ["init", "--bare", "-b", "main", remoto], { stdio: "ignore" });
  execFileSync("git", ["clone", remoto, ruta], { stdio: "ignore" });
  git(ruta, "config", "user.email", "prueba@ejemplo.invalid");
  git(ruta, "config", "user.name", "Prueba");
  fs.writeFileSync(path.join(ruta, "LEEME.md"), "prueba\n");
  git(ruta, "add", ".");
  git(ruta, "commit", "--quiet", "-m", "inicio");
  git(ruta, "push", "--quiet", "origin", "HEAD:main");
  return ruta;
}

/** El planificador real con el CRM falso; `procesar` falso: la sesión termina enseguida sin pasos (aquí solo importa si toma). */
function armar({ config = nuevaConfig(), reloj = crearReloj(), procesarTarjeta: dado = null } = {}) {
  const registro = registroFalso();
  const crm = crearCrm(config);
  const procesadas = [];
  const procesarTarjeta = async (opciones, tarjeta, hacer) => {
    procesadas.push(tarjeta.id);
    return dado ? dado(opciones, tarjeta, hacer) : { ok: true };
  };
  const planificador = crearPlanificador({
    crm,
    config,
    registro,
    medidor: { medir: () => ({ cpu: 10, memoria: 20 }), parar: () => undefined },
    motores: crearEstadoDeMotores(config),
    vigilante: null,
    colaPesada: null,
    procesarTarjeta,
    leerCargaDelPc: () => ({ discoLibreGb: 200 }),
    ahora: reloj.ahora,
  });
  // El latido se arma aparte: al crearse late una vez enseguida.
  const crearElLatido = () => crearLatido({ crm, config, registro, planificador, medidor: { medir: () => ({ cpu: 10, memoria: 20 }) }, cadaSegundos: 3600, leer: () => ({ discoLibreGb: 200 }) });
  return { config, registro, planificador, crearElLatido, procesadas, reloj };
}

try {
  await prueba("esErrorDeSesion reconoce los 5 textos de sesión vencida y no otros errores", async () => {
    for (const texto of ["OAuth session expired", "the token could not be refreshed", "Failed to authenticate. API Error: 401", "Not logged in", "Please run /login"]) {
      assert.equal(esErrorDeSesion(texto), true, texto);
    }
    assert.equal(esErrorDeSesion("Claude AI usage limit reached|1761210000"), false);
    assert.equal(esErrorDeSesion(""), false);
    assert.equal(esErrorDeSesion(null), false);
  });

  await prueba("leerEstadoDeSesion: loggedIn del JSON; sin JSON, 'Not logged in'; lo que no se entiende da null", async () => {
    assert.equal(leerEstadoDeSesion('{"loggedIn":true,"authMethod":"claude.ai"}'), true);
    assert.equal(leerEstadoDeSesion('{"loggedIn":false}'), false);
    assert.equal(leerEstadoDeSesion('aviso previo\n{"loggedIn":false}\n'), false);
    assert.equal(leerEstadoDeSesion("Not logged in. Run claude /login"), false);
    assert.equal(leerEstadoDeSesion("Logged in as alguien"), null);
    assert.equal(leerEstadoDeSesion('{"otra":1}'), null);
    assert.equal(leerEstadoDeSesion(""), null);
  });

  await prueba("el claude falso: con el archivo, auth status dice loggedIn false y lo demás sale con código 1 y el error de OAuth", async () => {
    sinSesion();
    assert.deepEqual(JSON.parse(execFileSync(process.execPath, [CLAUDE_FALSO, "auth", "status"], { encoding: "utf8" })), { loggedIn: false });
    let fallo = null;
    try {
      execFileSync(process.execPath, [CLAUDE_FALSO, "-p", "hola"], { input: "Tarea: x\n", encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
    } catch (error) {
      fallo = error;
    }
    assert.equal(fallo?.status, 1);
    assert.match(String(fallo.stderr), /OAuth session expired and could not be refreshed/);
    conSesion();
    assert.deepEqual(JSON.parse(execFileSync(process.execPath, [CLAUDE_FALSO, "auth", "status"], { encoding: "utf8" })), { loggedIn: true });
  });

  await prueba("(a) sesión vencida y 3 tarjetas en fila: el CRM no recibe ningún tomar, ningún /error ni nada de reparación", async () => {
    sinSesion();
    tresTarjetas();
    pedidos.length = 0;
    const { planificador, procesadas, reloj } = armar();
    for (let vuelta = 0; vuelta < 4; vuelta += 1) {
      await planificador.llenar();
      reloj.pasar(1);
    }
    assert.equal(planificador.pausadoPorSesion(), true);
    assert.equal(planificador.pausaSesion.vencida(), true, "el objeto queda expuesto para la parte 2");
    assert.ok(!rutas().includes("/api/trabajador/tablero/tomar"), `no toma: ${rutas().join(", ")}`);
    assert.ok(!rutas().some((r) => /\/(error|reparar|soltar|partir)$/.test(r)), `ni error ni reparación: ${rutas().join(", ")}`);
    assert.deepEqual(procesadas, []);
    conSesion();
  });

  await prueba("esErrorDeSesionClaude (diagnostico.mjs) usa las mismas frases que esErrorDeSesion", async () => {
    assert.equal(esErrorDeSesionClaude("OAuth session expired and could not be refreshed"), true);
    assert.equal(esErrorDeSesionClaude("Not logged in · Please run /login"), true);
    assert.equal(esErrorDeSesionClaude("Claude AI usage limit reached|1761210000"), false);
    assert.equal(esErrorDeSesionClaude(undefined), false);
  });

  await prueba("(b) la sesión se vence a mitad de camino: la tarjeta se suelta sin ERROR, sin reparación ni intento, y el Coordinador queda en pausa", async () => {
    conSesion();
    const ruta = crearRepo();
    const config = nuevaConfig({ repos: { aizencrm: { ruta, subirSolo: false, ramaBase: "main", remoto: "origin", verificar: [["true"]] } } });
    const tarjeta = { id: "tarjeta-b1", titulo: "Algo chico", detalle: "Cambiar un texto.", repo: "aizencrm", hacer: "planear", plan: null, zonaProtegida: [], ultimosIntentos: [], intentos: 1, reparaciones: 0, topeReparaciones: 3 };
    fila = [tarjeta];
    pedidos.length = 0;
    const resultados = [];
    const { planificador, procesadas, registro } = armar({
      config,
      // Empieza con sesión (el planificador la revisó y la tomó); a mitad de camino la sesión se vence.
      procesarTarjeta: async (opciones, unaTarjeta, hacer) => {
        sinSesion();
        const resultado = await procesar(opciones, unaTarjeta, hacer);
        resultados.push(resultado);
        return resultado;
      },
    });
    await planificador.llenar();
    await planificador.esperarTodas();
    assert.deepEqual(procesadas, ["tarjeta-b1"], "la tomó con la sesión buena");
    assert.equal(resultados.length, 1);
    assert.equal(resultados[0].sinSesion, true, JSON.stringify(resultados[0]));
    assert.equal(resultados[0].ok, false);
    const soltadas = pedidos.filter((p) => p.ruta === "/api/trabajador/tablero/tarjeta-b1/soltar");
    assert.equal(soltadas.length, 1, rutas().join(", "));
    assert.match(soltadas[0].cuerpo.motivo, /sesión de Claude vencida/);
    assert.deepEqual(Object.keys(soltadas[0].cuerpo), ["motivo"], "sin categoría ni causa: no cuenta como intento ni reparación");
    assert.ok(!rutas().some((r) => /\/(error|reparar|partir|recoger)$/.test(r)), `sin crm.error ni reparación: ${rutas().join(", ")}`);
    assert.equal(tarjeta.intentos, 1, "intentos iguales que antes");
    assert.equal(tarjeta.reparaciones, 0, "reparaciones iguales que antes");
    assert.equal(planificador.pausadoPorSesion(), true, "el Coordinador queda en pausa");
    assert.ok(registro.lineas.some((l) => l.includes("PAUSA: la sesión de Claude está vencida")), registro.lineas.join("\n"));
    // Ya en pausa: con 3 tarjetas nuevas en la fila no toma ninguna.
    tresTarjetas();
    pedidos.length = 0;
    for (let vuelta = 0; vuelta < 3; vuelta += 1) await planificador.llenar();
    await planificador.esperarTodas();
    assert.ok(!rutas().includes("/api/trabajador/tablero/tomar"), `no toma más: ${rutas().join(", ")}`);
    assert.deepEqual(procesadas, ["tarjeta-b1"]);
    conSesion();
  });

  await prueba("(e) un reinicio con estado-sesion-claude.json guardado como vencido sigue en pausa y no toma", async () => {
    sinSesion();
    tresTarjetas();
    pedidos.length = 0;
    const config = nuevaConfig();
    fs.mkdirSync(config.carpetaTrabajo, { recursive: true });
    const desde = Date.parse("2026-11-24T11:00:00Z");
    fs.writeFileSync(path.join(config.carpetaTrabajo, "estado-sesion-claude.json"), `${JSON.stringify({ vencida: true, desde, motivo: "OAuth session expired", revisadaEn: desde })}\n`);
    const { planificador, procesadas, reloj } = armar({ config });
    assert.equal(planificador.pausadoPorSesion(), true, "en pausa desde que arranca, antes de revisar");
    for (let vuelta = 0; vuelta < 3; vuelta += 1) {
      await planificador.llenar();
      reloj.pasar(1);
    }
    assert.equal(planificador.pausadoPorSesion(), true);
    assert.ok(!rutas().includes("/api/trabajador/tablero/tomar"), `no toma: ${rutas().join(", ")}`);
    assert.deepEqual(procesadas, []);
    conSesion();
  });

  await prueba("(c) varios latidos seguidos llevan sesionClaude.vencida true y 'En pausa: sesión de Claude vencida' sale una sola vez", async () => {
    sinSesion();
    tresTarjetas();
    pedidos.length = 0;
    const { planificador, crearElLatido, registro, reloj } = armar();
    await planificador.llenar();
    pedidos.length = 0;
    const latido = crearElLatido();
    for (let vuelta = 0; vuelta < 5; vuelta += 1) {
      await planificador.llenar();
      await latido.latirYa();
      reloj.pasar(1);
    }
    latido.parar();
    const latidos = pedidos.filter((p) => p.ruta === "/api/trabajador/latido");
    assert.ok(latidos.length >= 3, `salieron ${latidos.length} latidos (alguno se salta si el anterior sigue en vuelo)`);
    for (const { cuerpo } of latidos) {
      assert.equal(cuerpo.sesionClaude?.vencida, true);
      assert.ok(cuerpo.sesionClaude.desde, "lleva desde cuándo");
      assert.ok(cuerpo.sesionClaude.revisadaEn, "y la última revisión");
    }
    const enPausa = registro.lineas.filter((l) => l.includes("En pausa: sesión de Claude vencida"));
    assert.equal(enPausa.length, 1, registro.lineas.join("\n"));
    assert.equal(armarLatido({ estado: { tareas: [] } }).sesionClaude, null, "un estado sin la llave manda null");
    conSesion();
  });

  await prueba("(d) al borrar el archivo, en la siguiente revisión (revisarMinutos) vuelve a tomar tarjetas", async () => {
    sinSesion();
    tresTarjetas();
    pedidos.length = 0;
    const config = nuevaConfig({ sesionClaude: { revisarMinutos: 3 } });
    assert.equal(config.sesionClaude.revisarMinutos, 3);
    const { planificador, procesadas, reloj, registro } = armar({ config });
    await planificador.llenar();
    assert.equal(planificador.pausadoPorSesion(), true);
    conSesion();
    reloj.pasar(1);
    await planificador.llenar();
    assert.equal(planificador.pausadoPorSesion(), true, "antes de revisarMinutos no vuelve a revisar");
    assert.ok(!rutas().includes("/api/trabajador/tablero/tomar"));
    reloj.pasar(2);
    await planificador.llenar();
    await planificador.esperarTodas();
    assert.equal(planificador.pausadoPorSesion(), false);
    assert.ok(rutas().includes("/api/trabajador/tablero/tomar"), "vuelve a tomar");
    assert.deepEqual([...procesadas].sort(), ["tarjeta-a", "tarjeta-b", "tarjeta-c"]);
    assert.ok(registro.lineas.some((l) => l.includes("la sesión de Claude volvió")));
    assert.equal(planificador.estado().sesionClaude.vencida, false);
  });

  await prueba("el estado se guarda: un reinicio sigue en pausa y sale solo cuando vuelve la sesión", async () => {
    sinSesion();
    const config = nuevaConfig();
    const reloj = crearReloj();
    const primera = crearPausaPorSesion({ config, registro: registroFalso(), ahora: reloj.ahora });
    assert.equal(await primera.revisar(), true);
    const guardado = JSON.parse(fs.readFileSync(path.join(config.carpetaTrabajo, "estado-sesion-claude.json"), "utf8"));
    assert.equal(guardado.vencida, true);
    // El reinicio: antes de revisar ya está en pausa.
    const segunda = crearPausaPorSesion({ config, registro: registroFalso(), ahora: reloj.ahora });
    assert.equal(segunda.vencida(), true);
    assert.equal(segunda.resumen().vencida, true);
    conSesion();
    assert.equal(await segunda.revisar(), false, "la primera revisión tras el reinicio ve que volvió");
    assert.equal(crearPausaPorSesion({ config, registro: registroFalso(), ahora: reloj.ahora }).vencida(), false);
  });

  await prueba("un claude que no responde o contesta algo que no se entiende NO pausa; se anota una vez", async () => {
    const reloj = crearReloj();
    const registro = registroFalso();
    let llamadas = 0;
    const respuestas = [{ codigo: 0, salida: "", errores: "", vencido: true }, { codigo: 1, salida: "algo raro", errores: "" }, { codigo: -1, salida: "", errores: "spawn claude ENOENT" }];
    const pausa = crearPausaPorSesion({
      config: nuevaConfig(),
      registro,
      ahora: reloj.ahora,
      correrComando: async (comando, opciones) => {
        assert.deepEqual(comando.slice(-2), ["auth", "status"]);
        assert.equal(opciones.timeoutMs, 30_000, "30 s como máximo");
        return respuestas[Math.min(llamadas++, respuestas.length - 1)];
      },
    });
    for (let vuelta = 0; vuelta < 4; vuelta += 1) {
      assert.equal(await pausa.revisar(), false);
      reloj.pasar(1);
    }
    assert.equal(llamadas, 4);
    assert.equal(pausa.vencida(), false);
    assert.equal(registro.lineas.filter((l) => l.includes("no pude revisar la sesión de Claude")).length, 3, registro.lineas.join("\n"));
  });

  await prueba("con la sesión buena reutiliza la revisión de hace menos de 1 minuto; en pausa revisa cada 3 min por defecto; marcarVencida pausa al instante", async () => {
    assert.equal(REVISAR_MINUTOS_POR_DEFECTO, 3);
    const reloj = crearReloj();
    let llamadas = 0;
    let respuesta = '{"loggedIn":true}';
    const pausa = crearPausaPorSesion({
      config: { carpetaTrabajo: path.join(T, `trabajo${numero++}`), comandoClaude: ["claude"] },
      registro: registroFalso(),
      ahora: reloj.ahora,
      correrComando: async () => {
        llamadas += 1;
        return { codigo: 0, salida: respuesta, errores: "" };
      },
    });
    await pausa.revisar();
    reloj.pasar(0.5);
    await pausa.revisar();
    assert.equal(llamadas, 1, "menos de 1 min: reutiliza");
    reloj.pasar(0.6);
    await pausa.revisar();
    assert.equal(llamadas, 2);
    pausa.marcarVencida("OAuth session expired and could not be refreshed");
    assert.equal(pausa.vencida(), true);
    assert.ok(pausa.resumen().desde);
    reloj.pasar(2);
    assert.equal(await pausa.revisar(), true);
    assert.equal(llamadas, 2, "en pausa no revisa antes de 3 min");
    respuesta = '{"loggedIn":false}';
    reloj.pasar(1);
    assert.equal(await pausa.revisar(), true);
    assert.equal(llamadas, 3);
    respuesta = '{"loggedIn":true}';
    reloj.pasar(3);
    assert.equal(await pausa.revisar(), false, "vuelve la sesión: sale sola");
  });

  await prueba("config.example.json trae sesionClaude.revisarMinutos 3 y sin la clave vale 3", async () => {
    const ejemplo = JSON.parse(fs.readFileSync(path.join(AQUI, "..", "config.example.json"), "utf8"));
    assert.deepEqual(ejemplo.sesionClaude, { revisarMinutos: 3 });
    assert.equal(nuevaConfig().sesionClaude.revisarMinutos, 3);
    assert.equal(nuevaConfig({ sesionClaude: { revisarMinutos: -2 } }).sesionClaude.revisarMinutos, 3);
  });
} finally {
  conSesion();
  servidor.close();
  fs.rmSync(T, { recursive: true, force: true, maxRetries: 3 });
}

console.log(`\n${pruebas} pruebas de la sesión de Claude pasaron`);
