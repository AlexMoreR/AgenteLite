// Pruebas de la PAUSA POR SESIÓN DE CLAUDE VENCIDA (lib/sesion-claude.mjs + el planificador de bucle.mjs), sin nada real:
//   node trabajador-tablero/pruebas/probar-sesion-claude.mjs   (también corre dentro de npm run test:trabajador-tablero)
//
// Con un CRM FALSO (servidor HTTP local, el cliente real de crm.mjs) y el `claude` FALSO (pruebas/claude-falso.mjs): mientras
// exista el archivo de CLAUDE_FALSO_SIN_SESION, `claude auth status` dice que no hay sesión y cualquier otra llamada falla
// con "OAuth session expired and could not be refreshed".
//   (a) sin sesión y 3 tarjetas en fila: el CRM no recibe ningún /tomar, ningún /error ni nada de reparación;
//   (c) varios latidos seguidos llevan sesionClaude.vencida: true y la línea de pausa sale UNA sola vez en el registro;
//   (d) al borrar el archivo, en la siguiente revisión (revisarMinutos chico) vuelve a tomar tarjetas.
// Y el módulo solo: la lectura de `auth status`, los textos de sesión vencida, el reinicio en plena pausa y el comando
// que no responde (no pausa).
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
import { crearEstadoDeMotores } from "../lib/motores.mjs";
import { correr } from "../lib/procesos.mjs";
import { crearPausaPorSesion, esErrorDeSesion, leerEstadoDeSesion } from "../lib/sesion-claude.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const T = fs.mkdtempSync(path.join(os.tmpdir(), "sesion-claude-"));
const SIN_SESION = path.join(T, "sin-sesion");
const LOG = path.join(T, "claude.log");
process.env.CLAUDE_FALSO_SIN_SESION = SIN_SESION;
process.env.CLAUDE_FALSO_LOG = LOG;

let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}
const dormir = (ms) => new Promise((resolver) => setTimeout(resolver, ms));
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
    comandoClaude: [process.execPath, path.join(AQUI, "claude-falso.mjs")],
    motores: { planear: "claude", construir: "claude", revisar: "claude" },
    vigilarUsoMinutos: 0,
    maxParalelo: 3,
    repos: { aizencrm: { subirSolo: false, ruta: T, ramaBase: "main", remoto: "origin", verificar: [["true"]], cuposAizen1: 3 } },
    ...extra,
  });

// El CRM falso: 3 tarjetas para planear; anota cada ruta que le llega y el cuerpo de cada latido.
const rutas = [];
const latidos = [];
const lista = ["t1", "t2", "t3"].map((id) => ({ id, titulo: `Tarjeta ${id}`, repo: "aizencrm", hacer: "planear", plan: null, zonaProtegida: [] }));
const servidor = http.createServer(async (pedido, respuesta) => {
  let texto = "";
  for await (const pedazo of pedido) texto += pedazo;
  const cuerpo = texto ? JSON.parse(texto) : {};
  const ruta = pedido.url.split("?")[0];
  rutas.push(ruta);
  let datos = { ok: true };
  if (ruta === "/api/trabajador/latido") latidos.push(cuerpo);
  else if (ruta === "/api/trabajador/tablero/candidatas") datos = { ok: true, candidatas: lista.filter((c) => !c.tomada) };
  else if (ruta === "/api/trabajador/tablero/tomar") {
    const c = lista.find((x) => !x.tomada && !(cuerpo.excluir ?? []).includes(x.id));
    if (c) c.tomada = true;
    datos = c ? { ok: true, tarjeta: c, hacer: c.hacer } : { ok: true, tarjeta: null, motivo: "nada" };
  }
  respuesta.writeHead(200, { "Content-Type": "application/json" });
  respuesta.end(JSON.stringify(datos));
});
await new Promise((resolver) => servidor.listen(0, "127.0.0.1", resolver));
const urlCrm = `http://127.0.0.1:${servidor.address().port}`;

// Una sesión falsa que, como la de verdad, llama a `claude` y, si falla, deja la tarjeta en ERROR (así se vería la cadena).
const tomadas = [];
const procesarTarjeta = async (opciones, tarjeta) => {
  tomadas.push(tarjeta.id);
  const resultado = await correr([...opciones.config.comandoClaude, "-p", "--permission-mode", "plan"], { entrada: `Tarea: ${tarjeta.titulo}\n`, timeoutMs: 20_000 });
  if (resultado.codigo !== 0) {
    await opciones.crm.error(tarjeta.id, `${resultado.salida}${resultado.errores}`.trim());
    return { ok: false };
  }
  return { ok: true };
};

