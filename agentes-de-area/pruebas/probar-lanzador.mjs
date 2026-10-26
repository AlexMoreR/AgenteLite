// Pruebas del lanzador del agente de área (correr-agente.mjs) con un Claude de mentira y un CRM de mentira,
// como las del trabajador del tablero. Sin red, sin plan de Claude, sin esperas reales (el reloj es falso).
//   npm run test:agentes-de-area-lanzador
//
// Este mismo archivo hace de `claude` falso cuando se llama con --claude-falso (lee el prompt por stdin).
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ESTE = fileURLToPath(import.meta.url);

/* ───────────────────────────────────────────────────────────── el claude falso ── */
if (process.argv.includes("--claude-falso")) {
  let prompt = "";
  for await (const trozo of process.stdin) prompt += trozo;
  const salida = prompt.match(/^SALIDA: (.+)$/m)?.[1];
  const contador = process.env.CLAUDE_FALSO_CONTADOR;
  const veces = contador ? (fs.existsSync(contador) ? Number(fs.readFileSync(contador, "utf8")) : 0) + 1 : 1;
  if (contador) fs.writeFileSync(contador, String(veces));
  if ((process.env.CLAUDE_FALSO_MODO === "limite" && veces === 1) || process.env.CLAUDE_FALSO_MODO === "limite-siempre") {
    console.error("Claude AI usage limit reached|1761210000");
    process.exit(1);
  }
  if (process.env.CLAUDE_FALSO_MODO === "falla") {
    console.error("error raro de Claude");
    process.exit(1);
  }
  fs.writeFileSync(path.join(salida, "entorno.json"), JSON.stringify({ claveDeApi: Boolean(process.env.ANTHROPIC_API_KEY), subagentes: process.env.CLAUDE_CODE_SUBAGENT_MODEL, prompt }));
  fs.writeFileSync(
    path.join(salida, "mensajes.json"),
    JSON.stringify([
      { tipo: "asesora", numero: "573104445566", destinatario: "María Camila", texto: "Tu lista del día" },
      { tipo: "alexander", numero: "573001112233", destinatario: "Alexander", texto: "Ayer: 1 venta, cierre 0,6 %." },
      { tipo: "asesora", numero: "573104445566", destinatario: "María Camila", texto: "Repetido: no debe salir" },
    ]),
  );
  console.log("listo: resumen guardado y mensajes escritos (de mentira)");
  process.exit(0);
}

/* ───────────────────────────────────────────────────────────── las pruebas ── */
const { correrAgente, argumentosDeClaude, llamarMcp, leerMensajes, decidirCorrida, entornoDeClaude } = await import("../correr-agente.mjs");

const RAIZ = path.resolve(path.dirname(ESTE), "..", "..");
const base = fs.mkdtempSync(path.join(os.tmpdir(), "agente-ventas-"));
const config = {
  urlCrm: "https://crm.falso",
  claveMcp: "aizen_mcp_falsa",
  comandoClaude: [process.execPath, ESTE, "--claude-falso"],
  carpetaTrabajador: path.join(RAIZ, "trabajador-tablero"),
  carpetaSalida: path.join(base, "salida"),
  carpetaLogs: path.join(base, "logs"),
  horaDeInicio: "07:00",
  horaDeMensajes: "07:30",
  toleranciaMinutos: 10,
  modelo: null,
  modeloSubagentes: "sonnet",
  maxMinutosClaude: 2,
  esperaLimiteMinutos: 30,
  maxEsperaLimiteHoras: 6,
  reintentosEnvio: 3,
  esperaEnvioSegundos: 60,
};
const carpetaAgente = path.join(RAIZ, "agentes-de-area", "ventas");

// 27-oct-2026 es martes; 25 es domingo; 31 es sábado.
const a = (dia, hhmm) => new Date(`2026-10-${dia}T${hhmm}:00-05:00`);

