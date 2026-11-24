// Pruebas de la PAUSA POR SESIÓN DE CLAUDE VENCIDA (lib/sesion-claude.mjs + el planificador de bucle.mjs), con un CRM falso y
// el `claude` falso (claude-falso.mjs, archivo de CLAUDE_FALSO_SIN_SESION), sin CRM ni Claude de verdad:
//   node trabajador-tablero/pruebas/probar-sesion-claude.mjs   (también corre dentro de npm run test:trabajador-tablero)
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { crearPlanificador } from "../lib/bucle.mjs";
import { completarConfig } from "../lib/config.mjs";
import { armarLatido } from "../lib/latido.mjs";
import { crearEstadoDeMotores } from "../lib/motores.mjs";
import { crearPausaPorSesion, esErrorDeSesion, minutosEntreRevisiones, sesionDeLaRespuesta } from "../lib/sesion-claude.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const T = fs.mkdtempSync(path.join(os.tmpdir(), "sesion-claude-"));
// El archivo que dice "no hay sesión": mientras exista, el `claude` falso contesta como con la sesión vencida.
const SIN_SESION = path.join(T, "sin-sesion");
process.env.CLAUDE_FALSO_SIN_SESION = SIN_SESION;
let numero = 0;
const registroFalso = () => {
  const lineas = [];
  return { lineas, info: (m) => lineas.push(`INFO ${m}`), aviso: (m) => lineas.push(`AVISO ${m}`), error: (m) => lineas.push(`ERROR ${m}`) };
};
const nuevaConfig = (extra = {}) =>
  completarConfig({
    urlCrm: "https://crm.ejemplo.com",
    claveTrabajador: "aizen_trab_x",
    carpetaTrabajo: path.join(T, `trabajo${numero++}`),
    comandoClaude: [process.execPath, path.join(AQUI, "claude-falso.mjs")],
    motores: { planear: "claude", construir: "claude", revisar: "claude" },
    vigilarUsoMinutos: 0,
    maxParalelo: 3,
    nube: { activa: false },
    sesionClaude: { revisarMinutos: 1 },
    repos: { aizencrm: { subirSolo: false, ruta: T, ramaBase: "main", remoto: "origin", verificar: [["true"]] } },
    ...extra,
  });
const crearReloj = () => {
  let ms = Date.parse("2026-11-24T15:00:00Z");
  return { ahora: () => ms, pasar: (minutos) => (ms += minutos * 60_000) };
};
const sinSesion = (si) => (si ? fs.writeFileSync(SIN_SESION, "1") : fs.rmSync(SIN_SESION, { force: true }));

/**
 * Un CRM falso que anota TODO lo que le piden (cualquier método: tomar, error, reparar…) y da 3 tarjetas en fila, y un
 * `procesar` falso que anota qué tarjetas llegaron a correr.
 */
function repartoFalso(config, reloj) {
  const lista = ["a", "b", "c"].map((id) => ({ id, titulo: id, repo: "aizencrm", hacer: "planear", plan: null, zonaProtegida: [] }));
  const pedidos = [];
  const base = {
    candidatas: async () => ({ candidatas: lista.filter((c) => !c.tomada) }),
    tomar: async (datos) => {
      const c = lista.find((x) => !x.tomada && !(datos?.excluir ?? []).includes(x.id));
      if (!c) return { tarjeta: null, motivo: "nada" };
      c.tomada = true;
      return { tarjeta: c, hacer: c.hacer };
    },
    aviso: async () => ({ ok: true }),
  };
  const crm = new Proxy(base, {
    get(objeto, nombre) {
      if (typeof nombre !== "string" || nombre === "then") return undefined;
      return async (...datos) => {
        pedidos.push(nombre);
        return objeto[nombre] ? objeto[nombre](...datos) : { ok: true };
      };
    },
  });
  const corridas = [];
  const procesarTarjeta = (opciones, tarjeta) => {
    corridas.push(tarjeta.id);
    opciones.vivo.lugar = opciones.lugar;
    return new Promise(() => undefined);
  };
  const registro = registroFalso();
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
  return { planificador, pedidos, corridas, registro };
}

