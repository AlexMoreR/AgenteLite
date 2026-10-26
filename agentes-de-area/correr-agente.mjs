// EL LANZADOR del agente de un área (hoy: ventas, marketing y sistemas). Lo corren las tareas programadas de Windows en
// aizen1 de lunes a sábado: sistemas a las 6:30 a. m., marketing a las 6:45 y ventas a las 7:00 (instalar-tarea-windows.ps1):
//
//   node correr-agente.mjs [--area ventas|marketing|sistemas] [--config config.local.json] [--hoy AAAA-MM-DD]
//                          [--forzar-sabado] [--forzar-lunes] [--sin-esperar] [--repetir] [--prueba]
//
//  1. Mira la hora de Colombia: domingo no corre; si prendió después de las 7:00 (más la tolerancia) es una
//     corrida "tarde".
//  2. Abre Claude Code con el PLAN de Claude de Alexander (nunca la API de pago por uso: se quita ANTHROPIC_API_KEY
//     del entorno) dentro de la carpeta del agente. El agente lee su CLAUDE.md, reparte el trabajo a los
//     subagentes (una carpeta por subagente), guarda el resumen en el CRM y deja los mensajes en
//     salida/<fecha>/mensajes.json. El agente NO tiene permiso de mandar WhatsApp.
//  3. Si el plan de Claude llega a su límite (lo comparte con el trabajador del tablero), espera y reintenta.
//  4. A las 7:30 entrega los mensajes por el CRM (mandar_whatsapp_al_equipo): UNO a Alexander y UNO por asesora.
//     Si la corrida terminó después de las 7:30, manda enseguida y avisa "Salió tarde (...)". El servidor decide
//     si sale: solo al equipo, con el interruptor prendido y una vez por persona y por día.
//  5. Deja un registro (log) de cada día en logs/.
//
// MARKETING (--area marketing): mismo molde, sin mensajes. Corre a las 6:45, lee Meta Ads SOLO en lectura (el candado
// está en marketing/.claude/settings.json y en los argumentos de Claude: lib/candado-meta.mjs) y guarda su resumen.
// NUNCA manda WhatsApp: a las 7:30 el lanzador de VENTAS agrega la línea de marketing al MISMO mensaje a Alexander,
// si el interruptor de marketing está prendido; espera hasta 15 min si marketing todavía está corriendo.
//
// SISTEMAS (--area sistemas): mismo molde, sin mensajes, a las 6:30. SOLO LEE (el candado está en sistemas/.claude/settings.json
// y en los argumentos de Claude): revisa en producción lo que quedó HECHO en 24 h, la salud del sistema y, los lunes, el uso.
// Su línea ("Sistemas: todo funciona" o lo roto) se suma al MISMO mensaje de las 7:30 SOLO si su interruptor está prendido.
// Con el interruptor apagado, o con --prueba, Claude NO recibe crear_tarjeta: las tarjetas de arreglo solo "se crearían".
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { CRM_PERMITIDAS_MARKETING, META_ESCRITURA, META_LECTURA, PROHIBIDAS_DE_MARKETING } from "./lib/candado-meta.mjs";

const CARPETA = path.dirname(fileURLToPath(import.meta.url));
const BOGOTA_MS = 5 * 3_600_000;
const MINUTO = 60_000;
/** Cuánto espera Ventas a que Marketing termine, a las 7:30. */
export const ESPERA_MAXIMA_DE_MARKETING_MIN = 15;
/** Las áreas que no mandan WhatsApp: su línea viaja en el mensaje de Ventas. */
const AREAS_SIN_MENSAJES = new Set(["marketing", "sistemas"]);

/* ──────────────────────────────────────────────────────────────── horas de Colombia ── */

/** La fecha "AAAA-MM-DD" de Colombia (sin horario de verano: desfase fijo de 5 h). */
export const fechaBogota = (fecha) => new Date(fecha.getTime() - BOGOTA_MS).toISOString().slice(0, 10);
/** "7:42" en hora de Colombia. */
export const horaBogota = (fecha) => {
  const iso = new Date(fecha.getTime() - BOGOTA_MS).toISOString();
  return `${Number(iso.slice(11, 13))}:${iso.slice(14, 16)}`;
};
/** 0 = domingo … 6 = sábado, en Colombia. */
export const diaDeLaSemana = (fecha) => new Date(fecha.getTime() - BOGOTA_MS).getUTCDay();
/** El instante en que son las HH:MM de Colombia del día `fecha`. */
export const instanteDe = (fecha, hhmm) => new Date(`${fecha}T${hhmm.padStart(5, "0")}:00-05:00`);

