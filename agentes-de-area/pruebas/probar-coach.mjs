// Pruebas del lanzador del Coach de Ventas (correr-coach.mjs) con un Claude de mentira, un lector de uso de mentira y
// un CRM de mentira. Sin red real, sin plan de Claude.
//   node agentes-de-area/pruebas/probar-coach.mjs
//
// Este mismo archivo hace de `claude` falso cuando se llama con --claude-falso:
//   - con "/usage" contesta el uso (CLAUDE_FALSO_SEMANA = el porcentaje semanal);
//   - si no, lee el prompt por stdin, anota su pid y, con CLAUDE_FALSO_DORMIR, se queda dormido (para el tope).
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ESTE = fileURLToPath(import.meta.url);

/* ───────────────────────────────────────────────────────────── el claude falso ── */
if (process.argv.includes("--claude-falso")) {
  const argumentos = process.argv.slice(process.argv.indexOf("--claude-falso") + 1);
  if (argumentos.includes("/usage")) {
    console.log(`Current session: 12% used · resets Nov 3, 11pm (America/Bogota)\nCurrent week (all models): ${process.env.CLAUDE_FALSO_SEMANA ?? "10"}% used · resets Nov 6, 7am (America/Bogota)`);
    process.exit(0);
  }
  let prompt = "";
  for await (const trozo of process.stdin) prompt += trozo;
  const anotar = process.env.CLAUDE_FALSO_ANOTAR;
  if (anotar) fs.writeFileSync(anotar, JSON.stringify({ pid: process.pid, prompt, argumentos, cwd: process.cwd(), subagentes: process.env.CLAUDE_CODE_SUBAGENT_MODEL, claveDeApi: Boolean(process.env.ANTHROPIC_API_KEY) }));
  if (process.env.CLAUDE_FALSO_DORMIR) {
    await new Promise((r) => setTimeout(r, Number(process.env.CLAUDE_FALSO_DORMIR)));
    if (anotar) fs.writeFileSync(`${anotar}.termino`, "no debió llegar aquí");
  }
  console.log("listo: revisiones guardadas (de mentira)");
  process.exit(0);
}

/* ───────────────────────────────────────────────────────────── las pruebas ── */
const { correrCoach, configDelCoach, decidirPorUso, permisosDelCoach, argumentosDelCoach, fechaDeLaRevision, COACH_POR_DEFECTO } = await import("../correr-coach.mjs");

const RAIZ = path.resolve(path.dirname(ESTE), "..", "..");
const CARPETA_COACH = path.join(RAIZ, "agentes-de-area", "coach");
const TRABAJADOR = path.join(RAIZ, "trabajador-tablero");
const base = fs.mkdtempSync(path.join(os.tmpdir(), "coach-ventas-"));
const FECHA = "2026-11-02";

let pruebas = 0;
const fallasDeLaPrueba = [];
async function prueba(nombre, fn) {
  pruebas += 1;
  try {
    await fn();
    console.log(`ok - ${nombre}`);
  } catch (error) {
    fallasDeLaPrueba.push(nombre);
    console.log(`FALLA - ${nombre}\n${error.stack}`);
  }
}

const configBase = (extra = {}) => ({
  urlCrm: "https://crm.falso",
  claveMcp: "aizen_mcp_falsa",
  comandoClaude: [process.execPath, ESTE, "--claude-falso"],
  carpetaTrabajador: TRABAJADOR,
  carpetaLogs: "./logs",
  coach: { ...COACH_POR_DEFECTO },
  ...extra,
});

/** Un CRM de mentira que anota cada llamada. */
function crmFalso() {
  const llamadas = [];
  const mcp = async (nombre, argumentos) => {
    llamadas.push({ nombre, argumentos });
    return { estado: argumentos.prueba ? "prueba" : argumentos.saltado ? "saltado" : "avisado" };
  };
  return { llamadas, mcp };
}

/** Un lanzador de Claude de mentira que anota con qué se llamó. */
function claudeFalso(resultado = { codigo: 0, salida: "listo", errores: "", vencido: false }) {
  const llamadas = [];
  const lanzar = async (comando, opciones) => {
    llamadas.push({ comando, opciones });
    return resultado;
  };
  return { llamadas, lanzar };
}

const usoDe = (semana) => async () => ({ sesion: { porcentaje: 5, reinicio: "" }, semana: semana === null ? null : { porcentaje: semana, reinicio: "Nov 6, 7am" } });

