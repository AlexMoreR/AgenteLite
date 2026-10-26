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
  // Marketing y sistemas no escriben mensajes.json: guardan su resumen en el CRM y listo.
  const sinMensajes = prompt.includes("Agente de Marketing") || prompt.includes("Agente de Sistemas");
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
  if (sinMensajes) {
    console.log("listo: resumen guardado (de mentira)");
    process.exit(0);
  }
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
const { correrAgente, argumentosDeClaude, llamarMcp, leerMensajes, decidirCorrida, entornoDeClaude, lineaDeMarketing, conLineaDeMarketing, lineaDeSistemas, conLineaDeSistemas } = await import("../correr-agente.mjs");
const { META_ESCRITURA, META_LECTURA } = await import("../lib/candado-meta.mjs");

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
function crmFalso({ activo = true, falla = 0, marketing = { interruptor: "apagado", resumen: null }, sistemas = { interruptor: "apagado", resumen: { linea_para_alexander: "Sistemas: todo funciona" } } } = {}) {
  const equipo = new Set(["573001112233", "573104445566"]);
  const vivos = new Set();
  const llamadas = [];
  const llamadasDeMarketing = [];
  const llamadasDeSistemas = [];
  let fallas = falla;
  return {
    llamadas,
    llamadasDeMarketing,
    llamadasDeSistemas,
    mcp: async (nombre, args) => {
      if (nombre === "agente_de_sistemas") {
        llamadasDeSistemas.push(args);
        if (sistemas === "error") throw new Error("el CRM contestó 500");
        return { interruptor: sistemas.interruptor, resumen_del_dia: sistemas.resumen };
      }
      if (nombre === "agente_de_marketing") {
        llamadasDeMarketing.push(args);
        if (marketing === "error") throw new Error("el CRM contestó 500");
        return { interruptor: marketing.interruptor, resumen_del_dia: marketing.resumen };
      }
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

/* ───────────────────────────────────────────────────────────── Agente de Marketing ── */
const carpetaMarketing = path.join(RAIZ, "agentes-de-area", "marketing");
const ejecutarMarketing = (opciones) => correrAgente({ config, area: "marketing", carpetaAgente: carpetaMarketing, carpetaBase: base, ...opciones });
const resumenDeMarketing = (extra = {}) => ({
  linea_para_alexander: "Combo Diván gastó $98.000 ayer: 41 conversaciones, 3 Calientes, 0 ventas",
  recomendacion: { accion: "bajar", texto: "bajar el anuncio 'Diván azul'", dato: "$61.000 en 7 días sin un solo Caliente" },
  salio_tarde: false,
  nota_de_retraso: null,
  ...extra,
});

await prueba("marketing: corre a las 6:45, guarda su resumen y NO manda ningún mensaje; entre semana sin ideas de anuncio", async () => {
  limpiarDia();
  const r = reloj(a(27, "06:45"));
  const crm = crmFalso({ marketing: { interruptor: "apagado", resumen: resumenDeMarketing() } });
  const resultado = await ejecutarMarketing({ ahora: r.ahora, dormir: r.dormir, mcp: crm.mcp });
  assert.equal(resultado.ok, true);
  assert.equal(resultado.decision.salioTarde, false);
  assert.deepEqual(r.dormidas, [], "marketing no espera hasta las 7:30");
  assert.equal(crm.llamadas.length, 0, "marketing no manda WhatsApp");
  const carpetaDia = path.join(config.carpetaSalida, "2026-10-27", "marketing");
  assert.ok(fs.existsSync(path.join(carpetaDia, "terminado.json")));
  assert.ok(!fs.existsSync(path.join(carpetaDia, "en-curso.json")), "al terminar quita la marca de 'corriendo'");
  assert.ok(!fs.existsSync(path.join(carpetaDia, "mensajes.json")));
  const entorno = JSON.parse(fs.readFileSync(path.join(carpetaDia, "entorno.json"), "utf8"));
  assert.equal(entorno.claveDeApi, false);
  assert.ok(entorno.prompt.includes("- vigilante-de-pauta:") && entorno.prompt.includes("- calidad-del-lead:"));
  assert.ok(!entorno.prompt.includes("- ideas-de-anuncio:"), "las ideas solo van los lunes");
});

await prueba("marketing: los lunes se agrega el subagente de ideas; --forzar-lunes lo fuerza", async () => {
  limpiarDia();
  const crm = crmFalso({ marketing: { interruptor: "apagado", resumen: resumenDeMarketing() } });
  const lunes = reloj(a(26, "06:45"));
  await ejecutarMarketing({ ahora: lunes.ahora, dormir: lunes.dormir, mcp: crm.mcp });
  const entorno = JSON.parse(fs.readFileSync(path.join(config.carpetaSalida, "2026-10-26", "marketing", "entorno.json"), "utf8"));
  assert.ok(entorno.prompt.includes("- ideas-de-anuncio:"));
  assert.equal(decidirCorrida({ ahora: a(27, "06:45"), config, forzarLunes: true, area: "marketing" }).esLunes, true);
  assert.equal(decidirCorrida({ ahora: a(27, "06:45"), config, area: "marketing" }).esLunes, false);
});

await prueba("marketing: en domingo no corre; prendió a las 8:12 → sale tarde y lo anota", async () => {
  limpiarDia();
  const crm = crmFalso({ marketing: { interruptor: "apagado", resumen: resumenDeMarketing() } });
  const domingo = await ejecutarMarketing({ ahora: () => a(25, "06:45"), dormir: async () => {}, mcp: crm.mcp });
  assert.equal(domingo.saltada, true);
  const r = reloj(a(27, "08:12"));
  const tarde = await ejecutarMarketing({ ahora: r.ahora, dormir: r.dormir, mcp: crm.mcp });
  assert.equal(tarde.decision.salioTarde, true);
  assert.equal(tarde.nota, "aizen1 prendió a las 8:12");
  const entorno = JSON.parse(fs.readFileSync(path.join(config.carpetaSalida, "2026-10-27", "marketing", "entorno.json"), "utf8"));
  assert.ok(entorno.prompt.includes("SALIO_TARDE: si (aizen1 prendió a las 8:12)"));
  // A las 6:50 todavía está dentro de la tolerancia.
  assert.equal(decidirCorrida({ ahora: a(27, "06:50"), config, area: "marketing" }).salioTarde, false);
});

await prueba("marketing: si no guardó su resumen en el CRM, es un error claro", async () => {
  limpiarDia();
  const crm = crmFalso({ marketing: { interruptor: "apagado", resumen: null } });
  const r = reloj(a(27, "06:45"));
  const resultado = await ejecutarMarketing({ ahora: r.ahora, dormir: r.dormir, mcp: crm.mcp });
  assert.equal(resultado.ok, false);
  assert.equal(resultado.motivo, "sin resumen");
});

await prueba("ventas lee marketing: con el interruptor PRENDIDO su línea y su recomendación van en el MISMO mensaje a Alexander", async () => {
  limpiarDia();
  const crm = crmFalso({ marketing: { interruptor: "prendido", resumen: resumenDeMarketing() } });
  const r = reloj(a(27, "07:00"));
  const resultado = await ejecutar({ ahora: r.ahora, dormir: r.dormir, mcp: crm.mcp });
  assert.equal(resultado.ok, true);
  assert.equal(crm.llamadas.length, 2, "sigue siendo un mensaje a Alexander y uno a la asesora");
  const alexander = crm.llamadas.filter((l) => l.args.tipo === "alexander");
  assert.equal(alexander.length, 1, "UN solo mensaje a Alexander");
  assert.ok(alexander[0].args.texto.includes("Ayer: 1 venta"));
  assert.ok(alexander[0].args.texto.includes("Marketing: Combo Diván gastó $98.000"));
  assert.ok(alexander[0].args.texto.includes("Recomendación: bajar el anuncio 'Diván azul' ($61.000 en 7 días sin un solo Caliente)"));
  assert.ok(!crm.llamadas.find((l) => l.args.tipo === "asesora").args.texto.includes("Marketing"), "la asesora no recibe la línea de marketing");
  assert.equal(crm.llamadasDeMarketing[0].fecha, "2026-10-27");
});

await prueba("ventas lee marketing: con el interruptor APAGADO la línea NO entra en el mensaje", async () => {
  limpiarDia();
  const crm = crmFalso({ marketing: { interruptor: "apagado", resumen: resumenDeMarketing() } });
  const r = reloj(a(27, "07:00"));
  await ejecutar({ ahora: r.ahora, dormir: r.dormir, mcp: crm.mcp });
  assert.ok(!crm.llamadas[0].args.texto.includes("Marketing"));
});

await prueba("ventas lee marketing: prendido pero sin corrida → 'Marketing: sin resumen hoy'; salió tarde → lo dice", async () => {
  limpiarDia();
  const sin = crmFalso({ marketing: { interruptor: "prendido", resumen: null } });
  let r = reloj(a(27, "07:00"));
  await ejecutar({ ahora: r.ahora, dormir: r.dormir, mcp: sin.mcp });
  assert.ok(sin.llamadas[0].args.texto.endsWith("Marketing: sin resumen hoy"));
  limpiarDia();
  const tarde = crmFalso({ marketing: { interruptor: "prendido", resumen: resumenDeMarketing({ salio_tarde: true, nota_de_retraso: "aizen1 prendió a las 7:41" }) } });
  r = reloj(a(27, "07:00"));
  await ejecutar({ ahora: r.ahora, dormir: r.dormir, mcp: tarde.mcp });
  assert.ok(tarde.llamadas[0].args.texto.includes("(salió tarde: aizen1 prendió a las 7:41)"));
});

await prueba("ventas espera hasta 15 min a que marketing termine; si no termina, sigue sin él", async () => {
  limpiarDia();
  const carpetaDia = path.join(config.carpetaSalida, "2026-10-27", "marketing");
  fs.mkdirSync(carpetaDia, { recursive: true });
  fs.writeFileSync(path.join(carpetaDia, "en-curso.json"), "{}");
  const crm = crmFalso({ marketing: { interruptor: "prendido", resumen: null } });
  const r = reloj(a(27, "07:00"));
  const resultado = await ejecutar({ ahora: r.ahora, dormir: r.dormir, mcp: crm.mcp });
  assert.equal(resultado.ok, true);
  assert.equal(r.dormidas.filter((ms) => ms === 60_000).length, 15, "15 esperas de un minuto");
  assert.ok(r.dormidas.reduce((x, y) => x + y, 0) >= 30 * 60_000 + 15 * 60_000);
  // Si marketing termina a los 3 minutos, deja de esperar.
  limpiarDia();
  fs.mkdirSync(carpetaDia, { recursive: true });
  fs.writeFileSync(path.join(carpetaDia, "en-curso.json"), "{}");
  const r2 = reloj(a(27, "07:00"));
  let esperas = 0;
  const dormir = async (ms) => {
    await r2.dormir(ms);
    if (ms === 60_000 && ++esperas === 3) fs.writeFileSync(path.join(carpetaDia, "terminado.json"), "{}");
  };
  await ejecutar({ ahora: r2.ahora, dormir, mcp: crm.mcp });
  assert.equal(esperas, 3);
});

await prueba("ventas lee marketing: si el CRM no contesta, el mensaje sale igual y sin línea", async () => {
  limpiarDia();
  const crm = crmFalso({ marketing: "error" });
  const r = reloj(a(27, "07:00"));
  const resultado = await ejecutar({ ahora: r.ahora, dormir: r.dormir, mcp: crm.mcp });
  assert.equal(resultado.ok, true);
  assert.ok(!crm.llamadas[0].args.texto.includes("Marketing"));
});

await prueba("lineaDeMarketing y conLineaDeMarketing: puras, sin duplicar la línea", () => {
  assert.equal(lineaDeMarketing({ interruptor: "apagado", resumen_del_dia: resumenDeMarketing() }), null);
  assert.equal(lineaDeMarketing(null), null);
  assert.equal(lineaDeMarketing({ interruptor: "prendido", resumen_del_dia: null }), "Marketing: sin resumen hoy");
  const linea = lineaDeMarketing({ interruptor: "prendido", resumen_del_dia: { linea_para_alexander: "Marketing: todo tranquilo" } });
  assert.equal(linea, "Marketing: todo tranquilo");
  assert.equal(conLineaDeMarketing("Hola", linea), "Hola\n\nMarketing: todo tranquilo");
  assert.equal(conLineaDeMarketing("Hola\nMarketing: ya estaba", linea), "Hola\nMarketing: ya estaba");
  assert.equal(conLineaDeMarketing("Hola", null), "Hola");
});

await prueba("marketing abre Claude con Meta SOLO de lectura y sin WhatsApp; ventas no recibe herramientas de Meta", () => {
  const args = argumentosDeClaude(config, "marketing");
  const permitidas = args.slice(args.indexOf("--allowedTools") + 1, args.indexOf("--disallowedTools"));
  const prohibidas = args.slice(args.indexOf("--disallowedTools") + 1);
  for (const herramienta of META_LECTURA) assert.ok(permitidas.includes(herramienta), `permitida: ${herramienta}`);
  for (const herramienta of META_ESCRITURA) {
    assert.ok(!permitidas.includes(herramienta), `no permitida: ${herramienta}`);
    assert.ok(prohibidas.includes(herramienta), `prohibida: ${herramienta}`);
  }
  assert.ok(permitidas.includes("mcp__aizencrm__numeros_de_marketing") && permitidas.includes("mcp__aizencrm__guardar_resumen_del_dia"));
  assert.ok(!permitidas.some((x) => x.includes("mandar_whatsapp_al_equipo")) && prohibidas.includes("mcp__aizencrm__mandar_whatsapp_al_equipo"));
  assert.ok(prohibidas.includes("Bash"));
  const ventas = argumentosDeClaude(config, "ventas").join(" ");
  assert.ok(!ventas.includes("meta-ads") && ventas.includes("mcp__aizencrm__agente_de_marketing"));
});

/* ───────────────────────────────────────────────────────────── Agente de Sistemas ── */
const carpetaSistemas = path.join(RAIZ, "agentes-de-area", "sistemas");
const configSistemas = { ...config, tableroEmanuelId: "tablero-emanuel", urlGestion: "https://gestion.falso" };
const ejecutarSistemas = (opciones) => correrAgente({ config: configSistemas, area: "sistemas", carpetaAgente: carpetaSistemas, carpetaBase: base, ...opciones });
const entornoDeSistemas = (fecha) => JSON.parse(fs.readFileSync(path.join(config.carpetaSalida, fecha, "sistemas", "entorno.json"), "utf8"));

await prueba("sistemas: corre a las 6:30, guarda su resumen y NO manda ningún mensaje; entre semana sin el subagente de uso", async () => {
  limpiarDia();
  const r = reloj(a(27, "06:30"));
  const crm = crmFalso({ sistemas: { interruptor: "apagado", resumen: { linea_para_alexander: "Sistemas: todo funciona" } } });
  const resultado = await ejecutarSistemas({ ahora: r.ahora, dormir: r.dormir, mcp: crm.mcp });
  assert.equal(resultado.ok, true);
  assert.equal(resultado.decision.salioTarde, false);
  assert.deepEqual(r.dormidas, [], "sistemas no espera hasta las 7:30");
  assert.equal(crm.llamadas.length, 0, "sistemas no manda WhatsApp");
  const carpetaDia = path.join(config.carpetaSalida, "2026-10-27", "sistemas");
  assert.ok(fs.existsSync(path.join(carpetaDia, "terminado.json")));
  assert.ok(!fs.existsSync(path.join(carpetaDia, "en-curso.json")));
  assert.ok(!fs.existsSync(path.join(carpetaDia, "mensajes.json")));
  const entorno = entornoDeSistemas("2026-10-27");
  assert.equal(entorno.claveDeApi, false);
  assert.ok(entorno.prompt.includes("- revisor-de-produccion:") && entorno.prompt.includes("- salud-del-sistema:"));
  assert.ok(!entorno.prompt.includes("- uso:"), "el uso solo va los lunes");
});

await prueba("sistemas: los lunes se agrega el subagente de uso; --forzar-lunes lo fuerza", async () => {
  limpiarDia();
  const crm = crmFalso();
  const lunes = reloj(a(26, "06:30"));
  await ejecutarSistemas({ ahora: lunes.ahora, dormir: lunes.dormir, mcp: crm.mcp });
  assert.ok(entornoDeSistemas("2026-10-26").prompt.includes("- uso:"));
  limpiarDia();
  const martes = reloj(a(27, "06:30"));
  await ejecutarSistemas({ ahora: martes.ahora, dormir: martes.dormir, mcp: crm.mcp, forzarLunes: true });
  assert.ok(entornoDeSistemas("2026-10-27").prompt.includes("- uso:"));
});

await prueba("sistemas: en domingo no corre; prendió a las 8:12 → sale tarde y lo anota", async () => {
  limpiarDia();
  const crm = crmFalso();
  const domingo = reloj(a(25, "06:30"));
  const saltada = await ejecutarSistemas({ ahora: domingo.ahora, dormir: domingo.dormir, mcp: crm.mcp });
  assert.equal(saltada.saltada, true);
  limpiarDia();
  const tarde = reloj(a(27, "08:12"));
  const resultado = await ejecutarSistemas({ ahora: tarde.ahora, dormir: tarde.dormir, mcp: crm.mcp });
  assert.equal(resultado.decision.salioTarde, true);
  assert.ok(entornoDeSistemas("2026-10-27").prompt.includes("SALIO_TARDE: si (aizen1 prendió a las 8:12)"));
});

await prueba("sistemas: si no guardó su resumen en el CRM, es un error claro", async () => {
  limpiarDia();
  const crm = crmFalso({ sistemas: { interruptor: "apagado", resumen: null } });
  const r = reloj(a(27, "06:30"));
  const resultado = await ejecutarSistemas({ ahora: r.ahora, dormir: r.dormir, mcp: crm.mcp });
  assert.equal(resultado.ok, false);
  assert.equal(resultado.motivo, "sin resumen");
});

await prueba("sistemas: PUEDE_CREAR_TARJETAS solo con el interruptor prendido y fuera de --prueba", async () => {
  const resumen = { linea_para_alexander: "Sistemas: todo funciona" };
  for (const [interruptor, esPrueba, esperado] of [["apagado", false, "no"], ["prendido", true, "no"], ["prendido", false, "si"]]) {
    limpiarDia();
    const r = reloj(a(27, "06:30"));
    const crm = crmFalso({ sistemas: { interruptor, resumen } });
    await ejecutarSistemas({ ahora: r.ahora, dormir: r.dormir, mcp: crm.mcp, esPrueba });
    assert.ok(entornoDeSistemas("2026-10-27").prompt.includes(`PUEDE_CREAR_TARJETAS: ${esperado}`), `${interruptor} prueba=${esPrueba} → ${esperado}`);
    assert.ok(entornoDeSistemas("2026-10-27").prompt.includes("TABLERO_DE_EMANUEL: tablero-emanuel"));
  }
  // Si el CRM no deja leer el interruptor, cuenta como apagado.
  limpiarDia();
  const r = reloj(a(27, "06:30"));
  const roto = crmFalso({ sistemas: "error" });
  const resultado = await ejecutarSistemas({ ahora: r.ahora, dormir: r.dormir, mcp: roto.mcp });
  assert.equal(resultado.ok, true, "la corrida sigue (la verificación del resumen es solo un aviso)");
  assert.ok(entornoDeSistemas("2026-10-27").prompt.includes("PUEDE_CREAR_TARJETAS: no"));
});

await prueba("ventas lee sistemas: PRENDIDO su línea va en el MISMO mensaje a Alexander; APAGADO no entra", async () => {
  limpiarDia();
  const prendido = crmFalso({ sistemas: { interruptor: "prendido", resumen: { linea_para_alexander: "Sistemas: falla “Tabla de campañas” (HTTP 500)" } } });
  const r = reloj(a(27, "07:00"));
  const resultado = await ejecutar({ ahora: r.ahora, dormir: r.dormir, mcp: prendido.mcp });
  assert.equal(resultado.ok, true);
  assert.equal(prendido.llamadas.length, 2, "sigue siendo un mensaje a Alexander y uno a la asesora");
  const alexander = prendido.llamadas.filter((l) => l.args.tipo === "alexander");
  assert.equal(alexander.length, 1, "UN solo mensaje a Alexander");
  assert.ok(alexander[0].args.texto.includes("Sistemas: falla “Tabla de campañas” (HTTP 500)"));
  assert.ok(!prendido.llamadas.find((l) => l.args.tipo === "asesora").args.texto.includes("Sistemas"), "la asesora no recibe la línea de sistemas");
  limpiarDia();
  const apagado = crmFalso({ sistemas: { interruptor: "apagado", resumen: { linea_para_alexander: "Sistemas: todo funciona" } } });
  const r2 = reloj(a(27, "07:00"));
  await ejecutar({ ahora: r2.ahora, dormir: r2.dormir, mcp: apagado.mcp });
  assert.ok(!apagado.llamadas.find((l) => l.args.tipo === "alexander").args.texto.includes("Sistemas"));
});

await prueba("ventas lee sistemas: prendido pero sin corrida → 'Sistemas: sin revisión hoy'; si el CRM no contesta, sin línea", async () => {
  limpiarDia();
  const sinCorrida = crmFalso({ sistemas: { interruptor: "prendido", resumen: null } });
  const r = reloj(a(27, "07:00"));
  await ejecutar({ ahora: r.ahora, dormir: r.dormir, mcp: sinCorrida.mcp });
  assert.ok(sinCorrida.llamadas.find((l) => l.args.tipo === "alexander").args.texto.includes("Sistemas: sin revisión hoy"));
  limpiarDia();
  const roto = crmFalso({ sistemas: "error" });
  const r2 = reloj(a(27, "07:00"));
  const resultado = await ejecutar({ ahora: r2.ahora, dormir: r2.dormir, mcp: roto.mcp });
  assert.equal(resultado.ok, true);
  assert.ok(!roto.llamadas.find((l) => l.args.tipo === "alexander").args.texto.includes("Sistemas"));
});

await prueba("ventas espera hasta 15 min a que sistemas termine", async () => {
  limpiarDia();
  const carpetaDia = path.join(config.carpetaSalida, "2026-10-27", "sistemas");
  fs.mkdirSync(carpetaDia, { recursive: true });
  fs.writeFileSync(path.join(carpetaDia, "en-curso.json"), "{}");
  const crm = crmFalso({ sistemas: { interruptor: "prendido", resumen: { linea_para_alexander: "Sistemas: todo funciona" } } });
  const r = reloj(a(27, "07:00"));
  const originalDormir = r.dormir;
  let n = 0;
  await ejecutar({
    ahora: r.ahora,
    dormir: async (ms) => {
      await originalDormir(ms);
      n += 1;
      if (n === 4) fs.writeFileSync(path.join(carpetaDia, "terminado.json"), "{}"); // la 1.ª es hasta las 7:30; terminó en la 3.ª espera de un minuto
    },
    mcp: crm.mcp,
  });
  assert.equal(r.dormidas.filter((ms) => ms === 60_000).length, 3, "esperó de a un minuto hasta que sistemas terminó (no los 15)");
  assert.ok(crm.llamadas.find((l) => l.args.tipo === "alexander").args.texto.includes("Sistemas: todo funciona"));
});

await prueba("lineaDeSistemas y conLineaDeSistemas: puras, sin duplicar la línea", () => {
  assert.equal(lineaDeSistemas({ interruptor: "apagado", resumen_del_dia: { linea_para_alexander: "Sistemas: todo funciona" } }), null);
  assert.equal(lineaDeSistemas(null), null);
  assert.equal(lineaDeSistemas({ interruptor: "prendido", resumen_del_dia: null }), "Sistemas: sin revisión hoy");
  assert.equal(lineaDeSistemas({ interruptor: "prendido", resumen_del_dia: { linea_para_alexander: "todo funciona", salio_tarde: true, nota_de_retraso: "aizen1 prendió a las 8:12" } }), "Sistemas: todo funciona (salió tarde: aizen1 prendió a las 8:12)");
  assert.equal(conLineaDeSistemas("Hola", "Sistemas: todo funciona"), "Hola\n\nSistemas: todo funciona");
  assert.equal(conLineaDeSistemas("Hola\nSistemas: ya estaba", "Sistemas: otra"), "Hola\nSistemas: ya estaba");
  assert.equal(conLineaDeSistemas("Hola", null), "Hola");
});

await prueba("sistemas abre Claude SOLO de lectura: sin Write/Edit, sin WhatsApp, sin git/gh/npm y con los tres programas; crear_tarjeta solo si se puede", () => {
  const apagado = argumentosDeClaude(config, "sistemas");
  const encendido = argumentosDeClaude(config, "sistemas", { puedeCrearTarjetas: true });
  const parte = (args) => ({ permitidas: args.slice(args.indexOf("--allowedTools") + 1, args.indexOf("--disallowedTools")), prohibidas: args.slice(args.indexOf("--disallowedTools") + 1) });
  const a1 = parte(apagado);
  const a2 = parte(encendido);
  assert.ok(!a1.permitidas.includes("mcp__aizencrm__crear_tarjeta") && a1.prohibidas.includes("mcp__aizencrm__crear_tarjeta"), "apagado/prueba: sin crear_tarjeta");
  assert.ok(a2.permitidas.includes("mcp__aizencrm__crear_tarjeta") && !a2.prohibidas.includes("mcp__aizencrm__crear_tarjeta"), "prendido: con crear_tarjeta");
  for (const { permitidas, prohibidas } of [a1, a2]) {
    for (const x of ["Write", "Edit", "Bash"]) assert.ok(!permitidas.includes(x), `no permitida: ${x}`);
    assert.ok(permitidas.includes("Bash(node herramientas/revisar-pantalla.mjs:*)") && permitidas.includes("Bash(node herramientas/leer-servidor.mjs:*)") && permitidas.includes("Bash(node herramientas/salud-de-aizen1.mjs:*)"));
    for (const x of ["aprobar_tarjeta", "cambiar_estado_tarjeta", "editar_tarjeta", "borrar_tarjeta", "mandar_whatsapp_al_equipo"]) {
      assert.ok(!permitidas.includes(`mcp__aizencrm__${x}`) && prohibidas.includes(`mcp__aizencrm__${x}`), x);
    }
    for (const x of ["git", "gh", "npm"]) assert.ok(prohibidas.includes(`Bash(${x}:*)`), x);
    assert.ok(permitidas.includes("mcp__aizencrm__revision_de_sistemas") && permitidas.includes("mcp__aizencrm__guardar_resumen_del_dia"));
  }
  assert.ok(!argumentosDeClaude(config, "ventas").join(" ").includes("revisar-pantalla"), "ventas no recibe los programas de sistemas");
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
