#!/usr/bin/env node
// EL LANZADOR de un agente de área (hoy, Ventas). Es lo que la tarea de Windows ejecuta a las 7:00 a. m.
//
//   node agentes-de-area/correr-agente.mjs [--area ventas] [--config ruta.json] [--forzar] [--forzar-sabado]
//
// Qué hace, en este orden:
//   1. Lunes a sábado (domingo no corre). Si ya entregó hoy, no repite (--forzar lo salta).
//   2. Abre Claude Code (`claude -p`, con el PLAN de Claude del dueño, no la API de pago) dentro de la carpeta del
//      agente. El CLAUDE.md de esa carpeta es su instrucción permanente; cada subagente tiene su carpeta con su PROMPT.md.
//      El agente reparte el trabajo, junta lo que entregan, guarda el resumen y escribe salida/AAAA-MM-DD.json.
//   3. Si Claude llega al límite de uso del plan (lo comparte con el trabajador del tablero) espera y reintenta,
//      sin romper nada.
//   4. A las 7:30 el lanzador (no Claude: no gasta plan) entrega los mensajes por el MCP del CRM: UNO a Alexander y
//      UNO a cada asesora. Si la corrida termina después de las 7:30 (aizen1 estaba apagado o se agotó el límite),
//      manda enseguida y el mensaje a Alexander empieza con "Salió tarde (aizen1 prendió a las …)".
//   5. El CRM manda solo a la lista del equipo, por la línea Admin, con el interruptor prendido y una vez por persona
//      y por día. NUNCA se le escribe a un cliente. Con el interruptor apagado solo queda el resumen.
//   6. Deja un registro del día en <carpetaTrabajo>/logs/<area>-AAAA-MM-DD.log.
//
// Solo usa node:*. Las partes que tocan el mundo (reloj, Claude, MCP) se inyectan para poder probarlo sin nada real.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const OFFSET_BOGOTA_MS = 5 * 3_600_000;
const MINUTO = 60_000;

/** Lo que dice `claude -p` cuando se acabó el cupo del plan (la misma lista del trabajador del tablero). */
const LIMITE_DE_USO =
  /usage limit|limit reached|hit your (?:\w+ )?limit|session limit|weekly limit|limit · resets|rate[ _-]?limit|overloaded_error|out of (extra )?usage|límite de uso/i;
export const esLimiteDeUso = (texto) => LIMITE_DE_USO.test(String(texto ?? ""));

const NOMBRES_DE_DIA = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];

/* ------------------------------------------------------------------------------------------------
   FECHAS (hora de Colombia, sin horario de verano)
------------------------------------------------------------------------------------------------ */

export function horaBogota(fecha) {
  const local = new Date(fecha.getTime() - OFFSET_BOGOTA_MS);
  const iso = local.toISOString();
  return { fecha: iso.slice(0, 10), hhmm: iso.slice(11, 16), diaSemana: local.getUTCDay() };
}

/** El instante (UTC) en que son las `hhmm` de Colombia del día `fecha`. */
export function instanteDeHora(fecha, hhmm) {
  const [anio, mes, dia] = fecha.split("-").map(Number);
  const [hora, minuto] = hhmm.split(":").map(Number);
  return new Date(Date.UTC(anio, mes - 1, dia, hora, minuto) + OFFSET_BOGOTA_MS);
}

export function diaAnterior(fecha) {
  const [anio, mes, dia] = fecha.split("-").map(Number);
  return new Date(Date.UTC(anio, mes - 1, dia - 1)).toISOString().slice(0, 10);
}

/* ------------------------------------------------------------------------------------------------
   LOS SUBAGENTES: una carpeta por cada uno, con su PROMPT.md. Agregar uno es agregar una carpeta.
------------------------------------------------------------------------------------------------ */

/** Lee el encabezado `--- nombre: … cuando: diario | sabado | lunes,martes … ---` de un PROMPT.md. */
export function leerEncabezado(texto) {
  const bloque = /^﻿?---\r?\n([\s\S]*?)\r?\n---/.exec(texto);
  const campos = {};
  for (const linea of (bloque?.[1] ?? "").split(/\r?\n/)) {
    const partes = /^(\w+)\s*:\s*(.*)$/.exec(linea.trim());
    if (partes) campos[partes[1]] = partes[2].trim();
  }
  return campos;
}