await prueba("con el uso bien, Claude se lanza con --model opus, en la carpeta coach y con tope de 60 min", async () => {
  const crm = crmFalso();
  const claude = claudeFalso();
  const r = await correrCoach({ config: configBase(), fecha: FECHA, carpetaBase: base, carpetaCoach: CARPETA_COACH, mcp: crm.mcp, lanzarClaude: claude.lanzar, leerUso: usoDe(40) });
  assert.equal(r.ok, true);
  assert.equal(claude.llamadas.length, 1);
  const { comando, opciones } = claude.llamadas[0];
  const i = comando.indexOf("--model");
  assert.ok(i > 0, "falta --model");
  assert.equal(comando[i + 1], "opus");
  assert.ok(comando.includes("-p"));
  assert.equal(opciones.cwd, CARPETA_COACH);
  assert.equal(path.basename(opciones.cwd), "coach");
  assert.equal(opciones.timeoutMs, 60 * 60_000);
  assert.equal(opciones.env.CLAUDE_CODE_SUBAGENT_MODEL, "opus", "los subagentes van con Opus");
  assert.equal(opciones.env.ANTHROPIC_API_KEY, undefined, "nunca la API de pago");
  assert.match(opciones.entrada, new RegExp(`FECHA: ${FECHA}`));
  assert.match(opciones.entrada, /MAX_CHATS_POR_ASESORA: 25/);
  // Al final el lanzador llama él mismo al aviso, sin prueba ni saltado.
  assert.deepEqual(crm.llamadas, [{ nombre: "coach_avisar_del_dia", argumentos: { fecha: FECHA } }]);
});

await prueba("settings.json: solo las 5 herramientas del Coach permitidas; las de enviar y escribir, prohibidas", async () => {
  const ajustes = JSON.parse(fs.readFileSync(path.join(CARPETA_COACH, ".claude", "settings.json"), "utf8"));
  const permitidas = ajustes.permissions.allow;
  assert.deepEqual(
    [...permitidas].sort(),
    ["coach_chats_del_dia", "coach_ver_chat", "coach_guardar_revision", "cerebro_del_area", "cerebro_anotar_aprendizaje"].map((n) => `mcp__aizencrm__${n}`).sort(),
  );
  for (const p of permitidas) {
    assert.ok(p.startsWith("mcp__aizencrm__"), `${p} sin el prefijo mcp__`);
    assert.doesNotMatch(p, /mandar|whatsapp|avisar|enviar|cerebro_escribir|editar_|v3_|ads_|\*/i, `${p} no debe estar permitida`);
  }
  for (const libre of ["Bash", "Edit", "Write", "NotebookEdit"]) assert.ok(!permitidas.includes(libre), `${libre} no debe estar permitida`);
  const prohibidas = ajustes.permissions.deny;
  for (const n of ["Bash", "Edit", "Write", ...["mandar_whatsapp_al_equipo", "cerebro_escribir", "editar_*", "v3_*", "ads_*", "coach_avisar_del_dia"].map((x) => `mcp__aizencrm__${x}`)]) {
    assert.ok(prohibidas.includes(n), `falta prohibir ${n}`);
  }
  assert.equal(ajustes.env?.CLAUDE_CODE_SUBAGENT_MODEL, "opus", "los subagentes en Opus");
  // El lanzador pasa las MISMAS listas que la carpeta.
  const permisos = permisosDelCoach(CARPETA_COACH);
  const args = argumentosDelCoach(configDelCoach({}), permisos);
  const desde = args.indexOf("--allowedTools");
  const hasta = args.indexOf("--disallowedTools");
  assert.deepEqual(args.slice(desde + 1, hasta), permitidas);
  assert.deepEqual(args.slice(hasta + 1), prohibidas);
  // Y el .mcp.json de ejemplo solo trae el CRM, sin claves de verdad.
  const ejemplo = JSON.parse(fs.readFileSync(path.join(CARPETA_COACH, ".mcp.json.example"), "utf8"));
  assert.deepEqual(Object.keys(ejemplo.mcpServers), ["aizencrm"]);
  assert.match(ejemplo.mcpServers.aizencrm.headers.Authorization, /PEGAR_AQUI/);
});

for (const [nombre, leerUso] of [
  ["uso en 85 %", usoDe(85)],
  ["uso en 80 % justo", usoDe(80)],
  ["uso ilegible (sin semana)", usoDe(null)],
  ["uso ilegible (null)", async () => null],
  ["uso ilegible (el lector falla)", async () => { throw new Error("se cayó"); }],
]) {
  await prueba(`con ${nombre}, Claude NO se lanza y se avisa el día saltado`, async () => {
    const crm = crmFalso();
    const claude = claudeFalso();
    const r = await correrCoach({ config: configBase(), fecha: FECHA, carpetaBase: base, carpetaCoach: CARPETA_COACH, mcp: crm.mcp, lanzarClaude: claude.lanzar, leerUso });
    assert.equal(claude.llamadas.length, 0, "Claude no debió lanzarse");
    assert.equal(r.saltado, true);
    assert.equal(crm.llamadas.length, 1);
    assert.equal(crm.llamadas[0].nombre, "coach_avisar_del_dia");
    assert.equal(crm.llamadas[0].argumentos.saltado, true);
    assert.equal(crm.llamadas[0].argumentos.fecha, FECHA);
    assert.ok(crm.llamadas[0].argumentos.motivo.length > 0);
    assert.equal(crm.llamadas[0].argumentos.prueba, undefined);
  });
}