try {
  await prueba("esErrorDeSesion: reconoce los 5 textos de sesión vencida y no otros", () => {
    for (const texto of ["OAuth session expired", "the token could not be refreshed", "Failed to authenticate. API Error: 401", "Not logged in", "Please run /login"]) {
      assert.equal(esErrorDeSesion(texto), true, texto);
    }
    assert.equal(esErrorDeSesion("OAUTH SESSION EXPIRED and could not be refreshed"), true, "sin importar mayúsculas");
    assert.equal(esErrorDeSesion("Claude AI usage limit reached|1761210000"), false, "el límite de uso es otra cosa");
    assert.equal(esErrorDeSesion(""), false);
    assert.equal(esErrorDeSesion(null), false);
  });

  await prueba("leer `auth status`: el JSON manda; sin JSON, 'Not logged in'; lo demás no se entiende (no pausa)", () => {
    assert.deepEqual(leerEstadoDeSesion({ codigo: 0, salida: '{\n  "loggedIn": true,\n  "authMethod": "oauth_token"\n}\n', errores: "" }), { loggedIn: true });
    assert.deepEqual(leerEstadoDeSesion({ codigo: 1, salida: '{"loggedIn":false}', errores: "" }), { loggedIn: false });
    assert.deepEqual(leerEstadoDeSesion({ codigo: 1, salida: "Not logged in. Run claude auth login", errores: "" }), { loggedIn: false });
    assert.equal(leerEstadoDeSesion({ codigo: 0, salida: "algo raro", errores: "" }).loggedIn, null);
    assert.equal(leerEstadoDeSesion({ codigo: 0, salida: '{"otra":1}', errores: "" }).loggedIn, null, "JSON sin loggedIn: no se entiende");
    assert.match(leerEstadoDeSesion({ vencido: true }).motivo, /no respondió en 30 s/);
  });

  await prueba("el comando que no responde o no se entiende NO pausa: solo queda anotado en el registro", async () => {
    const registro = registroFalso();
    const pedidos = [];
    const pausa = crearPausaPorSesion({
      config: nuevaConfig(),
      registro,
      correrComando: async (comando, opciones) => {
        pedidos.push({ comando, opciones });
        return { vencido: true, codigo: null, salida: "", errores: "" };
      },
    });
    await pausa.revisar();
    assert.equal(pausa.vencida(), false);
    assert.deepEqual(pedidos[0].comando.slice(-2), ["auth", "status"]);
    assert.equal(pedidos[0].opciones.timeoutMs, 30_000, "30 s como máximo");
    assert.ok(registro.lineas.some((l) => /^AVISO no pude revisar la sesión de Claude .*no respondió en 30 s/.test(l)), registro.lineas.join("\n"));
    assert.equal(pausa.resumen().revisadaEn, null, "una revisión sin respuesta clara no cuenta como revisada");
  });

  await prueba("con sesión, una revisión de hace menos de 1 minuto se reutiliza; en pausa se mira cada revisarMinutos", async () => {
    let reloj = Date.parse("2026-11-24T15:00:00Z");
    let loggedIn = true;
    let llamadas = 0;
    const pausa = crearPausaPorSesion({
      config: nuevaConfig({ sesionClaude: { revisarMinutos: 3 } }),
      registro: registroFalso(),
      ahora: () => reloj,
      correrComando: async () => {
        llamadas += 1;
        return { codigo: loggedIn ? 0 : 1, salida: JSON.stringify({ loggedIn }), errores: "" };
      },
    });
    await pausa.revisar();
    reloj += 59_000;
    await pausa.revisar();
    assert.equal(llamadas, 1, "menos de 1 minuto: no se vuelve a correr");
    reloj += 2_000;
    loggedIn = false;
    await pausa.revisar();
    assert.equal(llamadas, 2);
    assert.equal(pausa.vencida(), true);
    reloj += 2 * 60_000;
    loggedIn = true;
    await pausa.revisar();
    assert.equal(llamadas, 2, "en pausa: espera los 3 minutos");
    assert.equal(pausa.vencida(), true);
    reloj += 60_000;
    await pausa.revisar();
    assert.equal(llamadas, 3);
    assert.equal(pausa.vencida(), false, "volvió la sesión: sale sola");
  });

  await prueba("el estado se guarda: un reinicio del Coordinador en plena pausa sigue en pausa", async () => {
    const config = nuevaConfig();
    const reloj = Date.parse("2026-11-24T15:00:00Z");
    const primera = crearPausaPorSesion({ config, registro: registroFalso(), ahora: () => reloj });
    primera.marcarVencida("una etapa vio OAuth session expired");
    assert.equal(primera.vencida(), true);
    const guardado = JSON.parse(fs.readFileSync(path.join(config.carpetaTrabajo, "estado-sesion-claude.json"), "utf8"));
    assert.equal(guardado.vencida, true);
    const otra = crearPausaPorSesion({ config, registro: registroFalso(), ahora: () => reloj });
    assert.equal(otra.vencida(), true, "se lee al arrancar");
    assert.deepEqual(otra.resumen(), { vencida: true, desde: new Date(reloj).toISOString(), revisadaEn: null });
  });

  await prueba("(a) (c) (d) sin sesión: no toma ni falla tarjetas, los latidos dicen vencida y al volver la sesión toma otra vez", async () => {
    fs.writeFileSync(SIN_SESION, "sin sesión\n");
    const config = nuevaConfig({ urlCrm, sesionClaude: { revisarMinutos: 0.01 } });
    assert.equal(config.sesionClaude.revisarMinutos, 0.01);
    const registro = registroFalso();
    const crm = crearCrm(config);
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
    });
    const latido = crearLatido({ crm, config, registro, planificador, medidor: { medir: () => ({ cpu: 10, memoria: 20 }) }, cadaSegundos: 3600, leer: () => ({}) });
    try {
      // El latido del arranque sale antes de la primera revisión: no cuenta.
      await dormir(200);
      latidos.length = 0;
      for (let vuelta = 0; vuelta < 4; vuelta += 1) {
        await planificador.llenar();
        await latido.latirYa();
        await dormir(250);
      }
      // (a) nada de tomar, error ni reparación.
      assert.equal(planificador.pausadoPorSesion(), true, registro.lineas.join("\n"));
      assert.equal(typeof planificador.pausaSesion.marcarVencida, "function", "el objeto queda a mano (parte 2)");
      assert.deepEqual(tomadas, []);
      assert.deepEqual(rutas.filter((r) => /\/tomar$|\/error$|\/reparar$|\/candidatas$/.test(r)), [], rutas.join("\n"));
      // (c) los latidos siguen saliendo y dicen vencida; la línea de pausa sale una sola vez.
      assert.ok(latidos.length >= 4, `latidos: ${latidos.length}`);
      for (const cuerpo of latidos) assert.equal(cuerpo.sesionClaude?.vencida, true, JSON.stringify(cuerpo.sesionClaude));
      assert.ok(latidos.at(-1).sesionClaude.desde && latidos.at(-1).sesionClaude.revisadaEn);
      assert.equal(registro.lineas.filter((l) => l === "INFO En pausa: sesión de Claude vencida").length, 1, registro.lineas.join("\n"));
      const auth = fs.readFileSync(`${LOG}.auth`, "utf8").trim().split("\n");
      assert.ok(auth.length >= 2, "en pausa se vuelve a revisar cada revisarMinutos");

      // (d) vuelve la sesión: en la siguiente revisión sale de la pausa sola y toma las 3.
      fs.rmSync(SIN_SESION);
      await dormir(700);
      await planificador.llenar();
      assert.equal(planificador.pausadoPorSesion(), false);
      assert.ok(registro.lineas.some((l) => /sale la pausa por sesión de Claude/.test(l)), registro.lineas.join("\n"));
      assert.deepEqual([...tomadas].sort(), ["t1", "t2", "t3"]);
      assert.ok(rutas.includes("/api/trabajador/tablero/tomar"));
      await planificador.esperarTodas();
      assert.deepEqual(rutas.filter((r) => /\/error$|\/reparar$/.test(r)), [], "con sesión, la sesión falsa no falla");
      await latido.latirYa();
      assert.equal(latidos.at(-1).sesionClaude.vencida, false);
    } finally {
      latido.parar();
      planificador.parar();
    }
  });

  console.log(`\n${pruebas} pruebas de la pausa por sesión de Claude: todas bien`);
} finally {
  servidor.close();
  fs.rmSync(T, { recursive: true, force: true });
}