/**
 * Qué hacer con esta hora (puro).
 *  corre: false en domingo.
 *  salioTarde: prendió pasada la hora de inicio + la tolerancia.
 *  esSabado: ese día va el analista de perdidos.
 *  esLunes: ese día va el subagente de ideas de anuncio (marketing) o el de uso (sistemas).
 */
export function decidirCorrida({ ahora, config, hoy = null, forzarSabado = false, forzarLunes = false, area = "ventas" }) {
  const fecha = hoy ?? fechaBogota(ahora);
  const dia = diaDeLaSemana(instanteDe(fecha, "12:00"));
  if (dia === 0) return { corre: false, motivo: "domingo: el agente no corre", fecha, salioTarde: false, esSabado: false, esLunes: false, nota: null };
  const horaDeInicio = area === "marketing" ? (config.horaDeInicioMarketing ?? "06:45") : area === "sistemas" ? (config.horaDeInicioSistemas ?? "06:30") : config.horaDeInicio;
  const limite = instanteDe(fecha, horaDeInicio).getTime() + config.toleranciaMinutos * MINUTO;
  const salioTarde = !hoy && ahora.getTime() > limite;
  return {
    corre: true,
    motivo: null,
    fecha,
    salioTarde,
    esSabado: dia === 6 || forzarSabado,
    esLunes: dia === 1 || forzarLunes,
    nota: salioTarde ? `aizen1 prendió a las ${horaBogota(ahora)}` : null,
  };
}

/* ──────────────────────────────────────────────────────────────── los subagentes ── */

/** Cada carpeta de subagentes/ con un PROMPT.md es un subagente. "Frecuencia: diario", "sabado" o "lunes". */
export function listarSubagentes(carpetaAgente, { esSabado, esLunes = false }) {
  const base = path.join(carpetaAgente, "subagentes");
  if (!fs.existsSync(base)) return [];
  const lista = [];
  for (const entrada of fs.readdirSync(base, { withFileTypes: true })) {
    if (!entrada.isDirectory()) continue;
    const archivo = path.join(base, entrada.name, "PROMPT.md");
    if (!fs.existsSync(archivo)) continue;
    const frecuencia = (fs.readFileSync(archivo, "utf8").match(/^Frecuencia:\s*(\S+)/im)?.[1] ?? "diario").toLowerCase();
    if (frecuencia === "sabado" && !esSabado) continue;
    if (frecuencia === "lunes" && !esLunes) continue;
    lista.push({ nombre: entrada.name, frecuencia, prompt: archivo });
  }
  return lista.sort((a, b) => a.nombre.localeCompare(b.nombre));
}

export function armarPrompt({ area, decision, subagentes, carpetaSalida, puedeCrearTarjetas = false }) {
  const esMarketing = area === "marketing";
  if (area === "sistemas") {
    return [
      "Es la corrida de la mañana del Agente de Sistemas.",
      `FECHA: ${decision.fecha}`,
      `SALIDA: ${carpetaSalida}`,
      `SALIO_TARDE: ${decision.salioTarde ? "si" : "no"}${decision.nota ? ` (${decision.nota})` : ""}`,
      `ES_LUNES: ${decision.esLunes ? "si (corre el subagente de uso)" : "no"}`,
      `ES_PRUEBA: ${decision.esPrueba ? "si" : "no"}`,
      `PUEDE_CREAR_TARJETAS: ${puedeCrearTarjetas ? "si (interruptor prendido): crea la tarjeta de arreglo POR_APROBAR en el tablero de Emanuel" : "no (interruptor apagado o prueba): NO crees tarjetas; anota en 'arreglos' las que se crearía con estado se_crearia"}`,
      "SUBAGENTES de hoy (carpeta con su PROMPT.md; lanza cada uno con la herramienta de subagentes y ESPERA su respuesta, nunca en segundo plano):",
      ...subagentes.map((s) => `- ${s.nombre}: ${s.prompt}`),
      "Sigue tu CLAUDE.md al pie de la letra. Eres de SOLO LECTURA. Termina cuando hayas guardado el resumen (guardar_resumen_del_dia con area sistemas). Sistemas no escribe mensajes.json ni manda WhatsApp.",
    ].join("\n");
  }
  return [
    `Es la corrida de la mañana del Agente de ${esMarketing ? "Marketing" : area}.`,
    `FECHA: ${decision.fecha}`,
    `SALIDA: ${carpetaSalida}`,
    `SALIO_TARDE: ${decision.salioTarde ? "si" : "no"}${decision.nota ? ` (${decision.nota})` : ""}`,
    esMarketing ? `ES_LUNES: ${decision.esLunes ? "si (corre ideas-de-anuncio)" : "no"}` : `ES_SABADO: ${decision.esSabado ? "si (corre el analista de perdidos)" : "no"}`,
    `ES_PRUEBA: ${decision.esPrueba ? "si" : "no"}`,
    "SUBAGENTES de hoy (carpeta con su PROMPT.md; lanza cada uno con la herramienta de subagentes y ESPERA su respuesta, nunca en segundo plano):",
    ...subagentes.map((s) => `- ${s.nombre}: ${s.prompt}`),
    esMarketing
      ? "Sigue tu CLAUDE.md al pie de la letra. En Meta Ads SOLO LEES. Termina cuando hayas guardado el resumen (guardar_resumen_del_dia con area marketing). Marketing no escribe mensajes.json ni manda WhatsApp."
      : "Sigue tu CLAUDE.md al pie de la letra. Termina cuando hayas guardado el resumen (guardar_resumen_del_dia) y escrito SALIDA/mensajes.json.",
  ].join("\n");
}

