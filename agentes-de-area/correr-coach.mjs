// EL COACH DE VENTAS con Opus. Lo corre la tarea programada de Windows "Coach de Ventas" en aizen1, de lunes a sábado
// a las 10 p. m. (instalar-tarea-windows.ps1):
//
//   node correr-coach.mjs [--config config.local.json] [--fecha AAAA-MM-DD] [--prueba]
//
//  1. Lee la configuración (bloque "coach" de config.local.json).
//  2. Lee el uso SEMANAL de Claude (`claude -p /usage`, el mismo lector del trabajador del tablero). Si va en
//     coach.umbralSemana (80 %) o más, o no se puede leer, NO abre Claude: llama a
//     coach_avisar_del_dia({ saltado: true, motivo }) (el dueño recibe el aviso de "día saltado") y termina.
//  3. Si el uso está bien, abre Claude Code con el PLAN de Alexander (sin ANTHROPIC_API_KEY) y `--model opus` dentro
//     de coach/ (su CLAUDE.md, su .claude/settings.json y su .mcp.json). Claude lee los chats de cada asesora y guarda
//     una revisión por asesora. Tiene un tope de coach.maxMinutos (60): al vencer se mata el proceso con sus hijos.
//  4. Al final el lanzador (no Claude: Claude no tiene permiso) llama a coach_avisar_del_dia({ fecha }): el CRM arma
//     los textos y le manda a cada asesora su WhatsApp corto. Con --prueba va con prueba:true y no sale ningún WhatsApp.
//  5. Deja logs/coach-AAAA-MM-DD.log con las líneas que fallaron y las últimas 30 líneas de Claude
//     (y logs/coach-AAAA-MM-DD-claude.txt con la salida completa).
//
// El lanzador de Claude y el lector del uso se pueden inyectar (lanzarClaude, leerUso) para probarlo con un Claude falso.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { fechaBogota, llamarMcp } from "./correr-agente.mjs";

const CARPETA = path.dirname(fileURLToPath(import.meta.url));
const BOGOTA_MS = 5 * 3_600_000;
const MINUTO = 60_000;

/** Lo que vale el bloque "coach" si config.local.json no lo trae (o le falta algo). */
export const COACH_POR_DEFECTO = { modelo: "opus", umbralSemana: 80, maxChatsPorAsesora: 25, maxMinutos: 60 };

/** El modelo con que se lee el uso (`claude -p /usage`): Haiku, como el trabajador del tablero. */
const MODELO_PARA_LEER_EL_USO = "haiku";

export function configDelCoach(config) {
  const coach = { ...COACH_POR_DEFECTO, ...(config?.coach ?? {}) };
  for (const clave of ["umbralSemana", "maxChatsPorAsesora", "maxMinutos"]) {
    const valor = Number(coach[clave]);
    coach[clave] = Number.isFinite(valor) && valor > 0 ? valor : COACH_POR_DEFECTO[clave];
  }
  coach.modelo = typeof coach.modelo === "string" && coach.modelo.trim() ? coach.modelo.trim() : COACH_POR_DEFECTO.modelo;
  return coach;
}

/**
 * El día que se revisa (hora de Colombia). A las 10 p. m. es hoy (la revisión mira de 00:00 a 22:00). Si aizen1
 * estaba apagado y la tarea corre al prender, antes del mediodía, se revisa el día anterior.
 */
export function fechaDeLaRevision(ahora) {
  const horaBogota = new Date(ahora.getTime() - BOGOTA_MS).getUTCHours();
  return fechaBogota(horaBogota < 12 ? new Date(ahora.getTime() - 24 * 3_600_000) : ahora);
}

/** Qué hacer con la lectura del uso (pura). `uso` es lo de leerUsoDeClaude (null = no se pudo leer). */
export function decidirPorUso(uso, umbral, motivoDeLectura = null) {
  const semana = uso?.semana?.porcentaje;
  if (!Number.isFinite(semana)) {
    return { lanzar: false, motivo: `no se pudo leer el uso semanal de Claude${motivoDeLectura ? ` (${motivoDeLectura})` : ""}` };
  }
  if (semana >= umbral) return { lanzar: false, motivo: `el uso semanal de Claude va en ${semana} % (el tope es ${umbral} %)`, semana };
  return { lanzar: true, motivo: null, semana };
}

/* ──────────────────────────────────────────────────────────────── los permisos de Claude ── */