export function subagentesDeHoy(carpetaDelAgente, diaSemana) {
  const carpeta = path.join(carpetaDelAgente, "subagentes");
  if (!fs.existsSync(carpeta)) return [];
  const hoy = NOMBRES_DE_DIA[diaSemana];
  const lista = [];
  for (const entrada of fs.readdirSync(carpeta, { withFileTypes: true })) {
    const prompt = path.join(carpeta, entrada.name, "PROMPT.md");
    if (!entrada.isDirectory() || !fs.existsSync(prompt)) continue;
    const encabezado = leerEncabezado(fs.readFileSync(prompt, "utf8"));
    const cuando = (encabezado.cuando || "diario").toLowerCase().split(",").map((c) => c.trim());
    if (cuando.includes("diario") || cuando.includes(hoy)) {
      lista.push({ clave: entrada.name, nombre: encabezado.nombre || entrada.name, prompt: `subagentes/${entrada.name}/PROMPT.md` });
    }
  }
  return lista.sort((a, b) => a.clave.localeCompare(b.clave));
}

export function armarPrompt({ area, fecha, ayer, subagentes, rutaSalida, forzarSabado }) {
  return [
    `Hoy es ${fecha} (hora de Colombia). Corre el día del Agente de ${area === "ventas" ? "Ventas" : area}.`,
    `Los números que mides son los de AYER (${ayer}).`,
    "",
    "Sigue tu instrucción permanente (CLAUDE.md) paso a paso. Subagentes de HOY (lánzalos en PRIMER PLANO y espera lo que entregan;",
    "cada uno tiene su carpeta con un PROMPT.md que debes leer y pasarle completo):",
    ...(subagentes.length ? subagentes.map((s) => `- ${s.nombre}: ${s.prompt}`) : ["- (ninguno hoy)"]),
    forzarSabado ? "\nEs una corrida de PRUEBA del sábado: incluye también al Analista de perdidos." : "",
    "",
    "Al terminar guarda el resumen con guardar_resumen_del_dia y escribe el archivo de salida con este formato exacto:",
    `SALIDA: ${rutaSalida}`,
    "NO mandes ningún WhatsApp tú: el lanzador entrega los mensajes a las 7:30. NUNCA le escribas a un cliente.",
  ]
    .filter((linea) => linea !== null)
    .join("\n");
}

/* ------------------------------------------------------------------------------------------------
   LA SALIDA DEL AGENTE
------------------------------------------------------------------------------------------------ */

export function leerSalida(ruta) {
  if (!fs.existsSync(ruta)) throw new Error(`El agente no dejó el archivo de salida (${ruta}).`);
  let salida;
  try {
    salida = JSON.parse(fs.readFileSync(ruta, "utf8").replace(/^﻿/, ""));
  } catch (error) {
    throw new Error(`El archivo de salida no es JSON válido: ${error.message}`);
  }
  if (!salida || typeof salida !== "object" || Array.isArray(salida)) throw new Error("El archivo de salida tiene que ser un objeto.");
  if (typeof salida.textoAlexander !== "string" || !salida.textoAlexander.trim()) throw new Error("A la salida le falta textoAlexander.");
  if (!Array.isArray(salida.mensajesAsesoras)) throw new Error("A la salida le falta mensajesAsesoras (una lista, aunque vaya vacía).");
  return salida;
}

/** Un solo mensaje por asesora: si el agente repite un número, queda el primero (el CRM igual lo frenaría). */
export function mensajesUnicos(mensajes) {
  const vistos = new Set();
  const salida = [];
  const repetidos = [];
  for (const m of mensajes) {
    const numero = String(m?.numero ?? "").replace(/\D/g, "");
    if (!numero || typeof m?.texto !== "string" || !m.texto.trim()) continue;
    if (vistos.has(numero)) {
      repetidos.push(numero);
      continue;
    }
    vistos.add(numero);
    salida.push({ nombre: String(m.nombre ?? ""), numero, texto: m.texto });
  }
  return { mensajes: salida, repetidos };
}

export function textoParaAlexander(texto, tarde, nota) {
  return tarde ? `Salió tarde (${nota}).\n\n${texto.trim()}` : texto.trim();
}

/* ------------------------------------------------------------------------------------------------
   LAS PIEZAS REALES (en las pruebas se cambian por falsas)
------------------------------------------------------------------------------------------------ */