/* ──────────────────────────────────────────────────────────────── el plan de Claude ── */

/** Lo que SOLO puede correr el Agente de Sistemas con Bash: sus tres programas de lectura (nada de git, gh, npm ni consola libre). */
export const BASH_DE_SISTEMAS = [
  "Bash(node herramientas/revisar-pantalla.mjs:*)",
  "Bash(node herramientas/leer-servidor.mjs:*)",
  "Bash(node herramientas/salud-de-aizen1.mjs:*)",
];

/** Lo que el Agente de Sistemas lee del CRM. crear_tarjeta se agrega SOLO con el interruptor prendido y fuera de prueba. */
export const CRM_LECTURA_DE_SISTEMAS = [
  "revision_de_sistemas",
  "guardar_resumen_del_dia",
  "agente_de_sistemas",
  "listar_tableros",
  "ver_tablero",
  "ver_plan_y_resultado",
  "ver_historial_tarjeta",
  "ver_coordinador",
  "resumen_del_negocio",
];

/** Todo lo que escribe en el CRM o cambia una tarjeta: prohibido para Sistemas (crear_tarjeta se quita de aquí solo cuando puede crear). */
export const PROHIBIDAS_DE_SISTEMAS = [
  "Edit",
  "NotebookEdit",
  "WebFetch",
  "WebSearch",
  "Bash(git:*)",
  "Bash(gh:*)",
  "Bash(npm:*)",
  "Bash(npx:*)",
  ...[
    "aprobar_tarjeta",
    "cambiar_estado_tarjeta",
    "editar_tarjeta",
    "borrar_tarjeta",
    "deshacer_cambio_tarjeta",
    "conectar_tarjetas",
    "crear_tablero",
    "renombrar_tablero",
    "crear_tipo",
    "editar_tipo",
    "mandar_whatsapp_al_equipo",
  ].map((n) => `mcp__aizencrm__${n}`),
];

