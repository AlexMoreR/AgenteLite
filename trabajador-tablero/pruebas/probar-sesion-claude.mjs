// Pruebas de la PAUSA POR SESIÓN DE CLAUDE VENCIDA (lib/sesion-claude.mjs + el planificador de bucle.mjs + el latido):
//   node trabajador-tablero/pruebas/probar-sesion-claude.mjs   (también corre dentro de npm run test:trabajador-tablero)
// Usa un CRM FALSO (servidor HTTP local, con el cliente de verdad crm.mjs) y el `claude` FALSO (pruebas/claude-falso.mjs):
// mientras existe el archivo de CLAUDE_FALSO_SIN_SESION, `claude auth status` dice {"loggedIn":false}.
//   (a) sin sesión y 3 tarjetas en fila: el CRM no recibe ningún /tomar, ningún /error y nada de /reparar;
//   (c) varios latidos seguidos llevan sesionClaude.vencida: true y la línea de pausa sale UNA vez en el registro;
//   (d) al borrar el archivo, en la siguiente revisión (pasados revisarMinutos en el reloj falso) vuelve a tomar.
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { crearPlanificador } from "../lib/bucle.mjs";
import { completarConfig } from "../lib/config.mjs";
import { crearCrm } from "../lib/crm.mjs";
import { crearLatido } from "../lib/latido.mjs";
import { crearPausaPorSesion, esErrorDeSesion, sesionDeLaRespuesta } from "../lib/sesion-claude.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const CLAUDE_FALSO = path.join(AQUI, "claude-falso.mjs");
const T = fs.mkdtempSync(path.join(os.tmpdir(), "sesion-claude-"));
const SIN_SESION = path.join(T, "sin-sesion");
process.env.CLAUDE_FALSO_SIN_SESION = SIN_SESION;

let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const PAUSA = "En pausa: sesión de Claude vencida";
const registroFalso = () => {
  const lineas = [];
  return { lineas, info: (m) => lineas.push(`INFO ${m}`), aviso: (m) => lineas.push(`AVISO ${m}`), error: (m) => lineas.push(`ERROR ${m}`) };
};
let numero = 0;
const nuevaConfig = (extra = {}) =>
  completarConfig({
    urlCrm: "http://127.0.0.1:1",
    claveTrabajador: "aizen_trab_x",
    carpetaTrabajo: path.join(T, `trabajo${numero++}`),
    comandoClaude: [process.execPath, CLAUDE_FALSO],
    motores: { planear: "claude", construir: "claude", revisar: "claude" },
    vigilarUsoMinutos: 0,
    maxParalelo: 3,
    sesionClaude: { revisarMinutos: 3 },
    repos: { aizencrm: { ruta: T, subirSolo: false, ramaBase: "main", remoto: "origin", verificar: [["true"]] } },
    ...extra,
  });

/* ─────────────────────────────────────────────────────────── piezas puras ── */

await prueba("esErrorDeSesion reconoce las frases del error de sesión y no otros errores", () => {
  for (const texto of [
    "OAuth session expired and could not be refreshed",
    "API Error: 401 Failed to authenticate",
    "Not logged in · Please run /login",
    "Invalid API key · Please run /login",
    "The token could not be refreshed",
  ]) {
    assert.equal(esErrorDeSesion(texto), true, texto);
  }
  for (const texto of ["Claude AI usage limit reached|1761210000", "error TS2304: Cannot find name", "", null, undefined]) assert.equal(esErrorDeSesion(texto), false, String(texto));
});