await prueba("esErrorDeSesion y la respuesta de `claude auth status` (JSON, texto, nada)", () => {
  for (const texto of ["OAuth session expired and could not be refreshed", "Failed to authenticate. API Error: 401", "Not logged in · Please run /login", "Please run /login"]) {
    assert.equal(esErrorDeSesion(texto), true, texto);
  }
  assert.equal(esErrorDeSesion("Claude AI usage limit reached|1761210000"), false, "el límite de uso no es sesión vencida");
  assert.equal(esErrorDeSesion(""), false);
  assert.equal(sesionDeLaRespuesta('{\n  "loggedIn": true,\n  "authMethod": "oauth_token"\n}'), true);
  assert.equal(sesionDeLaRespuesta('{"loggedIn":false}'), false);
  assert.equal(sesionDeLaRespuesta('aviso: algo\n{"loggedIn":false}\n'), false, "JSON con texto alrededor");
  assert.equal(sesionDeLaRespuesta("Not logged in. Run claude to log in."), false, "sin JSON: el texto");
  assert.equal(sesionDeLaRespuesta("Logged in as alguien"), null, "no se entiende");
  assert.equal(sesionDeLaRespuesta(""), null);
  assert.equal(minutosEntreRevisiones({}), 3, "3 por defecto");
  assert.equal(minutosEntreRevisiones({ sesionClaude: { revisarMinutos: 5 } }), 5);
  assert.equal(nuevaConfig({ sesionClaude: undefined }).sesionClaude.revisarMinutos, 3);
  assert.throws(() => nuevaConfig({ sesionClaude: { revisarMinutos: 0 } }), /sesionClaude\.revisarMinutos/);
  const ejemplo = completarConfig(JSON.parse(fs.readFileSync(path.join(AQUI, "..", "config.example.json"), "utf8")));
  assert.equal(ejemplo.sesionClaude.revisarMinutos, 3, "el ejemplo trae 3 minutos");
});

await prueba("si el comando no responde o no se entiende, NO pausa (solo lo anota una vez)", async () => {
  const reloj = crearReloj();
  const config = nuevaConfig();
  for (const resultado of [
    { codigo: null, salida: "", errores: "", vencido: true },
    { codigo: 1, salida: "", errores: "algo raro", vencido: false },
    { codigo: -1, salida: "", errores: "spawn claude ENOENT", vencido: false },
  ]) {
    const registro = registroFalso();
    const pausa = crearPausaPorSesion({ config, registro, ahora: reloj.ahora, correrComando: async () => resultado });
    await pausa.revisar();
    reloj.pasar(2);
    await pausa.revisar();
    assert.equal(pausa.vencida(), false);
    assert.equal(registro.lineas.filter((l) => /no pude revisar la sesión de Claude/.test(l)).length, 1, "una sola línea por racha");
  }
});

await prueba("con la sesión buena reutiliza la revisión de menos de 1 minuto; en pausa revisa cada revisarMinutos", async () => {
  const reloj = crearReloj();
  let llamadas = 0;
  let conSesion = true;
  const correrComando = async (comando) => {
    llamadas += 1;
    assert.deepEqual(comando.slice(-2), ["auth", "status"]);
    return { codigo: 0, salida: JSON.stringify({ loggedIn: conSesion }), errores: "", vencido: false };
  };
  const pausa = crearPausaPorSesion({ config: nuevaConfig({ sesionClaude: { revisarMinutos: 3 } }), registro: registroFalso(), ahora: reloj.ahora, correrComando });
  await pausa.revisar();
  await pausa.revisar();
  assert.equal(llamadas, 1, "dentro del minuto se reutiliza");
  reloj.pasar(1);
  conSesion = false;
  await pausa.revisar();
  assert.equal(llamadas, 2);
  assert.equal(pausa.vencida(), true);
  reloj.pasar(2);
  await pausa.revisar();
  assert.equal(llamadas, 2, "en pausa no revisa antes de 3 minutos");
  conSesion = true;
  reloj.pasar(1);
  await pausa.revisar();
  assert.equal(llamadas, 3);
  assert.equal(pausa.vencida(), false, "volvió la sesión: sale sola");
});

await prueba("marcarVencida y el reinicio del Coordinador: el estado se guarda y se lee al arrancar", async () => {
  const reloj = crearReloj();
  const config = nuevaConfig();
  const registro = registroFalso();
  const pausa = crearPausaPorSesion({ config, registro, ahora: reloj.ahora, correrComando: async () => ({ codigo: 0, salida: '{"loggedIn":false}', errores: "", vencido: false }) });
  pausa.marcarVencida("OAuth session expired and could not be refreshed");
  pausa.marcarVencida("otra vez");
  assert.equal(registro.lineas.filter((l) => /PAUSA: la sesión de Claude está vencida/.test(l)).length, 1, "se marca una vez");
  assert.equal(pausa.resumen().vencida, true);
  assert.equal(pausa.resumen().desde, new Date(reloj.ahora()).toISOString());
  const guardado = JSON.parse(fs.readFileSync(path.join(config.carpetaTrabajo, "estado-sesion-claude.json"), "utf8"));
  assert.equal(guardado.vencida, true);
  // Un reinicio: el objeto nuevo arranca en pausa sin haber revisado nada.
  const otra = crearPausaPorSesion({ config, registro: registroFalso(), ahora: reloj.ahora, correrComando: async () => assert.fail("no debe revisar todavía") });
  assert.equal(otra.vencida(), true);
  assert.equal(otra.resumen().desde, pausa.resumen().desde);
});

