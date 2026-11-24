// Pruebas de la PAUSA POR SESIÓN DE CLAUDE VENCIDA (lib/sesion-claude.mjs + el planificador de bucle.mjs + el latido), sin CRM
// ni Claude de verdad:
//   node trabajador-tablero/pruebas/probar-sesion-claude.mjs   (también corre dentro de npm run test:trabajador-tablero)
// Usa el `claude` FALSO (pruebas/claude-falso.mjs, con CLAUDE_FALSO_SIN_SESION) y un CRM falso que anota TODO lo que se le pide.
//   (a) sin sesión y con 3 tarjetas en fila: ningún `tomar`, ningún `/error` y nada de reparación;
//   (c) varios latidos seguidos llevan sesionClaude.vencida: true y la línea de pausa sale una sola vez en el registro;
//   (d) al borrar el archivo, en la siguiente revisión (revisarMinutos, con un reloj falso) vuelve a tomar tarjetas.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { crearPlanificador } from "../lib/bucle.mjs";
import { completarConfig } from "../lib/config.mjs";
import { crearLatido } from "../lib/latido.mjs";
import { crearEstadoDeMotores } from "../lib/motores.mjs";
import { crearPausaPorSesion, esErrorDeSesion, leerAuthStatus } from "../lib/sesion-claude.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const T = fs.mkdtempSync(path.join(os.tmpdir(), "sesion-claude-"));
const SIN_SESION = path.join(T, "sin-sesion");
const LOG = path.join(T, "claude.log");
process.env.CLAUDE_FALSO_SIN_SESION = SIN_SESION;
process.env.CLAUDE_FALSO_LOG = LOG;
const revisionesDeAuth = () => (fs.existsSync(`${LOG}.auth`) ? fs.readFileSync(`${LOG}.auth`, "utf8").trim().split("\n").filter(Boolean).length : 0);

let numero = 0;
const nuevaConfig = (extra = {}) =>
  completarConfig({
    urlCrm: "https://crm.ejemplo.com",
    claveTrabajador: "aizen_trab_x",
    carpetaTrabajo: path.join(T, `trabajo${numero++}`),
    comandoClaude: [process.execPath, path.join(AQUI, "claude-falso.mjs")],
    vigilarUsoMinutos: 0,
    sesionClaude: { revisarMinutos: 3 },
    repos: { aizencrm: { ruta: T, subirSolo: false, ramaBase: "main", remoto: "origin", verificar: [["true"]] } },
    ...extra,
  });
const registroFalso = () => {
  const lineas = [];
  return { lineas, info: (m) => lineas.push(`INFO ${m}`), aviso: (m) => lineas.push(`AVISO ${m}`), error: (m) => lineas.push(`ERROR ${m}`) };
};
const sinMedir = { medir: () => ({ cpu: 0, memoria: 0 }), parar: () => undefined };

/**
 * El CRM falso: anota cada llamada (nombre y argumentos). /candidatas da las de la fila y /tomar la primera libre; el resto
 * contesta { ok: true }. Así se ve si el Coordinador tomó, marcó error o pidió reparación.
 */
function crmFalso() {
  const llamadas = [];
  const fila = [];
  const latidos = [];
  const propias = {
    candidatas: async () => ({ candidatas: fila.filter((c) => !c.tomada) }),
    tomar: async (datos) => {
      const c = fila.find((x) => !x.tomada && !(datos?.excluir ?? []).includes(x.id));
      if (!c) return { tarjeta: null, motivo: "nada" };
      c.tomada = true;
      return { tarjeta: c, hacer: c.hacer };
    },
    latidoDelCoordinador: async (cuerpo) => {
      latidos.push(cuerpo);
      return { ok: true };
    },
  };
  const crm = new Proxy(
    {},
    {
      get: (_, nombre) =>
        typeof nombre !== "string" || nombre === "then"
          ? undefined
          : async (...args) => {
              llamadas.push({ nombre, args });
              return propias[nombre] ? propias[nombre](...args) : { ok: true };
            },
    },
  );
  const agregar = (id) => fila.push({ id, titulo: id, repo: "aizencrm", hacer: "planear", plan: null, zonaProtegida: [] });
  return { crm, llamadas, fila, latidos, agregar, nombres: () => llamadas.map((l) => l.nombre) };
}

await prueba("esErrorDeSesion: reconoce los textos de sesión vencida y no los demás", () => {
  for (const texto of ["OAuth session expired and could not be refreshed", "Token could not be refreshed", "Failed to authenticate. API Error: 401", "Not logged in · Please run /login", "Please run /login"]) {
    assert.equal(esErrorDeSesion(texto), true, texto);
  }
  for (const texto of ["", null, "Claude AI usage limit reached|1761210000", "error: unknown option '--model'"]) assert.equal(esErrorDeSesion(texto), false, String(texto));
});