/** Un reloj falso: dormir lo adelanta, sin esperar de verdad. */
function reloj(inicio) {
  let ahora = inicio.getTime();
  const dormidas = [];
  return { ahora: () => new Date(ahora), dormir: async (ms) => { dormidas.push(ms); ahora += ms; }, dormidas };
}

/** El CRM de mentira: solo equipo, interruptor, una vez por número (como el servidor de verdad). */
function crmFalso({ activo = true, falla = 0 } = {}) {
  const equipo = new Set(["573001112233", "573104445566"]);
  const vivos = new Set();
  const llamadas = [];
  let fallas = falla;
  return {
    llamadas,
    mcp: async (nombre, args) => {
      llamadas.push({ nombre, args });
      assert.equal(nombre, "mandar_whatsapp_al_equipo", "el lanzador solo manda mensajes");
      if (!equipo.has(args.numero)) return { se_mando: false, estado: "BLOQUEADO", motivo: "ese número no es del equipo" };
      if (!activo) return { se_mando: false, estado: "BLOQUEADO", motivo: "interruptor apagado: no se mandó" };
      if (fallas > 0) { fallas -= 1; return { se_mando: false, estado: "FALLIDO", motivo: "no salió: línea caída" }; }
      if (vivos.has(args.numero)) return { se_mando: false, estado: "BLOQUEADO", motivo: "ya se le mandó hoy" };
      vivos.add(args.numero);
      return { se_mando: true, estado: "ENVIADO" };
    },
  };
}

let pruebas = 0;
const fallasDeLaPrueba = [];
async function prueba(nombre, fn) {
  try {
    await fn();
    pruebas += 1;
    console.log(`ok - ${nombre}`);
  } catch (error) {
    fallasDeLaPrueba.push(nombre);
    console.log(`FALLA - ${nombre}\n  ${String(error?.stack ?? error).split("\n").slice(0, 6).join("\n  ")}`);
  }
}
const limpiarDia = () => { fs.rmSync(config.carpetaSalida, { recursive: true, force: true }); };
const ejecutar = (opciones) => correrAgente({ config, carpetaAgente, carpetaBase: base, ...opciones });
process.env.ANTHROPIC_API_KEY = "sk-ant-de-pago-NO-DEBE-USARSE";

await prueba("a tiempo: corre a las 7:00, espera hasta las 7:30 y entrega UN mensaje a Alexander y UNO a la asesora", async () => {
  limpiarDia();
  const r = reloj(a(27, "07:00"));
  const crm = crmFalso();
  const resultado = await ejecutar({ ahora: r.ahora, dormir: r.dormir, mcp: crm.mcp });
  assert.equal(resultado.ok, true);
  assert.deepEqual(r.dormidas, [30 * 60_000], "espera exactamente hasta las 7:30");
  assert.equal(crm.llamadas.length, 2, "el repetido de la asesora no se manda");
  assert.equal(crm.llamadas[0].args.tipo, "alexander", "Alexander va primero");
  assert.ok(!crm.llamadas[0].args.texto.startsWith("Salió tarde"));
  assert.equal(crm.llamadas.filter((l) => l.args.numero === "573104445566").length, 1);
  assert.ok(fs.existsSync(path.join(config.carpetaSalida, "2026-10-27", "terminado.json")));
});

await prueba("el agente corre con el plan, no con la API de pago: sin clave de API y subagentes en Sonnet", async () => {
  const entorno = JSON.parse(fs.readFileSync(path.join(config.carpetaSalida, "2026-10-27", "entorno.json"), "utf8"));
  assert.equal(entorno.claveDeApi, false);
  assert.equal(entorno.subagentes, "sonnet");
  assert.ok(entorno.prompt.includes("- cerrador:") && entorno.prompt.includes("- cobrador:"));
  assert.ok(!entorno.prompt.includes("- analista-de-perdidos:"), "entre semana no va el analista");
  assert.equal(entornoDeClaude(config, { ANTHROPIC_API_KEY: "x", PATH: "p" }).ANTHROPIC_API_KEY, undefined);
});