export function argumentosDeClaude(config, area = "ventas", { puedeCrearTarjetas = false } = {}) {
  const base = ["Read", "Write", "Glob", "Grep", "Task", "Agent"];
  let permitidas;
  let prohibidas = ["Bash", "WebFetch", "WebSearch", "Edit"];
  if (area === "sistemas") {
    permitidas = [
      ...base,
      ...BASH_DE_SISTEMAS,
      ...CRM_LECTURA_DE_SISTEMAS.map((n) => `mcp__aizencrm__${n}`),
      ...(puedeCrearTarjetas ? ["mcp__aizencrm__crear_tarjeta"] : []),
      // Gestión: el MCP es de solo lectura. El conector de Google Drive (respaldos) entra por herramientasExtra, solo lectura.
      "mcp__gestion",
      ...(config.herramientasExtra ?? []),
    ];
    prohibidas = [...PROHIBIDAS_DE_SISTEMAS, ...(puedeCrearTarjetas ? [] : ["mcp__aizencrm__crear_tarjeta"])];
  } else if (area === "marketing") {
    // Meta: SOLO las herramientas de lectura (lo que no está en la lista queda bloqueado) y, además, prohibidas todas
    // las que escriben. En el CRM: leer y guardar el resumen; NO mandar_whatsapp_al_equipo.
    permitidas = [...base, ...CRM_PERMITIDAS_MARKETING, "mcp__gestion", ...META_LECTURA, ...(config.herramientasExtra ?? [])];
    prohibidas = [...new Set([...PROHIBIDAS_DE_MARKETING, ...META_ESCRITURA])];
  } else {
    permitidas = [
      ...base,
      // El CRM: solo lo que lee y guarda el resumen. NO mandar_whatsapp_al_equipo: eso lo entrega el lanzador.
      ...["numeros_de_ventas", "guardar_resumen_del_dia", "agente_de_ventas", "agente_de_marketing", "resumen_del_negocio", "listar_conversaciones", "ver_conversacion", "buscar_mensajes", "listar_productos", "ver_supervisor"].map(
        (n) => `mcp__aizencrm__${n}`,
      ),
      // Gestión: el MCP es de solo lectura.
      "mcp__gestion",
      ...(config.herramientasExtra ?? []),
    ];
  }
  const argumentos = ["-p", "--permission-mode", "acceptEdits", "--output-format", "text", "--allowedTools", ...permitidas, "--disallowedTools", ...prohibidas];
  if (config.modelo) argumentos.push("--model", config.modelo);
  return argumentos;
}

/** El entorno de Claude: sin clave de API (usa el plan de Alexander) y con los subagentes en Sonnet. */
export function entornoDeClaude(config, base = process.env) {
  const env = { ...base, CLAUDE_CODE_SUBAGENT_MODEL: config.modeloSubagentes ?? "sonnet" };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  return env;
}

/* ──────────────────────────────────────────────────────────────── el CRM ── */