await prueba("el lector de uso real (claude -p /usage) con 85 %: no se lanza Opus", async () => {
  const crm = crmFalso();
  const lanzados = [];
  const { correr } = await import("../../trabajador-tablero/lib/procesos.mjs");
  const lanzar = (comando, opciones) => {
    lanzados.push(comando);
    return correr(comando, { ...opciones, env: { ...opciones.env, CLAUDE_FALSO_SEMANA: "85" } });
  };
  const r = await correrCoach({ config: configBase(), fecha: FECHA, carpetaBase: base, carpetaCoach: CARPETA_COACH, mcp: crm.mcp, lanzarClaude: lanzar });
  assert.equal(lanzados.length, 1, "solo se lee el uso");
  assert.ok(lanzados[0].includes("/usage"));
  assert.ok(!lanzados[0].includes("opus"));
  assert.equal(r.saltado, true);
  assert.match(crm.llamadas[0].argumentos.motivo, /85 %/);
});

await prueba("con --prueba el aviso va con prueba:true (normal y día saltado)", async () => {
  const crm = crmFalso();
  await correrCoach({ config: configBase(), fecha: FECHA, esPrueba: true, carpetaBase: base, carpetaCoach: CARPETA_COACH, mcp: crm.mcp, lanzarClaude: claudeFalso().lanzar, leerUso: usoDe(10) });
  assert.deepEqual(crm.llamadas, [{ nombre: "coach_avisar_del_dia", argumentos: { fecha: FECHA, prueba: true } }]);
  const crm2 = crmFalso();
  await correrCoach({ config: configBase(), fecha: FECHA, esPrueba: true, carpetaBase: base, carpetaCoach: CARPETA_COACH, mcp: crm2.mcp, lanzarClaude: claudeFalso().lanzar, leerUso: usoDe(90) });
  assert.equal(crm2.llamadas[0].argumentos.saltado, true);
  assert.equal(crm2.llamadas[0].argumentos.prueba, true);
});

await prueba("el tope mata el proceso de Claude (de verdad, con el Claude falso dormido)", async () => {
  const crm = crmFalso();
  const anotar = path.join(base, "claude-dormido.json");
  const { correr } = await import("../../trabajador-tablero/lib/procesos.mjs");
  const lanzar = (comando, opciones) => correr(comando, { ...opciones, env: { ...opciones.env, CLAUDE_FALSO_ANOTAR: anotar, CLAUDE_FALSO_DORMIR: "30000" } });
  const config = configBase({ coach: { ...COACH_POR_DEFECTO, maxMinutos: 0.05 } }); // 3 s
  const inicio = Date.now();
  const r = await correrCoach({ config, fecha: FECHA, carpetaBase: base, carpetaCoach: CARPETA_COACH, mcp: crm.mcp, lanzarClaude: lanzar, leerUso: usoDe(10) });
  assert.ok(Date.now() - inicio < 20_000, "no esperó a que Claude terminara solo");
  assert.equal(r.vencido, true);
  assert.equal(r.ok, false);
  assert.ok(r.fallas.some((l) => /tardó más de/.test(l)));
  const { pid, argumentos, cwd, subagentes, claveDeApi } = JSON.parse(fs.readFileSync(anotar, "utf8"));
  assert.equal(argumentos[argumentos.indexOf("--model") + 1], "opus");
  assert.equal(path.basename(cwd), "coach");
  assert.equal(subagentes, "opus");
  assert.equal(claveDeApi, false);
  let vivo = true;
  for (let i = 0; i < 20 && vivo; i += 1) {
    try {
      process.kill(pid, 0);
      await new Promise((resolver) => setTimeout(resolver, 100));
    } catch {
      vivo = false;
    }
  }
  assert.equal(vivo, false, "el proceso de Claude sigue vivo");
  assert.ok(!fs.existsSync(`${anotar}.termino`));
  // Las revisiones que alcanzaron a guardarse se avisan igual.
  assert.equal(crm.llamadas.at(-1).nombre, "coach_avisar_del_dia");
  // El log trae las líneas que fallaron y las últimas 30 líneas.
  const log = fs.readFileSync(r.archivoLog, "utf8");
  assert.match(log, /líneas que fallaron/);
  assert.match(log, /tardó más de 3 min|tardó más de 0\.05 min/);
  assert.match(log, /últimas 30 líneas de Claude/);
});