await prueba("el agente no tiene permiso de mandar WhatsApp ni de usar Bash", () => {
  const texto = argumentosDeClaude(config).join(" ");
  assert.ok(!texto.includes("mandar_whatsapp_al_equipo"));
  assert.ok(texto.includes("--disallowedTools Bash"));
  assert.ok(texto.includes("mcp__aizencrm__guardar_resumen_del_dia"));
});

await prueba("ya corrió hoy: no se repite (ni se manda dos veces); con --repetir sí corre", async () => {
  const crm = crmFalso();
  const r = reloj(a(27, "07:05"));
  const segunda = await ejecutar({ ahora: r.ahora, dormir: r.dormir, mcp: crm.mcp });
  assert.equal(segunda.saltada, true);
  assert.equal(crm.llamadas.length, 0);
  const otra = await ejecutar({ ahora: r.ahora, dormir: r.dormir, mcp: crm.mcp, repetir: true });
  assert.equal(otra.ok, true);
});

await prueba("tarde: aizen1 prendió a las 8:12, corre enseguida y Alexander lee 'Salió tarde (aizen1 prendió a las 8:12)'", async () => {
  limpiarDia();
  const r = reloj(a(27, "08:12"));
  const crm = crmFalso();
  const resultado = await ejecutar({ ahora: r.ahora, dormir: r.dormir, mcp: crm.mcp });
  assert.equal(resultado.ok, true);
  assert.deepEqual(r.dormidas, [], "ya pasaron las 7:30: no espera");
  assert.ok(crm.llamadas[0].args.texto.startsWith("Salió tarde (aizen1 prendió a las 8:12)"));
  assert.ok(!crm.llamadas[1].args.texto.startsWith("Salió tarde"), "la asesora no recibe el aviso");
});

await prueba("se agota el límite del plan de Claude: espera 30 min y reintenta sin romper nada", async () => {
  limpiarDia();
  const contador = path.join(base, "contador.txt");
  fs.rmSync(contador, { force: true });
  process.env.CLAUDE_FALSO_MODO = "limite";
  process.env.CLAUDE_FALSO_CONTADOR = contador;
  try {
    const r = reloj(a(27, "07:00"));
    const crm = crmFalso();
    const resultado = await ejecutar({ ahora: r.ahora, dormir: r.dormir, mcp: crm.mcp });
    assert.equal(resultado.ok, true);
    assert.equal(Number(fs.readFileSync(contador, "utf8")), 2, "Claude se abrió dos veces");
    assert.equal(r.dormidas[0], 30 * 60_000, "la primera espera es la del límite");
    assert.equal(r.dormidas.length, 1, "terminó 7:30 justo: ya no espera más");
    assert.ok(crm.llamadas.length === 2);
  } finally {
    delete process.env.CLAUDE_FALSO_MODO;
    delete process.env.CLAUDE_FALSO_CONTADOR;
  }
});

await prueba("si el límite no se reinicia en 6 horas, se rinde con error claro y sin mandar nada", async () => {
  limpiarDia();
  process.env.CLAUDE_FALSO_MODO = "limite-siempre";
  try {
    const r = reloj(a(27, "07:00"));
    const crm = crmFalso();
    const resultado = await ejecutar({ ahora: r.ahora, dormir: r.dormir, mcp: crm.mcp });
    assert.equal(resultado.ok, false);
    assert.equal(resultado.motivo, "límite del plan de Claude");
    assert.equal(crm.llamadas.length, 0);
    assert.ok(resultado.fallas.length >= 1);
  } finally {
    delete process.env.CLAUDE_FALSO_MODO;
    delete process.env.CLAUDE_FALSO_CONTADOR;
  }
});

await prueba("si Claude falla por otra cosa: error, últimas líneas en el log y no manda nada", async () => {
  limpiarDia();
  process.env.CLAUDE_FALSO_MODO = "falla";
  try {
    const crm = crmFalso();
    const r = reloj(a(27, "07:00"));
    const resultado = await ejecutar({ ahora: r.ahora, dormir: r.dormir, mcp: crm.mcp });
    assert.equal(resultado.ok, false);
    assert.equal(crm.llamadas.length, 0);
    assert.ok(fs.readFileSync(path.join(config.carpetaLogs, "2026-10-27.log"), "utf8").includes("error raro de Claude"));
  } finally {
    delete process.env.CLAUDE_FALSO_MODO;
  }
});