await prueba("leerAuthStatus: lee loggedIn del JSON; sin JSON busca «Not logged in»; lo demás no se entiende (null)", () => {
  assert.equal(leerAuthStatus('{"loggedIn":true,"authMethod":"oauth_token"}'), true);
  assert.equal(leerAuthStatus('{\n  "loggedIn": false\n}\n'), false);
  assert.equal(leerAuthStatus('aviso previo\n{"loggedIn": false}\nfin'), false, "JSON con texto alrededor");
  assert.equal(leerAuthStatus("Not logged in. Run claude /login"), false);
  assert.equal(leerAuthStatus('{"otra":1}'), null);
  assert.equal(leerAuthStatus("command not found"), null);
  assert.equal(leerAuthStatus(""), null);
});

await prueba("el comando no responde o no se entiende: NO pausa y lo anota una sola vez", async () => {
  const registro = registroFalso();
  let reloj = 0;
  const pausa = crearPausaPorSesion({ config: nuevaConfig(), registro, ahora: () => reloj, leer: async () => ({ texto: null, motivo: "tardó más de 30 s" }) });
  assert.equal(await pausa.revisar(), false);
  reloj += 61_000;
  assert.equal(await pausa.revisar(), false);
  assert.equal(pausa.vencida(), false);
  assert.equal(registro.lineas.filter((l) => /no pude revisar la sesión de Claude/.test(l)).length, 1, "una sola vez");
  assert.match(registro.lineas[0], /tardó más de 30 s.*no pauso/);
  const otra = crearPausaPorSesion({ config: nuevaConfig(), registro: registroFalso(), leer: async () => ({ texto: "Segmentation fault", motivo: "salió con código 139" }) });
  assert.equal(await otra.revisar(), false, "una respuesta que no se entiende tampoco pausa");
});

await prueba("con el claude falso: sin sesión entra en pausa; el estado se guarda y un reinicio sigue en pausa; vuelve sola", async () => {
  fs.writeFileSync(SIN_SESION, "1");
  const config = nuevaConfig();
  let reloj = Date.parse("2026-11-24T15:00:00Z");
  const registro = registroFalso();
  const pausa = crearPausaPorSesion({ config, registro, ahora: () => reloj });
  assert.equal(await pausa.revisar(), true);
  assert.equal(pausa.vencida(), true);
  const resumen = pausa.resumen();
  assert.equal(resumen.vencida, true);
  assert.equal(resumen.desde, "2026-11-24T15:00:00.000Z");
  assert.equal(resumen.revisadaEn, "2026-11-24T15:00:00.000Z");
  const guardado = JSON.parse(fs.readFileSync(path.join(config.carpetaTrabajo, "estado-sesion-claude.json"), "utf8"));
  assert.equal(guardado.vencida, true);
  // Un reinicio del Coordinador: lee el archivo y sigue en pausa antes de revisar nada.
  const tras = crearPausaPorSesion({ config, registro: registroFalso(), ahora: () => reloj });
  assert.equal(tras.vencida(), true, "el reinicio sigue en pausa");
  // En pausa revisa cada revisarMinutos (3): antes no corre el comando.
  const antes = revisionesDeAuth();
  reloj += 2 * 60_000;
  assert.equal(await pausa.revisar(), true);
  assert.equal(revisionesDeAuth(), antes, "a los 2 min no vuelve a mirar");
  fs.rmSync(SIN_SESION);
  reloj += 60_000 + 1;
  assert.equal(await pausa.revisar(), false, "a los 3 min mira, la sesión volvió y sale sola");
  assert.equal(pausa.resumen().desde, null);
  assert.ok(registro.lineas.some((l) => /volvió la sesión de Claude/.test(l)));
  // Con sesión, una revisión buena de hace menos de 1 minuto se reutiliza.
  const despues = revisionesDeAuth();
  reloj += 30_000;
  assert.equal(await pausa.revisar(), false);
  assert.equal(revisionesDeAuth(), despues, "menos de 1 min: reutiliza");
  reloj += 31_000;
  await pausa.revisar();
  assert.equal(revisionesDeAuth(), despues + 1, "más de 1 min: vuelve a mirar");
});