/** Una llamada a una herramienta del MCP del CRM (JSON-RPC por POST). Devuelve el resultado ya leído. */
export async function llamarMcp(config, nombre, argumentos, { fetchFn = fetch } = {}) {
  const respuesta = await fetchFn(`${config.urlCrm.replace(/\/$/, "")}/api/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.claveMcp}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method: "tools/call", params: { name: nombre, arguments: argumentos } }),
  });
  if (!respuesta.ok) throw new Error(`el CRM contestó ${respuesta.status}`);
  const cuerpo = await respuesta.json();
  if (cuerpo.error) throw new Error(cuerpo.error.message ?? "error del CRM");
  const texto = cuerpo.result?.content?.[0]?.text ?? "";
  if (cuerpo.result?.isError) throw new Error(texto || "la herramienta falló");
  try {
    return JSON.parse(texto);
  } catch {
    return { texto };
  }
}

/** Si la corrida salió tarde, el mensaje a Alexander empieza con el aviso. */
export function conAvisoDeRetraso(texto, nota) {
  if (!nota || /^\s*salió tarde/i.test(texto)) return texto;
  return `Salió tarde (${nota})\n${texto}`;
}

/** Valida mensajes.json: un solo Alexander, un mensaje por número. Devuelve la lista ordenada (Alexander primero). */
export function leerMensajes(texto) {
  const crudo = JSON.parse(texto);
  const lista = Array.isArray(crudo) ? crudo : Array.isArray(crudo?.mensajes) ? crudo.mensajes : null;
  if (!lista) throw new Error("mensajes.json tiene que ser una lista de mensajes");
  const vistos = new Set();
  const limpios = [];
  for (const m of lista) {
    const tipo = String(m?.tipo ?? "").toLowerCase();
    const numero = String(m?.numero ?? "").replace(/\D/g, "");
    const mensaje = String(m?.texto ?? "").trim();
    if (!["alexander", "asesora"].includes(tipo) || numero.length < 10 || !mensaje) continue;
    if (vistos.has(numero)) continue;
    vistos.add(numero);
    limpios.push({ tipo, numero, destinatario: m?.destinatario ? String(m.destinatario) : null, texto: mensaje });
  }
  if (limpios.filter((m) => m.tipo === "alexander").length > 1) throw new Error("mensajes.json trae más de un mensaje para Alexander");
  return limpios.sort((a, b) => (a.tipo === b.tipo ? 0 : a.tipo === "alexander" ? -1 : 1));
}

/* ──────────────────────────────────────────────────────────────── la línea de marketing ── */

/**
 * La línea de marketing para el mensaje de las 7:30 a Alexander (espejo de lineaDeMarketingParaAlexander en el CRM).
 * `datos` es lo que contesta la herramienta agente_de_marketing. Null = no va nada (interruptor apagado o no se pudo leer).
 */
export function lineaDeMarketing(datos) {
  if (!datos || datos.interruptor !== "prendido") return null;
  const resumen = datos.resumen_del_dia;
  const linea = typeof resumen?.linea_para_alexander === "string" ? resumen.linea_para_alexander.trim() : "";
  if (!resumen || !linea) return "Marketing: sin resumen hoy";
  const partes = [/^marketing/i.test(linea) ? linea : `Marketing: ${linea}`];
  const rec = resumen.recomendacion;
  if (rec?.texto) partes.push(`Recomendación: ${rec.texto}${rec.dato ? ` (${rec.dato})` : ""}`);
  if (resumen.salio_tarde) partes.push(`(salió tarde${resumen.nota_de_retraso ? `: ${resumen.nota_de_retraso}` : ""})`);
  return partes.join(" ");
}

/** Agrega la línea de marketing al MISMO mensaje a Alexander (nunca es un mensaje aparte ni se repite). */
export function conLineaDeMarketing(texto, linea) {
  if (!linea || /^\s*marketing\s*:/im.test(texto)) return texto;
  return `${texto.trimEnd()}\n\n${linea}`;
}

/**
 * La línea de sistemas para el mensaje de las 7:30 (espejo de lineaDeSistemasParaAlexander en el CRM).
 * `datos` es lo que contesta la herramienta agente_de_sistemas. Null = no va nada (interruptor apagado o no se pudo leer).
 */
export function lineaDeSistemas(datos) {
  if (!datos || datos.interruptor !== "prendido") return null;
  const resumen = datos.resumen_del_dia;
  const linea = typeof resumen?.linea_para_alexander === "string" ? resumen.linea_para_alexander.trim() : "";
  if (!resumen || !linea) return "Sistemas: sin revisión hoy";
  const partes = [/^sistemas/i.test(linea) ? linea : `Sistemas: ${linea}`];
  if (resumen.salio_tarde) partes.push(`(salió tarde${resumen.nota_de_retraso ? `: ${resumen.nota_de_retraso}` : ""})`);
  return partes.join(" ");
}

/** Agrega la línea de sistemas al MISMO mensaje a Alexander (nunca es un mensaje aparte ni se repite). */
export function conLineaDeSistemas(texto, linea) {
  if (!linea || /^\s*sistemas\s*:/im.test(texto)) return texto;
  return `${texto.trimEnd()}\n\n${linea}`;
}

/** Si un área todavía está corriendo (hay en-curso.json y no terminado.json), espera de a un minuto, hasta 15. */
async function esperarAUnArea({ nombre = "marketing", carpeta, dormir, registro }) {
  const enCurso = path.join(carpeta, "en-curso.json");
  const terminado = path.join(carpeta, "terminado.json");
  let esperados = 0;
  while (fs.existsSync(enCurso) && !fs.existsSync(terminado) && esperados < ESPERA_MAXIMA_DE_MARKETING_MIN) {
    if (esperados === 0) registro("INFO", `${nombre} todavía está corriendo: espero hasta 15 min`);
    await dormir(MINUTO);
    esperados += 1;
  }
  if (esperados >= ESPERA_MAXIMA_DE_MARKETING_MIN && !fs.existsSync(terminado)) registro("WARN", `${nombre} no terminó en 15 min: sigo sin esperarlo`);
  return esperados;
}

/* ──────────────────────────────────────────────────────────────── la corrida ── */

export async function correrAgente({
  config,
  area = "ventas",
  ahora = () => new Date(),
  dormir = (ms) => new Promise((r) => setTimeout(r, ms)),
  hoy = null,
  forzarSabado = false,
  forzarLunes = false,
  sinEsperar = false,
  repetir = false,
  esPrueba = false,
  carpetaAgente = path.join(CARPETA, area),
  carpetaBase = CARPETA,
  mcp = (nombre, argumentos) => llamarMcp(config, nombre, argumentos),
  correr = null,
  esLimiteDeUso = null,
}) {
  const esMarketing = area === "marketing";
  const sinMensajes = AREAS_SIN_MENSAJES.has(area);
  const decision = { ...decidirCorrida({ ahora: ahora(), config, hoy, forzarSabado, forzarLunes, area }), esPrueba };
  const carpetaLogs = path.resolve(carpetaBase, config.carpetaLogs ?? "logs");
  fs.mkdirSync(carpetaLogs, { recursive: true });
  const archivoLog = path.join(carpetaLogs, `${decision.fecha}.log`);
  const fallas = [];
  const registro = (nivel, mensaje) => {
    const linea = `${new Date().toISOString()} [${nivel}] ${mensaje}`;
    if (nivel === "ERROR") fallas.push(linea);
    try {
      fs.appendFileSync(archivoLog, `${linea}\n`);
    } catch {
      // Un disco lleno no tumba la corrida.
    }
    console.log(linea);
  };

  if (!decision.corre) {
    registro("INFO", decision.motivo);
    return { ok: true, saltada: true, motivo: decision.motivo, decision };
  }
  // Ventas deja sus archivos en salida/<fecha>/ y marketing en salida/<fecha>/marketing/ (así no se pisan).
  const carpetaDelDia = path.resolve(carpetaBase, config.carpetaSalida ?? "salida", decision.fecha);
  const carpetaMarketing = path.join(carpetaDelDia, "marketing");
  const carpetaSistemas = path.join(carpetaDelDia, "sistemas");
  const carpetaSalida = esMarketing ? carpetaMarketing : area === "sistemas" ? carpetaSistemas : carpetaDelDia;
  fs.mkdirSync(carpetaSalida, { recursive: true });
  const marca = path.join(carpetaSalida, "terminado.json");
  if (fs.existsSync(marca) && !repetir) {
    registro("INFO", `ya corrió el ${decision.fecha}: no se repite (usar --repetir para forzarlo)`);
    return { ok: true, saltada: true, motivo: "ya corrió hoy", decision };
  }
  registro("INFO", `corrida del ${decision.fecha}${decision.salioTarde ? ` — SALIÓ TARDE (${decision.nota})` : ""}${esMarketing ? (decision.esLunes ? " — con ideas de anuncio" : "") : area === "sistemas" ? (decision.esLunes ? " — con uso" : "") : decision.esSabado ? " — con analista de perdidos" : ""}${esPrueba ? " — PRUEBA" : ""}`);

  // Las piezas del trabajador: correr un comando con tiempo máximo y reconocer el límite del plan.
  const carpetaTrabajador = path.resolve(carpetaBase, config.carpetaTrabajador ?? "../trabajador-tablero");
  const traer = async (archivo) => import(pathToFileURL(path.join(carpetaTrabajador, "lib", archivo)).href);
  const correrComando = correr ?? (await traer("procesos.mjs")).correr;
  const reconocerLimite = esLimiteDeUso ?? (await traer("diagnostico.mjs")).esLimiteDeUso;

  const subagentes = listarSubagentes(carpetaAgente, { esSabado: decision.esSabado, esLunes: decision.esLunes });
  // Sistemas solo recibe crear_tarjeta con su interruptor prendido y fuera de prueba. Si no se puede leer el interruptor, apagado.
  let puedeCrearTarjetas = false;
  if (area === "sistemas" && !esPrueba) {
    try {
      puedeCrearTarjetas = (await mcp("agente_de_sistemas", { fecha: decision.fecha }))?.interruptor === "prendido";
    } catch (error) {
      registro("WARN", `no pude leer el interruptor de sistemas (queda apagado): ${error.message}`);
    }
  }
  const prompt = armarPrompt({ area, decision, subagentes, carpetaSalida, puedeCrearTarjetas });
  const comando = [...config.comandoClaude, ...argumentosDeClaude(config, area, { puedeCrearTarjetas })];
  const archivoSalida = path.join(carpetaLogs, `${decision.fecha}-claude.txt`);

  // Marketing y Sistemas avisan que están corriendo: Ventas los espera (hasta 15 min) antes de armar el mensaje de las 7:30.
  const archivoEnCurso = path.join(carpetaSalida, "en-curso.json");
  if (sinMensajes) fs.writeFileSync(archivoEnCurso, JSON.stringify({ desde: new Date().toISOString() }));
  const quitarEnCurso = () => fs.rmSync(archivoEnCurso, { force: true });

  // 1) Claude Code, con espera y reintento si se agota el límite del plan.
  const inicio = ahora().getTime();
  const tope = inicio + config.maxEsperaLimiteHoras * 3_600_000;
  let intento = 0;
  for (;;) {
    intento += 1;
    registro("INFO", `abriendo Claude Code (intento ${intento}, ${subagentes.length} subagentes: ${subagentes.map((s) => s.nombre).join(", ")})`);
    const resultado = await correrComando(comando, {
      cwd: carpetaAgente,
      entrada: prompt,
      timeoutMs: config.maxMinutosClaude * MINUTO,
      env: entornoDeClaude(config),
      archivoSalida,
    });
    const cola = `${resultado.errores ?? ""}\n${resultado.salida ?? ""}`.trim().split(/\r?\n/).slice(-30).join("\n");
    if (resultado.codigo === 0 && !(String(resultado.salida ?? "").trim().length < 300 && reconocerLimite(resultado.salida))) {
      registro("INFO", "Claude terminó");
      break;
    }
    if (reconocerLimite(cola)) {
      if (ahora().getTime() + config.esperaLimiteMinutos * MINUTO > tope) {
        registro("ERROR", `el límite del plan de Claude no se reinició en ${config.maxEsperaLimiteHoras} h: se rinde por hoy`);
        registro("ERROR", `últimas 30 líneas:\n${cola}`);
        quitarEnCurso();
        return { ok: false, motivo: "límite del plan de Claude", decision, fallas };
      }
      registro("WARN", `se agotó el límite del plan de Claude: espero ${config.esperaLimiteMinutos} min y reintento`);
      await dormir(config.esperaLimiteMinutos * MINUTO);
      continue;
    }
    registro("ERROR", resultado.vencido ? `Claude tardó más de ${config.maxMinutosClaude} min` : `Claude falló (código ${resultado.codigo})`);
    registro("ERROR", `últimas 30 líneas:\n${cola}`);
    quitarEnCurso();
    return { ok: false, motivo: "Claude falló", decision, fallas };
  }

  // Marketing y Sistemas terminan aquí: no hay mensajes. Solo se comprueba que guardaron su resumen.
  if (sinMensajes) {
    quitarEnCurso();
    let guardado = true;
    try {
      const vista = await mcp(`agente_de_${area}`, { fecha: decision.fecha });
      guardado = Boolean(vista?.resumen_del_dia);
    } catch (error) {
      registro("WARN", `no pude comprobar el resumen de ${area}: ${error.message}`);
    }
    if (!guardado) {
      registro("ERROR", `${area} no guardó su resumen en el CRM`);
      return { ok: false, motivo: "sin resumen", decision, fallas };
    }
    const nota = decision.nota;
    fs.writeFileSync(path.join(carpetaSalida, "terminado.json"), JSON.stringify({ terminadoEn: new Date().toISOString(), salioTarde: Boolean(nota), nota }, null, 2));
    registro("INFO", `corrida de ${area} terminada (no manda mensajes: su línea va en el de las 7:30 de Ventas)`);
    return { ok: true, decision, resultados: [], nota, fallas };
  }

  // 2) Los mensajes que dejó el agente.
  const archivoMensajes = path.join(carpetaSalida, "mensajes.json");
  let mensajes;
  try {
    mensajes = leerMensajes(fs.readFileSync(archivoMensajes, "utf8"));
  } catch (error) {
    registro("ERROR", `no hay mensajes válidos en ${archivoMensajes}: ${error.message}`);
    return { ok: false, motivo: "sin mensajes", decision, fallas };
  }
  registro("INFO", `${mensajes.length} mensajes listos (${mensajes.filter((m) => m.tipo === "alexander").length} a Alexander)`);

  // 3) Esperar hasta las 7:30; si ya pasó, mandar enseguida.
  const entrega = instanteDe(decision.fecha, config.horaDeMensajes);
  const retrasoDelDia = ahora().getTime() > entrega.getTime();
  const falta = entrega.getTime() - ahora().getTime();
  if (!sinEsperar && falta > 0) {
    registro("INFO", `espero hasta las ${config.horaDeMensajes} para entregar los mensajes`);
    await dormir(falta);
  }
  const nota = decision.nota ?? (retrasoDelDia && !sinEsperar ? `la corrida terminó a las ${horaBogota(ahora())}` : null);

  // 3b) La línea de marketing va en el MISMO mensaje a Alexander, solo si el interruptor de marketing está prendido.
  let linea = null;
  try {
    await esperarAUnArea({ nombre: "marketing", carpeta: carpetaMarketing, dormir, registro });
    linea = lineaDeMarketing(await mcp("agente_de_marketing", { fecha: decision.fecha }));
    if (linea) registro("INFO", `línea de marketing para Alexander: ${linea}`);
  } catch (error) {
    registro("WARN", `no pude leer el resumen de marketing: ${error.message}`);
  }
  // 3c) La de sistemas, igual: al MISMO mensaje, solo con su interruptor prendido.
  let lineaSistemas = null;
  try {
    await esperarAUnArea({ nombre: "sistemas", carpeta: carpetaSistemas, dormir, registro });
    lineaSistemas = lineaDeSistemas(await mcp("agente_de_sistemas", { fecha: decision.fecha }));
    if (lineaSistemas) registro("INFO", `línea de sistemas para Alexander: ${lineaSistemas}`);
  } catch (error) {
    registro("WARN", `no pude leer el resumen de sistemas: ${error.message}`);
  }

  // 4) Entregar. El servidor decide si sale; aquí solo se reintenta lo que "no salió" (línea caída).
  const resultados = [];
  for (const mensaje of mensajes) {
    const texto = mensaje.tipo === "alexander" ? conAvisoDeRetraso(conLineaDeSistemas(conLineaDeMarketing(mensaje.texto, linea), lineaSistemas), nota) : mensaje.texto;
    let respuesta = null;
    for (let i = 1; i <= config.reintentosEnvio; i += 1) {
      try {
        respuesta = await mcp("mandar_whatsapp_al_equipo", { tipo: mensaje.tipo, numero: mensaje.numero, texto, ...(mensaje.destinatario ? { destinatario: mensaje.destinatario } : {}) });
      } catch (error) {
        respuesta = { se_mando: false, estado: "FALLIDO", motivo: error.message };
      }
      if (respuesta.estado !== "FALLIDO") break;
      registro("WARN", `no salió el mensaje a ${mensaje.destinatario ?? mensaje.numero} (${respuesta.motivo}); intento ${i} de ${config.reintentosEnvio}`);
      if (i < config.reintentosEnvio) await dormir(config.esperaEnvioSegundos * 1000);
    }
    const quien = `${mensaje.tipo === "alexander" ? "Alexander" : mensaje.destinatario ?? "asesora"} (…${mensaje.numero.slice(-4)})`;
    if (respuesta.se_mando) registro("INFO", `salió el mensaje a ${quien}`);
    else if (respuesta.estado === "BLOQUEADO") registro("INFO", `no se mandó a ${quien}: ${respuesta.motivo}`);
    else registro("ERROR", `NO salió el mensaje a ${quien}: ${respuesta.motivo}`);
    resultados.push({ quien, estado: respuesta.estado, motivo: respuesta.motivo ?? null });
  }

  fs.writeFileSync(marca, JSON.stringify({ terminadoEn: new Date().toISOString(), salioTarde: Boolean(nota), nota, resultados }, null, 2));
  const ok = !resultados.some((r) => r.estado === "FALLIDO");
  registro(ok ? "INFO" : "ERROR", ok ? "corrida terminada" : "corrida terminada con mensajes que no salieron");
  return { ok, decision, resultados, nota, fallas };
}

/* ──────────────────────────────────────────────────────────────── desde la línea de comandos ── */

function leerArgumentos(argv) {
  const salida = { area: "ventas", config: path.join(CARPETA, "config.local.json"), hoy: null, forzarSabado: false, forzarLunes: false, sinEsperar: false, repetir: false, esPrueba: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--area") salida.area = argv[++i];
    else if (a === "--config") salida.config = path.resolve(argv[++i]);
    else if (a === "--hoy") salida.hoy = argv[++i];
    else if (a === "--forzar-sabado") salida.forzarSabado = true;
    else if (a === "--forzar-lunes") salida.forzarLunes = true;
    else if (a === "--sin-esperar") salida.sinEsperar = true;
    else if (a === "--repetir") salida.repetir = true;
    else if (a === "--prueba") salida.esPrueba = true;
  }
  return salida;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const opciones = leerArgumentos(process.argv.slice(2));
  if (!fs.existsSync(opciones.config)) {
    console.error(`Falta ${opciones.config}: copia config.example.json a config.local.json y complétalo.`);
    process.exit(2);
  }
  const config = JSON.parse(fs.readFileSync(opciones.config, "utf8").replace(/^﻿/, ""));
  const resultado = await correrAgente({ config, ...opciones, carpetaBase: path.dirname(opciones.config) });
  process.exit(resultado.ok ? 0 : 1);
}