await prueba("en domingo no corre; en sábado va el analista de perdidos", async () => {
  limpiarDia();
  const crm = crmFalso();
  const domingo = await ejecutar({ ahora: () => a(25, "07:00"), dormir: async () => {}, mcp: crm.mcp });
  assert.equal(domingo.saltada, true);
  assert.equal(crm.llamadas.length, 0);
  const r = reloj(a(31, "07:00"));
  await ejecutar({ ahora: r.ahora, dormir: r.dormir, mcp: crm.mcp });
  const entorno = JSON.parse(fs.readFileSync(path.join(config.carpetaSalida, "2026-10-31", "entorno.json"), "utf8"));
  assert.ok(entorno.prompt.includes("- analista-de-perdidos:"));
  assert.equal(decidirCorrida({ ahora: a(27, "07:00"), config, forzarSabado: true }).esSabado, true);
});

await prueba("con el interruptor apagado el servidor no deja salir nada y el lanzador no falla", async () => {
  limpiarDia();
  const crm = crmFalso({ activo: false });
  const r = reloj(a(27, "07:00"));
  const resultado = await ejecutar({ ahora: r.ahora, dormir: r.dormir, mcp: crm.mcp });
  assert.equal(resultado.ok, true);
  assert.ok(resultado.resultados.every((x) => x.estado === "BLOQUEADO" && x.motivo.includes("interruptor apagado")));
});

await prueba("un mensaje que no sale (línea Admin caída) se reintenta y no se duplica", async () => {
  limpiarDia();
  const crm = crmFalso({ falla: 1 });
  const r = reloj(a(27, "07:00"));
  const resultado = await ejecutar({ ahora: r.ahora, dormir: r.dormir, mcp: crm.mcp });
  assert.equal(resultado.ok, true);
  assert.equal(crm.llamadas.length, 3, "Alexander dos veces (falló y reintentó) y la asesora una");
  assert.ok(r.dormidas.includes(60_000));
});

await prueba("mensajes.json: un solo Alexander y un mensaje por número", () => {
  assert.throws(() => leerMensajes(JSON.stringify([{ tipo: "alexander", numero: "573001112233", texto: "a" }, { tipo: "alexander", numero: "573001112234", texto: "b" }])), /más de un mensaje/);
  const lista = leerMensajes(JSON.stringify([{ tipo: "asesora", numero: "573104445566", texto: "x" }, { tipo: "asesora", numero: "+57 310 444 5566", texto: "y" }, { tipo: "cliente", numero: "573205557788", texto: "z" }]));
  assert.equal(lista.length, 1);
});

await prueba("llamarMcp habla JSON-RPC con la clave del CRM", async () => {
  let pedido;
  const fetchFn = async (url, init) => {
    pedido = { url, init };
    return { ok: true, json: async () => ({ result: { content: [{ type: "text", text: JSON.stringify({ se_mando: false, estado: "BLOQUEADO" }) }] } }) };
  };
  const r = await llamarMcp(config, "mandar_whatsapp_al_equipo", { numero: "1" }, { fetchFn });
  assert.equal(r.estado, "BLOQUEADO");
  assert.equal(pedido.url, "https://crm.falso/api/mcp");
  assert.equal(pedido.init.headers.Authorization, "Bearer aizen_mcp_falsa");
  assert.equal(JSON.parse(pedido.init.body).params.name, "mandar_whatsapp_al_equipo");
});

fs.rmSync(base, { recursive: true, force: true });
console.log(`\n${pruebas} pruebas ok, ${fallasDeLaPrueba.length} con falla`);
if (fallasDeLaPrueba.length) {
  console.log("Fallaron:\n- " + fallasDeLaPrueba.join("\n- "));
  process.exit(1);
}