await prueba("marcarVencida: entra en pausa sin mirar el comando y espera revisarMinutos para volver a mirar", async () => {
  let reloj = 1_000_000;
  const registro = registroFalso();
  const pausa = crearPausaPorSesion({ config: nuevaConfig(), registro, ahora: () => reloj });
  pausa.marcarVencida("OAuth session expired");
  assert.equal(pausa.vencida(), true);
  const antes = revisionesDeAuth();
  assert.equal(await pausa.revisar(), true);
  assert.equal(revisionesDeAuth(), antes, "no mira enseguida");
  pausa.marcarVencida("otra vez");
  assert.equal(registro.lineas.filter((l) => /PAUSA por sesión de Claude/.test(l)).length, 1, "la pausa se anota una vez");
  assert.equal(pausa.esErrorDeSesion("Please run /login"), true);
});

await prueba("(a)(c)(d) planificador: sin sesión no toma, no marca error ni repara; el latido lo dice; al volver la sesión toma", async () => {
  fs.writeFileSync(SIN_SESION, "1");
  const config = nuevaConfig();
  const crm = crmFalso();
  for (const id of ["t1", "t2", "t3"]) crm.agregar(id);
  const registro = registroFalso();
  let reloj = Date.parse("2026-11-24T15:00:00Z");
  const procesadas = [];
  const procesarTarjeta = async (opciones, tarjeta) => {
    opciones.vivo.lugar = opciones.lugar;
    procesadas.push(tarjeta.id);
    return { ok: true };
  };
  const planificador = crearPlanificador({ crm: crm.crm, config, registro, medidor: sinMedir, motores: crearEstadoDeMotores(config), vigilante: null, colaPesada: null, procesarTarjeta, ahora: () => reloj });
  const latido = crearLatido({ crm: crm.crm, config, registro, planificador, medidor: sinMedir, cadaSegundos: 3600, leer: () => null });
  // El latido sale una vez al crearse (antes de la primera revisión): se cuentan los que salen después de cada vuelta.
  const latidosAntes = crm.latidos.length;

  // (a) varias vueltas sin sesión (cada minuto): nada de tomar, error ni reparar.
  for (let vuelta = 0; vuelta < 4; vuelta += 1) {
    await planificador.llenar();
    await latido.latirYa();
    reloj += 60_000;
  }
  const prohibidas = crm.nombres().filter((n) => /^(tomar|error|reparar|soltar)$/.test(n));
  assert.deepEqual(prohibidas, [], "ni tomar, ni /error, ni reparación");
  assert.deepEqual(procesadas, []);
  assert.equal(planificador.pausadoPorSesion(), true);
  assert.equal(typeof planificador.pausaSesion.marcarVencida, "function", "el objeto queda a mano para la parte 2");

  // (c) los latidos llevan la pausa y la línea sale una sola vez.
  const latidos = crm.latidos.slice(latidosAntes);
  assert.ok(latidos.length >= 4, `salieron ${latidos.length} latidos`);
  for (const cuerpo of latidos) assert.equal(cuerpo.sesionClaude.vencida, true);
  assert.ok(latidos[0].sesionClaude.desde, "trae desde cuándo");
  assert.equal(registro.lineas.filter((l) => l === "INFO En pausa: sesión de Claude vencida").length, 1, "la línea de pausa sale una vez");
  assert.equal(planificador.estado().sesionClaude.vencida, true);

  // (d) se borra el archivo: en la próxima revisión (3 min después de la última) vuelve a tomar.
  fs.rmSync(SIN_SESION);
  reloj += 3 * 60_000;
  await planificador.llenar();
  await planificador.esperarTodas();
  assert.equal(planificador.pausadoPorSesion(), false, "salió de la pausa sola");
  assert.ok(crm.nombres().includes("tomar"), "vuelve a pedir tarjetas");
  assert.ok(procesadas.length >= 1, `tomó ${procesadas.length}`);
  await latido.latirYa();
  assert.equal(crm.latidos.at(-1).sesionClaude.vencida, false, "el latido ya dice que hay sesión");
  latido.parar?.();
  planificador.parar();
});

await prueba("config: sesionClaude.revisarMinutos vale 3 sin la clave y el ejemplo lo trae", () => {
  assert.equal(completarConfig({ urlCrm: "https://x.co", claveTrabajador: "aizen_trab_x", carpetaTrabajo: T, repos: { aizencrm: { ruta: T, subirSolo: false } } }).sesionClaude.revisarMinutos, 3);
  const ejemplo = JSON.parse(fs.readFileSync(path.join(AQUI, "..", "config.example.json"), "utf8"));
  assert.deepEqual(ejemplo.sesionClaude, { revisarMinutos: 3 });
});

fs.rmSync(T, { recursive: true, force: true });
console.log(`\n${pruebas} pruebas de la pausa por sesión de Claude: OK`);