await prueba("Claude falla: queda ERROR en el log con sus últimas líneas, y se avisa lo guardado", async () => {
  const crm = crmFalso();
  const salida = Array.from({ length: 50 }, (_, n) => `línea ${n + 1}`).join("\n");
  const r = await correrCoach({ config: configBase(), fecha: FECHA, carpetaBase: base, carpetaCoach: CARPETA_COACH, mcp: crm.mcp, lanzarClaude: claudeFalso({ codigo: 1, salida, errores: "", vencido: false }).lanzar, leerUso: usoDe(10) });
  assert.equal(r.ok, false);
  assert.equal(r.cola.split("\n").length, 30);
  assert.match(r.cola, /línea 50$/);
  assert.ok(r.fallas.some((l) => /código 1/.test(l)));
});

await prueba("decidirPorUso, configDelCoach y fechaDeLaRevision", async () => {
  assert.equal(decidirPorUso({ semana: { porcentaje: 79.9 } }, 80).lanzar, true);
  assert.equal(decidirPorUso({ semana: { porcentaje: 80 } }, 80).lanzar, false);
  assert.equal(decidirPorUso({ sesion: { porcentaje: 99 }, semana: null }, 80).lanzar, false);
  assert.deepEqual(configDelCoach({}), COACH_POR_DEFECTO);
  assert.deepEqual(configDelCoach({ coach: { umbralSemana: "x", maxMinutos: -1 } }), COACH_POR_DEFECTO);
  // 10 p. m. de Colombia = 03:00 UTC del otro día: se revisa ese mismo día de Colombia.
  assert.equal(fechaDeLaRevision(new Date("2026-11-03T03:00:00Z")), "2026-11-02");
  // Si aizen1 prendió al otro día a las 7 a. m., se revisa el día anterior.
  assert.equal(fechaDeLaRevision(new Date("2026-11-03T12:00:00Z")), "2026-11-02");
});

await prueba("desde la línea de comandos: --prueba con un CRM de mentira por HTTP (ningún WhatsApp)", async () => {
  const llamadas = [];
  const servidor = http.createServer((pedido, respuesta) => {
    let cuerpo = "";
    pedido.on("data", (t) => (cuerpo += t));
    pedido.on("end", () => {
      const json = JSON.parse(cuerpo);
      llamadas.push({ autorizacion: pedido.headers.authorization, nombre: json.params.name, argumentos: json.params.arguments });
      respuesta.setHeader("Content-Type", "application/json");
      respuesta.end(JSON.stringify({ jsonrpc: "2.0", id: json.id, result: { content: [{ type: "text", text: JSON.stringify({ estado: "prueba", textos: [] }) }] } }));
    });
  });
  await new Promise((r) => servidor.listen(0, "127.0.0.1", r));
  const carpeta = fs.mkdtempSync(path.join(base, "cli-"));
  const archivoConfig = path.join(carpeta, "config.local.json");
  fs.writeFileSync(archivoConfig, JSON.stringify(configBase({ urlCrm: `http://127.0.0.1:${servidor.address().port}` })));
  const anotar = path.join(carpeta, "claude.json");
  const codigo = await new Promise((resolver) => {
    const hijo = spawn(process.execPath, [path.join(RAIZ, "agentes-de-area", "correr-coach.mjs"), "--config", archivoConfig, "--prueba", "--fecha", FECHA], {
      env: { ...process.env, CLAUDE_FALSO_ANOTAR: anotar, CLAUDE_FALSO_SEMANA: "20", ANTHROPIC_API_KEY: "no-debe-llegar" },
      stdio: "ignore",
    });
    hijo.on("exit", resolver);
  });
  servidor.close();
  assert.equal(codigo, 0);
  assert.deepEqual(llamadas, [{ autorizacion: "Bearer aizen_mcp_falsa", nombre: "coach_avisar_del_dia", argumentos: { fecha: FECHA, prueba: true } }]);
  const anotado = JSON.parse(fs.readFileSync(anotar, "utf8"));
  assert.equal(anotado.argumentos[anotado.argumentos.indexOf("--model") + 1], "opus");
  assert.equal(anotado.claveDeApi, false);
  assert.match(fs.readFileSync(path.join(carpeta, "logs", `coach-${FECHA}.log`), "utf8"), /PRUEBA/);
});

fs.rmSync(base, { recursive: true, force: true });
console.log(`\n${pruebas} pruebas ok, ${fallasDeLaPrueba.length} con falla`);
if (fallasDeLaPrueba.length) {
  console.log("Fallaron:\n- " + fallasDeLaPrueba.join("\n- "));
  process.exit(1);
}