await prueba("(a)(c)(d) sin sesión: no toma ninguna de las 3, no hay /error ni reparación, el latido lo dice y al volver toma", async () => {
  sinSesion(true);
  const reloj = crearReloj();
  const config = nuevaConfig();
  const r = repartoFalso(config, reloj);
  // (a) Varias vueltas en pausa: el CRM falso no recibe ningún pedido de tomar, error ni reparar.
  for (let vuelta = 0; vuelta < 4; vuelta += 1) {
    await r.planificador.llenar();
    // (c) El latido de cada vuelta lleva sesionClaude.vencida: true.
    const latido = armarLatido({ estado: r.planificador.estado(), medidor: null, carga: null });
    assert.equal(latido.sesionClaude?.vencida, true, `latido ${vuelta + 1}`);
    assert.ok(latido.sesionClaude.desde, "con la hora desde cuándo");
    assert.ok(latido.sesionClaude.revisadaEn, "y la última revisión");
    reloj.pasar(0.2);
  }
  assert.deepEqual(r.pedidos.filter((p) => p !== "aviso"), [], `el CRM no recibió nada: ${r.pedidos.join(", ")}`);
  assert.deepEqual(r.corridas, [], "ninguna tarjeta llegó a correr");
  assert.equal(r.planificador.pausadoPorSesion(), true);
  assert.equal(typeof r.planificador.pausaSesion.marcarVencida, "function", "el objeto queda expuesto para la parte 2");
  // (c) La línea de pausa sale UNA sola vez.
  assert.equal(r.registro.lineas.filter((l) => l === "INFO En pausa: sesión de Claude vencida").length, 1, r.registro.lineas.join("\n"));
  // (d) Vuelve la sesión: en la siguiente revisión (revisarMinutos: 1) toma tarjetas.
  sinSesion(false);
  await r.planificador.llenar();
  assert.equal(r.planificador.pausadoPorSesion(), true, "antes del minuto todavía no revisa");
  reloj.pasar(0.2);
  await r.planificador.llenar();
  assert.equal(r.planificador.pausadoPorSesion(), false, "salió de la pausa sola");
  assert.ok(r.pedidos.includes("tomar"), "volvió a tomar");
  assert.deepEqual([...r.corridas].sort(), ["a", "b", "c"], "las 3 tarjetas arrancaron");
  assert.ok(r.registro.lineas.some((l) => /volvió la sesión de Claude/.test(l)));
  assert.equal(armarLatido({ estado: r.planificador.estado(), medidor: null, carga: null }).sesionClaude.vencida, false);
  r.planificador.parar();
});

await prueba("con la sesión buena el planificador toma como siempre y el `claude` falso sin sesión da el error de sesión", async () => {
  sinSesion(false);
  const reloj = crearReloj();
  const r = repartoFalso(nuevaConfig(), reloj);
  await r.planificador.llenar();
  assert.deepEqual([...r.corridas].sort(), ["a", "b", "c"]);
  assert.equal(r.registro.lineas.some((l) => /sesión de Claude/.test(l)), false, "nada sobre la sesión en el registro");
  r.planificador.parar();
  // El `claude` falso: sin el archivo cualquier llamada sigue igual; con el archivo sale con código 1 y el error de sesión.
  const { correr } = await import("../lib/procesos.mjs");
  sinSesion(true);
  const fallo = await correr([process.execPath, path.join(AQUI, "claude-falso.mjs"), "-p", "--permission-mode", "plan"], { entrada: "Tarea: x\n", timeoutMs: 20_000 });
  assert.equal(fallo.codigo, 1);
  assert.equal(esErrorDeSesion(fallo.errores), true);
  sinSesion(false);
});

fs.rmSync(T, { recursive: true, force: true });
console.log(`\n${pruebas} pruebas de la pausa por sesión de Claude: OK`);