await prueba("la respuesta de claude auth status: JSON con loggedIn, texto 'Not logged in' o no se entiende (null)", () => {
  assert.equal(sesionDeLaRespuesta('{\n  "loggedIn": true,\n  "authMethod": "oauth_token"\n}'), true);
  assert.equal(sesionDeLaRespuesta('{"loggedIn":false}\n'), false);
  assert.equal(sesionDeLaRespuesta("aviso previo\n{\"loggedIn\": false, \"x\": 1}"), false, "con texto antes del JSON");
  assert.equal(sesionDeLaRespuesta("Not logged in. Run claude /login"), false);
  assert.equal(sesionDeLaRespuesta("error: unknown command 'auth'"), null);
  assert.equal(sesionDeLaRespuesta('{"otro": true}'), null, "JSON sin loggedIn: no se entiende");
  assert.equal(sesionDeLaRespuesta(""), null);
});

await prueba("si el comando no responde o no se entiende, NO pausa: solo lo anota (una vez por racha)", async () => {
  let reloj = 0;
  const registro = registroFalso();
  const pausa = crearPausaPorSesion({ config: nuevaConfig(), registro, ahora: () => reloj, preguntar: async () => ({ sesion: null, motivo: "tardó más de 30 s" }) });
  assert.equal(await pausa.revisar(), false);
  reloj += 61_000;
  assert.equal(await pausa.revisar(), false);
  reloj += 61_000;
  const lanza = crearPausaPorSesion({ config: nuevaConfig(), registro, ahora: () => reloj, preguntar: async () => { throw new Error("spawn claude ENOENT"); } });
  assert.equal(await lanza.revisar(), false);
  assert.equal(pausa.vencida(), false);
  assert.equal(registro.lineas.filter((l) => l.includes("tardó más de 30 s")).length, 1, "la misma falla se anota una vez");
  assert.equal(registro.lineas.filter((l) => l.includes("ENOENT")).length, 1);
  assert.deepEqual(pausa.resumen(), { vencida: false, desde: null, revisadaEn: null });
});

await prueba("reutiliza la revisión buena de menos de 1 min; en pausa pregunta cada revisarMinutos; marcarVencida pausa sin preguntar", async () => {
  let reloj = 1_000_000;
  let sesion = true;
  let preguntas = 0;
  const pausa = crearPausaPorSesion({ config: nuevaConfig(), registro: registroFalso(), ahora: () => reloj, preguntar: async () => ((preguntas += 1), { sesion, motivo: sesion ? null : "loggedIn: false" }) });
  await pausa.revisar();
  reloj += 30_000;
  await pausa.revisar();
  assert.equal(preguntas, 1, "a los 30 s reutiliza");
  reloj += 31_000;
  sesion = false;
  assert.equal(await pausa.revisar(), true, "pasado 1 min pregunta y entra en pausa");
  assert.equal(preguntas, 2);
  sesion = true;
  reloj += 2 * 60_000;
  assert.equal(await pausa.revisar(), true, "en pausa no vuelve a preguntar antes de 3 min");
  assert.equal(preguntas, 2);
  reloj += 60_000;
  assert.equal(await pausa.revisar(), false, "a los 3 min pregunta, la sesión volvió y sale sola");
  assert.equal(preguntas, 3);
  pausa.marcarVencida("OAuth session expired");
  assert.equal(pausa.vencida(), true);
  reloj += 60_000;
  assert.equal(await pausa.revisar(), true, "tras marcarla espera revisarMinutos antes de preguntar");
  assert.equal(preguntas, 3);
  assert.equal(typeof pausa.esErrorDeSesion, "function");
});

await prueba("el estado se guarda en estado-sesion-claude.json: un reinicio sigue en pausa", async () => {
  const config = nuevaConfig();
  const antes = crearPausaPorSesion({ config, registro: registroFalso(), ahora: () => 5_000_000, preguntar: async () => ({ sesion: false, motivo: "loggedIn: false" }) });
  assert.equal(await antes.revisar(), true);
  const guardado = JSON.parse(fs.readFileSync(path.join(config.carpetaTrabajo, "estado-sesion-claude.json"), "utf8"));
  assert.equal(guardado.vencida, true);
  let preguntas = 0;
  const despues = crearPausaPorSesion({ config, registro: registroFalso(), ahora: () => 5_060_000, preguntar: async () => ((preguntas += 1), { sesion: true }) });
  assert.equal(despues.vencida(), true, "al arrancar lee la pausa guardada");
  assert.equal(await despues.revisar(), true, "y no pregunta antes de revisarMinutos");
  assert.equal(preguntas, 0);
  assert.equal(despues.resumen().vencida, true);
  assert.equal(despues.resumen().desde, new Date(5_000_000).toISOString());
});