function matarArbol(hijo) {
  try {
    if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(hijo.pid), "/t", "/f"], { windowsHide: true });
    else hijo.kill("SIGKILL");
  } catch {
    // ya no estaba
  }
}

/** Corre `claude -p` con el prompt por stdin, dentro de la carpeta del agente. Nunca lanza. */
export function ejecutarClaudeReal({ config, prompt, cwd }) {
  const permitidas = config.herramientasPermitidas ?? ["Read", "Write", "Edit", "Glob", "Grep", "Task", "Agent", "mcp__aizencrm", "mcp__gestion"];
  const prohibidas = config.herramientasProhibidas ?? ["Bash", "WebFetch", "WebSearch"];
  const argumentos = [
    "-p",
    "--model",
    config.modelo || "sonnet",
    "--permission-mode",
    "acceptEdits",
    "--output-format",
    "text",
    "--allowedTools",
    ...permitidas,
    "--disallowedTools",
    ...prohibidas,
  ];
  const [programa, ...previos] = config.comandoClaude ?? ["claude"];
  return new Promise((resolver) => {
    let salida = "";
    let vencido = false;
    let hijo;
    try {
      // En Windows `claude` es un .cmd: hace falta pasar por el intérprete de comandos.
      hijo = spawn(programa, [...previos, ...argumentos], { cwd, env: process.env, shell: process.platform === "win32", windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    } catch (error) {
      resolver({ codigo: -1, salida: String(error?.message ?? error) });
      return;
    }
    const reloj = setTimeout(() => {
      vencido = true;
      matarArbol(hijo);
    }, (config.tiempoMaximoMinutos ?? 40) * MINUTO);
    const juntar = (dato) => {
      salida = (salida + dato.toString("utf8")).slice(-60_000);
    };
    hijo.stdout.on("data", juntar);
    hijo.stderr.on("data", juntar);
    hijo.on("error", (error) => {
      clearTimeout(reloj);
      resolver({ codigo: -1, salida: `${salida}\n${error.message}` });
    });
    hijo.on("close", (codigo) => {
      clearTimeout(reloj);
      resolver({ codigo: vencido ? -2 : (codigo ?? -1), salida: vencido ? `${salida}\nSe pasó del tiempo máximo.` : salida });
    });
    hijo.stdin.on("error", () => {});
    hijo.stdin.end(prompt);
  });
}

/** Llama una herramienta del MCP del CRM (JSON-RPC por HTTP). Devuelve lo que contestó la herramienta. */
export async function llamarMcpReal(config, nombre, argumentos) {
  const url = `${String(config.urlCrm ?? "").replace(/\/+$/, "")}/api/mcp`;
  const respuesta = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.claveMcp}`, "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: nombre, arguments: argumentos } }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!respuesta.ok) throw new Error(`el CRM contestó ${respuesta.status}`);
  const cuerpo = await respuesta.json();
  if (cuerpo.error) throw new Error(cuerpo.error.message ?? "error del MCP");
  const texto = cuerpo.result?.content?.[0]?.text ?? "";
  if (cuerpo.result?.isError) throw new Error(texto || "la herramienta falló");
  try {
    return JSON.parse(texto);
  } catch {
    return texto;
  }
}

/* ------------------------------------------------------------------------------------------------
   LA CORRIDA
------------------------------------------------------------------------------------------------ */

/**
 * @param opciones.config      el config.local.json ya leído
 * @param opciones.ahora       () => Date
 * @param opciones.dormir      (ms) => Promise
 * @param opciones.ejecutar    ({prompt, cwd}) => Promise<{codigo, salida}>
 * @param opciones.llamarMcp   (nombre, argumentos) => Promise<objeto>
 * @param opciones.imprimir    (linea) => void   (por defecto, consola)
 */
export async function correr({ config, area = "ventas", forzar = false, forzarSabado = false, ahora, dormir, ejecutar, llamarMcp, imprimir = console.log }) {
  const inicio = ahora();
  const hoy = horaBogota(inicio);
  const carpetaTrabajo = path.resolve(config.carpetaTrabajo);
  const carpetaDelAgente = path.resolve(config.carpetaAgentes ?? path.join(AQUI), area);
  fs.mkdirSync(path.join(carpetaTrabajo, "logs"), { recursive: true });
  fs.mkdirSync(path.join(carpetaTrabajo, "estado"), { recursive: true });
  const rutaLog = path.join(carpetaTrabajo, "logs", `${area}-${hoy.fecha}.log`);
  const anotar = (mensaje) => {
    const linea = `${ahora().toISOString()} [${area}] ${mensaje}`;
    imprimir(linea);
    try {
      fs.appendFileSync(rutaLog, `${linea}\n`);
    } catch {
      // un disco lleno no tumba la corrida
    }
  };

  const diasDeTrabajo = config.diasDeTrabajo ?? [1, 2, 3, 4, 5, 6];
  if (!forzar && !diasDeTrabajo.includes(hoy.diaSemana)) {
    anotar(`hoy es ${NOMBRES_DE_DIA[hoy.diaSemana]}: el agente no corre`);
    return { estado: "no_corre_hoy" };
  }
  const rutaMarca = path.join(carpetaTrabajo, "estado", `${area}-${hoy.fecha}.json`);
  if (!forzar && fs.existsSync(rutaMarca)) {
    anotar("ya entregó hoy: no se repite (con --forzar se corre de nuevo)");
    return { estado: "ya_entrego" };
  }

  const horaEntrega = config.horaEntrega ?? "07:30";
  const horaProgramada = config.horaProgramada ?? "07:00";
  const momentoDeEntrega = instanteDeHora(hoy.fecha, horaEntrega);
  const rutaSalida = path.join(carpetaDelAgente, "salida", `${hoy.fecha}.json`);
  fs.mkdirSync(path.dirname(rutaSalida), { recursive: true });
  fs.rmSync(rutaSalida, { force: true });

  const diaParaSubagentes = forzarSabado ? 6 : hoy.diaSemana;
  const subagentes = subagentesDeHoy(carpetaDelAgente, diaParaSubagentes);
  const prompt = armarPrompt({ area, fecha: hoy.fecha, ayer: diaAnterior(hoy.fecha), subagentes, rutaSalida, forzarSabado });
  anotar(`empieza (aizen1 prendió a las ${hoy.hhmm}); subagentes de hoy: ${subagentes.map((s) => s.clave).join(", ") || "ninguno"}`);

  // 1. Claude hace el trabajo. Si se agota el cupo del plan, espera y reintenta.
  const esperaMin = config.esperaLimiteMinutos ?? 30;
  const maxReintentos = config.maxReintentosLimite ?? 10;
  let resultado = null;
  for (let intento = 1; intento <= maxReintentos + 1; intento += 1) {
    resultado = await ejecutar({ prompt, cwd: carpetaDelAgente });
    if (resultado.codigo === 0 && !esLimiteDeUso(resultado.salida.slice(-400)) && fs.existsSync(rutaSalida)) break;
    if (esLimiteDeUso(resultado.salida)) {
      anotar(`Claude llegó al límite de uso del plan (intento ${intento}); espero ${esperaMin} min y reintento`);
      if (intento > maxReintentos) break;
      await dormir(esperaMin * MINUTO);
      continue;
    }
    break;
  }
  const ultimas = resultado.salida.split(/\r?\n/).slice(-30).join("\n");
  if (resultado.codigo !== 0 || !fs.existsSync(rutaSalida)) {
    anotar(`FALLO: Claude terminó con código ${resultado.codigo}${fs.existsSync(rutaSalida) ? "" : " y sin archivo de salida"}. Últimas líneas:\n${ultimas}`);
    return { estado: "fallo", motivo: esLimiteDeUso(resultado.salida) ? "limite_de_uso" : "claude", ultimas };
  }
  anotar(`Claude terminó. Últimas líneas:\n${ultimas}`);

  let salida;
  try {
    salida = leerSalida(rutaSalida);
  } catch (error) {
    anotar(`FALLO: ${error.message}`);
    return { estado: "fallo", motivo: "salida", ultimas: error.message };
  }

  // 2. ¿Salió tarde? Si ya pasaron las 7:30 se entrega enseguida y se avisa a Alexander.
  const tolerancia = (config.toleranciaMinutos ?? 2) * MINUTO;
  const tarde = ahora().getTime() > momentoDeEntrega.getTime() + tolerancia;
  const horaDeLlegada = hoy.hhmm;
  const llegoTarde = instanteDeHora(hoy.fecha, horaProgramada).getTime() + 5 * MINUTO < inicio.getTime();
  const nota = llegoTarde ? `aizen1 prendió a las ${horaDeLlegada}` : `la corrida terminó a las ${horaBogota(ahora()).hhmm}`;
  const textoAlexander = textoParaAlexander(salida.textoAlexander, tarde, nota);

  // 3. El resumen se guarda ya (se ve en la pantalla aunque falten minutos para las 7:30).
  const guardar = async (nombre, argumentos) => {
    for (let intento = 1; intento <= 3; intento += 1) {
      try {
        return await llamarMcp(nombre, argumentos);
      } catch (error) {
        anotar(`${nombre} no salió (intento ${intento}): ${error.message}`);
        if (intento < 3) await dormir(30_000);
      }
    }
    return null;
  };
  const guardado = await guardar("guardar_resumen_del_dia", {
    fecha: hoy.fecha,
    numeros: salida.numeros,
    meta: salida.meta,
    subagentes: salida.subagentes ?? {},
    sugeridos: salida.sugeridos ?? [],
    texto_alexander: textoAlexander,
    salio_tarde: tarde,
    ...(tarde ? { nota_tarde: nota } : {}),
  });
  anotar(guardado ? `resumen guardado${guardado.esPrueba ? " (corrida de PRUEBA: el interruptor está apagado)" : ""}` : "FALLO: no se pudo guardar el resumen");

  // 4. Esperar las 7:30 y entregar.
  if (!tarde && ahora().getTime() < momentoDeEntrega.getTime()) {
    anotar(`espero hasta las ${horaEntrega} para entregar`);
    await dormir(momentoDeEntrega.getTime() - ahora().getTime());
  }
  const { mensajes, repetidos } = mensajesUnicos(salida.mensajesAsesoras);
  if (repetidos.length) anotar(`el agente repitió ${repetidos.length} número(s) de asesoras: solo va el primer mensaje de cada una`);
  const envios = [];
  const enviar = async (nombre, numero, texto) => {
    const respuesta = await guardar("mandar_whatsapp_al_equipo", { numero, texto, nombre });
    const resumen = respuesta
      ? `${respuesta.estado}${respuesta.motivo ? ` — ${respuesta.motivo}` : ""}`
      : "no se pudo pedir (error de red o del CRM)";
    anotar(`mensaje para ${nombre || `…${numero.slice(-4)}`}: ${resumen}`);
    envios.push({ nombre, estado: respuesta?.estado ?? "ERROR", enviado: respuesta?.enviado === true });
  };
  if (config.numeroAlexander) await enviar("Alexander", String(config.numeroAlexander).replace(/\D/g, ""), textoAlexander);
  else anotar("FALLO: falta numeroAlexander en el config; el mensaje de las 7:30 no se pidió");
  for (const m of mensajes) await enviar(m.nombre, m.numero, m.texto);

  const entregado = { fecha: hoy.fecha, tarde, nota: tarde ? nota : null, envios, cuando: ahora().toISOString() };
  fs.writeFileSync(rutaMarca, `${JSON.stringify(entregado, null, 2)}\n`);
  anotar(`listo: ${envios.filter((e) => e.enviado).length} salieron, ${envios.filter((e) => !e.enviado).length} no salieron${tarde ? " (salió tarde)" : ""}`);
  return { estado: "entregado", tarde, envios, textoAlexander };
}

/* ------------------------------------------------------------------------------------------------
   ARRANQUE
------------------------------------------------------------------------------------------------ */

function leerConfig(ruta) {
  try {
    return JSON.parse(fs.readFileSync(ruta, "utf8").replace(/^﻿/, ""));
  } catch (error) {
    console.error(`no pude leer ${ruta}: ${error.message}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const argumentos = process.argv.slice(2);
  const valorDe = (bandera) => {
    const i = argumentos.indexOf(bandera);
    return i >= 0 ? argumentos[i + 1] : undefined;
  };
  const config = leerConfig(path.resolve(valorDe("--config") ?? path.join(AQUI, "config.local.json")));
  const resultado = await correr({
    config,
    area: valorDe("--area") ?? "ventas",
    forzar: argumentos.includes("--forzar"),
    forzarSabado: argumentos.includes("--forzar-sabado"),
    ahora: () => new Date(),
    dormir: (ms) => new Promise((resolver) => setTimeout(resolver, ms)),
    ejecutar: ({ prompt, cwd }) => ejecutarClaudeReal({ config, prompt, cwd }),
    llamarMcp: (nombre, args) => llamarMcpReal(config, nombre, args),
  });
  process.exit(resultado.estado === "fallo" ? 1 : 0);
}