/** Los permisos del Coach salen de coach/.claude/settings.json: una sola lista para la carpeta y para los argumentos. */
export function permisosDelCoach(carpetaCoach = path.join(CARPETA, "coach")) {
  const ajustes = JSON.parse(fs.readFileSync(path.join(carpetaCoach, ".claude", "settings.json"), "utf8"));
  return { permitidas: ajustes.permissions?.allow ?? [], prohibidas: ajustes.permissions?.deny ?? [] };
}

export function argumentosDelCoach(coach, { permitidas, prohibidas }) {
  return ["-p", "--model", coach.modelo, "--output-format", "text", "--allowedTools", ...permitidas, "--disallowedTools", ...prohibidas];
}

/** El entorno de Claude: sin clave de API (usa el plan de Alexander) y los subagentes también con Opus. */
export function entornoDelCoach(coach, base = process.env) {
  const env = { ...base, CLAUDE_CODE_SUBAGENT_MODEL: coach.modelo };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  return env;
}

export function armarPromptDelCoach({ fecha, coach, esPrueba }) {
  return [
    "Es la revisión de la noche del Coach de Ventas.",
    `FECHA: ${fecha}`,
    `MAX_CHATS_POR_ASESORA: ${coach.maxChatsPorAsesora}`,
    `ES_PRUEBA: ${esPrueba ? "si" : "no"}`,
    "Sigue tu CLAUDE.md al pie de la letra. Termina cuando hayas guardado la revisión de cada asesora (coach_guardar_revision).",
    "NO llames coach_avisar_del_dia: el aviso lo hace el lanzador al terminar. Nunca le escribes a un cliente.",
  ].join("\n");
}

/* ──────────────────────────────────────────────────────────────── la corrida ── */