await prueba("el claude falso: auth status según el archivo, y sin sesión todo lo demás falla con el error de OAuth", async () => {
  const { correr } = await import("../lib/procesos.mjs");
  fs.writeFileSync(SIN_SESION, "sí\n");
  const sin = await correr([process.execPath, CLAUDE_FALSO, "auth", "status"], { cwd: T, entrada: "" });
  assert.equal(sesionDeLaRespuesta(sin.salida), false);
  const otra = await correr([process.execPath, CLAUDE_FALSO, "-p", "--permission-mode", "plan"], { cwd: T, entrada: "Tarea: x\n" });
  assert.equal(otra.codigo, 1);
  assert.match(otra.errores, /OAuth session expired and could not be refreshed/);
  assert.equal(esErrorDeSesion(otra.errores), true);
  fs.rmSync(SIN_SESION, { force: true });
  const con = await correr([process.execPath, CLAUDE_FALSO, "auth", "status"], { cwd: T, entrada: "" });
  assert.equal(con.codigo, 0);
  assert.equal(sesionDeLaRespuesta(con.salida), true);
});

/* ─────────────────────────────────── de punta a punta: planificador + CRM falso + latido ── */

/** Un CRM falso por HTTP: 3 tarjetas en fila; anota cada ruta pedida y cada latido. */
async function crmFalso() {
  const llamadas = [];
  const latidos = [];
  const lista = ["a", "b", "c"].map((letra) => ({ id: `tarjeta-${letra}`, titulo: `Tarjeta ${letra}`, repo: "aizencrm", hacer: "planear", plan: null, zonaProtegida: [], tomada: false }));
  const servidor = http.createServer((pedido, respuesta) => {
    let cuerpo = "";
    pedido.on("data", (dato) => (cuerpo += dato));
    pedido.on("end", () => {
      const ruta = pedido.url.split("?")[0];
      const datos = cuerpo ? JSON.parse(cuerpo) : {};
      llamadas.push(ruta);
      let salida = { ok: true };
      if (ruta === "/api/trabajador/tablero/candidatas") salida = { candidatas: lista.filter((c) => !c.tomada) };
      else if (ruta === "/api/trabajador/tablero/tomar") {
        const c = lista.find((x) => !x.tomada && !(datos.excluir ?? []).includes(x.id));
        if (c) c.tomada = true;
        salida = c ? { tarjeta: c, hacer: c.hacer } : { tarjeta: null, motivo: "nada" };
      } else if (ruta === "/api/trabajador/latido") latidos.push(datos);
      respuesta.writeHead(200, { "Content-Type": "application/json" });
      respuesta.end(JSON.stringify(salida));
    });
  });
  await new Promise((resolver) => servidor.listen(0, "127.0.0.1", resolver));
  return { llamadas, latidos, url: `http://127.0.0.1:${servidor.address().port}`, cerrar: () => new Promise((resolver) => servidor.close(resolver)) };
}

await prueba("de punta a punta: (a) sin sesión no toma ni falla nada, (c) latidos con vencida y una sola línea, (d) al volver toma tarjetas", async () => {
  const falso = await crmFalso();
  const config = nuevaConfig({ urlCrm: falso.url });
  const crm = crearCrm(config, { timeoutMs: 5000 });
  const registro = registroFalso();
  let reloj = 10_000_000;
  const terminar = [];
  // Un `procesar` falso: la tarjeta queda "corriendo" hasta el final de la prueba (lo que importa aquí es si se tomó).
  const procesarTarjeta = (opciones) =>
    new Promise((resolver) => {
      opciones.vivo.lugar = opciones.lugar;
      terminar.push(resolver);
    });
  const medidor = { medir: () => ({ cpu: 10, memoria: 20 }), parar: () => undefined };
  const planificador = crearPlanificador({ crm, config, registro, medidor, vigilante: null, colaPesada: null, procesarTarjeta, ahora: () => reloj });
  const latido = crearLatido({ crm, config, registro, planificador, medidor, cadaSegundos: 3600, leer: () => null });

  // (a) Sin sesión y 3 tarjetas en fila. El latido del arranque salió antes de la primera revisión: no cuenta.
  fs.writeFileSync(SIN_SESION, "sí\n");
  await new Promise((resolver) => setTimeout(resolver, 200));
  const latidosDelArranque = falso.latidos.length;
  for (let i = 0; i < 4; i += 1) {
    await planificador.llenar();
    reloj += 70_000; // más de 1 min por vuelta: también cruza revisarMinutos (3) y vuelve a preguntar, sigue vencida
    // (c) Un latido por vuelta (el primero puede saltarse si el del arranque sigue en vuelo).
    await latido.latirYa();
  }
  assert.equal(planificador.pausadoPorSesion(), true);
  assert.equal(planificador.pausaSesion.vencida(), true, "el objeto queda expuesto para la parte 2");
  assert.equal(falso.llamadas.filter((r) => r === "/api/trabajador/tablero/tomar").length, 0, "ningún tomar");
  assert.equal(falso.llamadas.filter((r) => /\/(error|reparar)$/.test(r)).length, 0, "ningún /error ni /reparar");
  assert.equal(falso.llamadas.filter((r) => r === "/api/trabajador/tablero/candidatas").length, 0, "ni siquiera pide las candidatas");
  assert.deepEqual(planificador.cupos(), { aizen1: 0, nube: 0 });

  // (c) Varios latidos seguidos llevan sesionClaude.vencida: true, y la línea de pausa sale UNA vez.
  const enPausa = falso.latidos.slice(latidosDelArranque);
  assert.ok(enPausa.length >= 3, `latidos en pausa: ${enPausa.length}`);
  for (const l of enPausa) assert.equal(l.sesionClaude?.vencida, true);
  assert.ok(falso.latidos.at(-1).sesionClaude.desde, "dice desde cuándo");
  assert.ok(falso.latidos.at(-1).sesionClaude.revisadaEn, "y cuándo se revisó");
  assert.equal(registro.lineas.filter((l) => l.includes(PAUSA)).length, 1, `la línea de pausa sale una vez:\n${registro.lineas.join("\n")}`);

  // (d) Se borra el archivo: en la siguiente revisión (pasados 3 min del reloj) vuelve a tomar.
  fs.rmSync(SIN_SESION, { force: true });
  reloj += 3 * 60_000;
  await planificador.llenar();
  assert.equal(planificador.pausadoPorSesion(), false, "salió de la pausa sola");
  assert.ok(falso.llamadas.filter((r) => r === "/api/trabajador/tablero/tomar").length >= 1, "volvió a tomar tarjetas");
  assert.ok(planificador.cupos().aizen1 >= 1);
  assert.ok(registro.lineas.some((l) => l.includes("volvió la sesión de Claude")));
  await latido.latirYa();
  assert.equal(falso.latidos.at(-1).sesionClaude.vencida, false);
  assert.equal(falso.llamadas.filter((r) => /\/(error|reparar)$/.test(r)).length, 0, "tampoco al volver");

  latido.parar();
  for (const fin of terminar) fin();
  await planificador.esperarTodas();
  planificador.parar();
  await falso.cerrar();
});

fs.rmSync(T, { recursive: true, force: true });
console.log(`\n${pruebas} pruebas de la pausa por sesión de Claude: OK`);