export async function correrCoach({
  config,
  ahora = () => new Date(),
  fecha = null,
  esPrueba = false,
  carpetaBase = CARPETA,
  carpetaCoach = path.join(CARPETA, "coach"),
  mcp = (nombre, argumentos) => llamarMcp(config, nombre, argumentos),
  lanzarClaude = null,
  leerUso = null,
  leerUsoDeClaude = null,
}) {
  const coach = configDelCoach(config);
  const dia = fecha ?? fechaDeLaRevision(ahora());
  const carpetaLogs = path.resolve(carpetaBase, config.carpetaLogs ?? "logs");
  fs.mkdirSync(carpetaLogs, { recursive: true });
  const archivoLog = path.join(carpetaLogs, `coach-${dia}.log`);
  const archivoSalida = path.join(carpetaLogs, `coach-${dia}-claude.txt`);
  const fallas = [];
  let cola = "";
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
  // Al final del log: las líneas que fallaron y las últimas 30 líneas de Claude (regla de ejecución del repo).
  const cerrar = (resultado) => {
    const bloque = [
      "── líneas que fallaron ──",
      ...(fallas.length ? fallas : ["(ninguna)"]),
      "── últimas 30 líneas de Claude ──",
      cola || "(Claude no corrió)",
      "",
    ].join("\n");
    try {
      fs.appendFileSync(archivoLog, bloque);
    } catch {
      // Igual que arriba.
    }
    return { ...resultado, fecha: dia, fallas, cola, archivoLog };
  };
  const avisar = async (argumentos) => {
    try {
      const respuesta = await mcp("coach_avisar_del_dia", { fecha: dia, ...argumentos, ...(esPrueba ? { prueba: true } : {}) });
      registro("INFO", `coach_avisar_del_dia: ${respuesta?.estado ?? "sin estado"}${respuesta?.motivo ? ` (${respuesta.motivo})` : ""}`);
      // En prueba no sale nada: los textos que habrían salido quedan en el registro para revisarlos.
      if (esPrueba) registro("INFO", `textos de la prueba: ${JSON.stringify(respuesta).slice(0, 4000)}`);
      return respuesta;
    } catch (error) {
      registro("ERROR", `no pude llamar a coach_avisar_del_dia: ${error.message}`);
      return null;
    }
  };

  registro("INFO", `Coach de Ventas: revisión del ${dia} con ${coach.modelo}${esPrueba ? " — PRUEBA (no sale ningún WhatsApp)" : ""}`);

  // Las piezas del trabajador del tablero (solo se importan, no se cambian): correr con tope y leer el uso.
  const carpetaTrabajador = path.resolve(carpetaBase, config.carpetaTrabajador ?? "../trabajador-tablero");
  const traer = async (archivo) => import(pathToFileURL(path.join(carpetaTrabajador, "lib", archivo)).href);
  const correrComando = lanzarClaude ?? (await traer("procesos.mjs")).correr;
  const entenderUso = leerUsoDeClaude ?? (await traer("motores.mjs")).leerUsoDeClaude;
  const env = entornoDelCoach(coach);

  // 1) El uso semanal de Claude. Ilegible = no se lanza (Opus gasta mucho: mejor saltar el día que agotar la semana).
  let uso = null;
  let motivoDeLectura = null;
  try {
    if (leerUso) {
      uso = await leerUso();
    } else {
      const lectura = await correrComando([...config.comandoClaude, "-p", "--model", MODELO_PARA_LEER_EL_USO, "/usage"], {
        cwd: carpetaBase,
        entrada: "",
        timeoutMs: MINUTO,
        env,
      });
      if (lectura.vencido) motivoDeLectura = "tardó más de 60 s";
      else if (lectura.codigo !== 0) motivoDeLectura = `salió con código ${lectura.codigo}`;
      uso = entenderUso(`${lectura.salida ?? ""}\n${lectura.errores ?? ""}`);
    }
  } catch (error) {
    motivoDeLectura = error.message;
  }
  const decision = decidirPorUso(uso, coach.umbralSemana, motivoDeLectura);
  if (!decision.lanzar) {
    registro("WARN", `día saltado: ${decision.motivo}`);
    const respuesta = await avisar({ saltado: true, motivo: decision.motivo });
    return cerrar({ ok: respuesta !== null, saltado: true, motivo: decision.motivo, lanzado: false });
  }
  registro("INFO", `uso semanal de Claude: ${decision.semana} % (tope ${coach.umbralSemana} %)`);

  // 2) Claude Code con Opus en coach/, con tope de tiempo: al vencer se mata el proceso.
  let permisos;
  try {
    permisos = permisosDelCoach(carpetaCoach);
  } catch (error) {
    registro("ERROR", `no pude leer coach/.claude/settings.json: ${error.message}`);
    return cerrar({ ok: false, motivo: "sin permisos del Coach", lanzado: false });
  }
  const comando = [...config.comandoClaude, ...argumentosDelCoach(coach, permisos)];
  registro("INFO", `abriendo Claude Code (${coach.modelo}, tope ${coach.maxMinutos} min)`);
  let resultado;
  try {
    resultado = await correrComando(comando, {
      cwd: carpetaCoach,
      entrada: armarPromptDelCoach({ fecha: dia, coach, esPrueba }),
      timeoutMs: coach.maxMinutos * MINUTO,
      env,
      archivoSalida,
    });
  } catch (error) {
    resultado = { codigo: null, salida: "", errores: error.message, vencido: false };
  }
  cola = `${resultado.errores ?? ""}\n${resultado.salida ?? ""}`.trim().split(/\r?\n/).slice(-30).join("\n");
  let claudeOk = true;
  if (resultado.vencido) {
    claudeOk = false;
    registro("ERROR", `Claude tardó más de ${coach.maxMinutos} min: se mató el proceso`);
  } else if (resultado.codigo !== 0) {
    claudeOk = false;
    registro("ERROR", `Claude falló (código ${resultado.codigo})`);
  } else {
    registro("INFO", "Claude terminó");
  }

  // 3) El aviso del día lo hace el lanzador (las revisiones que alcanzaron a guardarse se avisan igual).
  const respuesta = await avisar({});
  const ok = claudeOk && respuesta !== null;
  registro(ok ? "INFO" : "ERROR", ok ? "corrida del Coach terminada" : "corrida del Coach terminada con fallas");
  return cerrar({ ok, saltado: false, lanzado: true, vencido: Boolean(resultado.vencido), aviso: respuesta });
}

/* ──────────────────────────────────────────────────────────────── desde la línea de comandos ── */

function leerArgumentos(argv) {
  const salida = { config: path.join(CARPETA, "config.local.json"), fecha: null, esPrueba: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--config") salida.config = path.resolve(argv[++i]);
    else if (a === "--fecha") salida.fecha = argv[++i];
    else if (a === "--prueba") salida.esPrueba = true;
  }
  return salida;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const opciones = leerArgumentos(process.argv.slice(2));
  if (opciones.fecha !== null && !/^\d{4}-\d{2}-\d{2}$/.test(opciones.fecha ?? "")) {
    console.error("--fecha tiene que ir como AAAA-MM-DD.");
    process.exit(2);
  }
  if (!fs.existsSync(opciones.config)) {
    console.error(`Falta ${opciones.config}: copia config.example.json a config.local.json y complétalo.`);
    process.exit(2);
  }
  const config = JSON.parse(fs.readFileSync(opciones.config, "utf8").replace(/^﻿/, ""));
  const resultado = await correrCoach({ config, fecha: opciones.fecha, esPrueba: opciones.esPrueba, carpetaBase: path.dirname(opciones.config) });
  process.exit(resultado.ok ? 0 : 1);
}
