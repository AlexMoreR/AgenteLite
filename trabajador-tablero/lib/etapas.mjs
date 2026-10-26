// Las tres etapas del trabajador: PLANEAR, CONSTRUIR y SUBIR. Cada una trabaja en un worktree
// temporal (carpetaTrabajo/wt/...), nunca en la copia del repo, y lo borra al terminar.
//
// - planear:   worktree desde origin/main; `claude -p --permission-mode plan` escribe el plan. -> /plan
// - construir: worktree en la rama tablero/<id>-<slug> desde origin/main; Claude edita (acceptEdits y
//              herramientas acotadas, sin push); el Coordinador (no Claude) hace commit, marca las zonas
//              protegidas que toca (chats, agentes, libro V3, Meta Ads), corre la verificación y las
//              pruebas él mismo, compara el lint con el de main, ensaya la migración (PGlite + producción
//              en BEGIN…ROLLBACK) y empuja SOLO la rama. -> /resultado, que dice si sube sola (subirSolo
//              del repo y sin zonas: el CRM la pasa a SUBIENDO) o espera el sí del dueño (POR_REVISAR).
//              En la nube (25-oct-2026, nube.mjs): las tareas GRANDES y las de desborde las escribe una sesión de
//              `claude --cloud` en la rama tablero/<id> (sin --force); al volver, el Coordinador hace aquí lo mismo.
// - subir:     rebase de la rama sobre origin/main; si main no cambió desde que se construyó no vuelve
//              a compilar, si cambió verifica y ensaya de nuevo; push a main, espera el CI y comprueba
//              la versión. Si el despliegue falla, revert del commit en main (sin --force). -> /subida
// Si algo falla se lanza ErrorDeEtapa con el motivo en palabras sencillas y el detalle técnico debajo
// (y la reversión, si la hubo): el bucle llama /error.
//
// Motores (23-oct-2026): planear y construir los hace Claude Code o Codex CLI (correrMotor), según
// config.motores y lo que decida el planificador (contexto.motorDe: uso de Claude, pausas por límite).
// Lo que construye Codex lo revisa después otro paso (Claude por defecto). El motor solo escribe
// archivos: commit, zonas, verificación, lint, ensayo y subida siguen siendo del Coordinador.
import fs from "node:fs";
import path from "node:path";

import crypto from "node:crypto";

import { MAXIMO_DE_PARTES, MINIMO_DE_PARTES, enUnaLinea, esLimiteDeUso, recortar, sinRuido } from "./diagnostico.mjs";
import { ensayarMigraciones, migracionesNuevas } from "./ensayo.mjs";
import {
  archivosCambiados,
  crearWorktree,
  esRamaDelTrabajador,
  git,
  idCorto,
  nombreDeRama,
  pushARamaBase,
  pushDeRama,
  quitarWorktree,
  ramaExisteEnElRemoto,
  rebaseSobre,
  revertirEnRamaBase,
  urlDelRemoto,
  webDeGithub,
} from "./git.mjs";
import { dificultadDeLaTarea, modeloDelPaso, nombreDelModelo } from "./modelos.mjs";
import { esLimiteDeCodex, nombreDelMotor } from "./motores.mjs";
import { esperarResultado, lanzarEnNube } from "./nube.mjs";
import { vigilarSesion } from "./atasco.mjs";
import { cerrarProcesosEn, comoTexto, correr, detalleDeFalla, ultimasLineas } from "./procesos.mjs";
import { esperarRecursos, faltanRecursos, medirUnaVez } from "./recursos.mjs";
import { PRIORIDAD } from "./cola.mjs";
import { carpetaDeIntentos } from "./registro.mjs";
import { migracionDestructiva } from "./riesgo.mjs";
import { zonasTocadas } from "./zonas.mjs";

export class ErrorDeEtapa extends Error {
  constructor(message, { zonas = [], reversion = null, limiteDeUso = false, motor = null, categoria = null, archivosCambiados = null } = {}) {
    super(message);
    this.zonas = zonas;
    this.reversion = reversion;
    // La causa cuando la etapa ya la sabe (una de CATEGORIAS de diagnostico.mjs): así diagnosticar no adivina.
    this.categoria = categoria;
    // Cuántos archivos llevaba cambiados el trabajo que falló (lo llena construir): decide si se parte la tarea.
    this.archivosCambiados = archivosCambiados;
    // Claude o Codex llegó al límite de uso del plan: no es ERROR de la tarjeta, se suelta y se reintenta
    // después. `motor` dice cuál ("claude" | "codex"; null = ningún motor disponible ahora).
    this.limiteDeUso = limiteDeUso;
    this.motor = motor;
  }
}

// El reconocimiento del límite de uso de Claude vive ahora en diagnostico.mjs (puro); se sigue exportando de acá.
export { esLimiteDeUso };

const MINUTO = 60_000;

/** El entorno de los comandos: sin acceso a ninguna base real (DATABASE_URL apunta a nada). */
export function entornoSeguro() {
  return {
    ...process.env,
    DATABASE_URL: "postgresql://trabajador:no-usar@127.0.0.1:1/no_usar",
    DIRECT_URL: "postgresql://trabajador:no-usar@127.0.0.1:1/no_usar",
  };
}

/**
 * Los topes del CRM por etapa (minutos, reglas-trabajador.ts: MINUTOS_POR_ETAPA). Pasado el tope el CRM pasa la
 * tarjeta a ERROR por su cuenta (y cuenta), así que el reloj de la etapa nunca se estira más allá (1 min antes).
 */
export const TOPE_DEL_CRM = { planear: 20, construir: 90, subir: 45 };

/**
 * Un reloj de la etapa: cuánto le queda y un error claro si ya no queda. `extender` suma el tiempo que se esperó al PC
 * o a la cola de pasos pesados, pero sin pasar de `topeMinutos` (el del CRM menos 1; sin tope = como antes).
 * Si se acaba el tiempo y buena parte se fue esperando turno (cola.mjs), no es culpa de la tarea: la categoría es
 * pc_sobrecargado (se suelta y se reintenta sin contar), no tiempo_agotado.
 */
function relojDeEtapa(minutos, nombre, { topeMinutos = null } = {}) {
  const inicio = Date.now();
  let limite = inicio + minutos * MINUTO;
  const techo = topeMinutos ? inicio + (topeMinutos - 1) * MINUTO : Infinity;
  let esperadoMs = 0;
  return {
    resta() {
      const queda = limite - Date.now();
      if (queda <= 0) {
        if (esperadoMs >= 2 * MINUTO) {
          throw new ErrorDeEtapa(`Se acabó el tiempo de ${nombre} esperando turno para compilar (${Math.round(esperadoMs / MINUTO)} min en la cola de aizen1). Se reintenta sin contar.`, {
            categoria: "pc_sobrecargado",
          });
        }
        throw new ErrorDeEtapa(`Se pasó del tiempo de ${nombre} (${minutos} min).`, { categoria: "tiempo_agotado" });
      }
      return queda;
    },
    extender(ms) {
      esperadoMs += Math.max(0, ms);
      limite = Math.min(techo, limite + Math.max(0, ms));
    },
    esperado: () => esperadoMs,
  };
}

/**
 * Corre `fn` con un turno de la cola de pasos pesados de aizen1 (cola.mjs). El tiempo de espera se le devuelve al reloj
 * de la etapa (hasta el tope del CRM). Sin cola en el contexto (--una-vez), corre enseguida.
 */
async function conTurno(contexto, reloj, prioridad, que, fn) {
  const cola = contexto.colaPesada;
  if (!cola) return fn();
  const inicio = Date.now();
  const antes = cola.estado();
  if (antes.ocupados >= antes.maximo) {
    contexto.registro?.info?.(`espero turno para ${que} (cola de pasos pesados: corre ${antes.corriendo.join(", ") || "otro"}; ${antes.esperando} en fila)`);
  }
  let liberar;
  try {
    liberar = await cola.tomar({ prioridad, senal: contexto.senal, que: `${contexto.etiqueta ?? ""} ${que}`.trim() });
  } catch (error) {
    if (error?.cancelado) throw new ErrorDeEtapa(`Se canceló la espera para ${que}: la tarjeta venció en el CRM.`, { categoria: "coordinador_cortado" });
    throw error;
  }
  const esperado = Date.now() - inicio;
  if (esperado > 5000) {
    reloj.extender(esperado);
    contexto.registro?.info?.(`turno para ${que} después de ${Math.round(esperado / 1000)} s en la cola`);
  }
  try {
    return await fn();
  } finally {
    liberar();
  }
}

/**
 * Antes de un comando pesado (verificación, build): si OTRAS sesiones están corriendo y el PC pasó de los límites,
 * espera (hasta config.limites.esperaMaximaMinutos) a que baje, y ese tiempo NO se descuenta del reloj de la etapa.
 * Sin otras sesiones la carga es de esta misma, así que no espera.
 */
async function esperarAlPc(contexto, reloj, que) {
  const { medidor, config, registro, senal, otrasSesiones } = contexto;
  const maximoMs = (config.limites?.esperaMaximaMinutos ?? 0) * MINUTO;
  // Con la cola de pasos pesados, los comandos pesados ya van de a uno: la CPU alta es de ese mismo paso, no se espera.
  if (contexto.colaPesada) return;
  if (!medidor || !maximoMs || !(otrasSesiones?.() > 0)) return;
  const falta = faltanRecursos(medidor.medir(), config.limites);
  if (!falta) return;
  registro?.info?.(`espero al PC antes de ${que} (${falta}); como mucho ${config.limites.esperaMaximaMinutos} min y no se descuenta del reloj de la etapa`);
  const { esperadoMs, liberado } = await esperarRecursos({ medir: () => medidor.medir(), limites: config.limites, maximoMs, senal });
  reloj.extender(esperadoMs);
  registro?.info?.(`esperé ${Math.round(esperadoMs / 1000)} s al PC${liberado ? "" : " (sigue lleno: sigo igual)"}`);
}

/** Cierra lo que la sesión dejó corriendo dentro de su carpeta y borra el candado de Next (.next/lock). */
async function cerrarRestos(contexto, carpeta) {
  try {
    const cerrados = await cerrarProcesosEn(carpeta);
    fs.rmSync(path.join(carpeta, ".next", "lock"), { force: true });
    if (cerrados) contexto.registro?.aviso?.(`cerré ${cerrados} proceso(s) que la sesión dejó corriendo en ${carpeta}`);
  } catch {
    // Limpiar no puede tumbar la tarjeta.
  }
}

/**
 * Para carpeta_trabada: cierra procesos, borra .next/lock y saca las carpetas de trabajo (worktrees) de esta
 * tarjeta, para que el próximo intento arranque en una carpeta sana. Nunca lanza.
 */
export async function limpiarCarpetasDeTrabajo(contexto, tarjeta) {
  const repo = contexto.config.repos[tarjeta.repo];
  for (const etapa of ["plan", "construir", "subir", "partir", "nube"]) {
    const carpeta = carpetaDe(contexto, tarjeta, etapa);
    if (!fs.existsSync(carpeta)) continue;
    await cerrarRestos(contexto, carpeta);
    if (repo) await quitarWorktree(repo, carpeta, etapa === "subir" ? `subida/${idCorto(tarjeta.id)}` : etapa === "construir" ? nombreDeRama(tarjeta) : undefined);
    else fs.rmSync(carpeta, { recursive: true, force: true, maxRetries: 3 });
  }
}

function configDelRepo(contexto, tarjeta) {
  const repo = contexto.config.repos[tarjeta.repo];
  if (!repo) throw new ErrorDeEtapa(`El repo "${tarjeta.repo}" no está configurado en este PC (config.local.json -> repos).`);
  if (!fs.existsSync(repo.ruta)) throw new ErrorDeEtapa(`No existe la carpeta del repo ${tarjeta.repo}: ${repo.ruta}.`);
  return repo;
}

const carpetaDe = (contexto, tarjeta, etapa) => path.join(contexto.config.carpetaTrabajo, "wt", `${idCorto(tarjeta.id)}-${etapa}`);

/**
 * Corre un comando de la etapa; si falla, ErrorDeEtapa con `motivo` (en palabras sencillas, para el
 * dueño) y debajo el detalle técnico (el comando y lo último que dijo).
 */
async function paso(contexto, comando, { cwd, reloj, que, motivo, entrada, prioridad = PRIORIDAD.verificar }) {
  return conTurno(contexto, reloj, prioridad, comoTexto(comando), () => pasoSinTurno(contexto, comando, { cwd, reloj, que, motivo, entrada }));
}

async function pasoSinTurno(contexto, comando, { cwd, reloj, que, motivo, entrada }) {
  const { config, senal } = contexto;
  const timeoutMs = Math.min(reloj.resta(), config.tiempos.comandoMinutos * MINUTO);
  // La salida completa queda en un archivo (intentos/<tarjeta>/salida-...): si el comando falla, el diagnóstico
  // lee las líneas que fallaron y el final, no solo el principio.
  const tarjetaCorta = path.basename(cwd).replace(/-(?:plan|construir|subir|partir)$/, "");
  const archivoSalida = path.join(config.carpetaTrabajo, "intentos", tarjetaCorta, `salida-${new Date().toISOString().replace(/[:.]/g, "-")}-${path.basename(String(comando[comando.length - 1]))}.log`);
  const resultado = await correr(comando, { cwd, env: entornoSeguro(), senal, timeoutMs, entrada, archivoSalida });
  if (resultado.cancelado) throw new ErrorDeEtapa(`Se canceló ${que}: la tarjeta venció en el CRM.`, { categoria: "coordinador_cortado" });
  if (resultado.vencido) {
    // ¿Se pasó de tiempo porque el PC estaba saturado? (22-23-oct-2026: las pruebas tardaban el triple con 3 sesiones a la vez).
    const { cpu, memoria } = contexto.medidor ? contexto.medidor.medir() : await medirUnaVez(300);
    const saturado = faltanRecursos({ cpu, memoria }, config.limites);
    throw new ErrorDeEtapa(
      `${motivo ?? `Falló ${que}`}: se pasó del tiempo (${comoTexto(comando)})${saturado ? ` con el PC saturado (CPU ${cpu} %, memoria ${memoria} %)` : ""}.`,
      { categoria: saturado ? "pc_sobrecargado" : "tiempo_agotado" },
    );
  }
  if (resultado.codigo !== 0) {
    throw new ErrorDeEtapa(
      `${motivo ?? `Falló ${que}`}. No se subió nada.\nDetalle técnico (${comoTexto(comando)}):\n${detalleDeFalla(resultado)}`,
    );
  }
  // Salió bien: la salida completa ya no hace falta.
  if (resultado.archivoSalida) fs.rmSync(resultado.archivoSalida, { force: true });
  return resultado;
}

/** Por qué falló un comando de verificación, en palabras sencillas. */
function motivoDeVerificacion(comando, esPrueba) {
  if (esPrueba) return "Fallaron las pruebas que ya existen";
  const texto = comoTexto(comando);
  if (/\btsc\b/.test(texto)) return "No compiló: el código tiene errores de tipos (TypeScript)";
  if (/\bbuild\b/.test(texto)) return "No compiló: falló el build";
  if (/prisma\s+generate/.test(texto)) return "No compiló: el esquema de la base (Prisma) tiene un error";
  return "No pasó la verificación";
}

/** Correr Claude con el prompt por stdin. Devuelve lo que contestó. */
async function claude(contexto, argumentos, prompt, { cwd, timeoutMs, que }) {
  const { config, senal } = contexto;
  const comando = [...config.comandoClaude, ...argumentos];
  // Los subagentes que lance esta sesión usan el modelo de config.modelos.subagentes (Sonnet), no Opus.
  const env = { ...entornoSeguro(), CLAUDE_CODE_SUBAGENT_MODEL: config.modelos?.subagentes ?? "sonnet" };
  const vigia = vigilarSesion(config, cwd, contexto.vigilanteDeAtasco);
  const resultado = await correr(comando, { cwd, entrada: prompt, timeoutMs, senal, env, vigilar: vigia ?? undefined });
  if (resultado.cancelado) throw new ErrorDeEtapa(`Se canceló Claude (${que}): la tarjeta venció en el CRM.`, { categoria: "coordinador_cortado" });
  if (resultado.atascado) {
    throw new ErrorDeEtapa(
      `La sesión de Claude se quedó quieta ${Math.round((vigia?.quietoMs?.() ?? config.atasco.minutos * MINUTO) / MINUTO)} min al ${que} (no tocó archivos ni usó el procesador): se cortó como sesión atascada.`,
      { categoria: "sesion_atascada" },
    );
  }
  if (resultado.vencido) throw new ErrorDeEtapa(`Claude tardó más de ${Math.round(timeoutMs / MINUTO)} min en ${que}: se cortó.`, { categoria: "tiempo_agotado" });
  // Sin el aviso "Ignoring N permissions.allow entries… this workspace has not been trusted" (23-24-oct-2026: salía en
  // cada sesión, encabezaba el error y escondía la causa real: el límite de uso o las tareas en segundo plano). No hace
  // daño: las herramientas van por --allowedTools en la línea de comando, no por .claude/settings.json.
  const cola = ultimasLineas(sinRuido(`${resultado.errores}\n${resultado.salida}`), 20);
  if (resultado.codigo !== 0) {
    throw new ErrorDeEtapa(`Claude falló al ${que} (código ${resultado.codigo}):\n${cola}`, { limiteDeUso: esLimiteDeUso(cola), motor: "claude" });
  }
  const texto = resultado.salida.trim();
  if (!texto) throw new ErrorDeEtapa(`Claude no contestó nada al ${que}.`);
  // A veces sale con código 0 y solo el aviso del límite (un texto corto, no un plan ni un resumen).
  if (texto.length < 300 && esLimiteDeUso(texto)) {
    throw new ErrorDeEtapa(`Claude llegó a su límite de uso al ${que}: ${texto}`, { limiteDeUso: true, motor: "claude" });
  }
  return texto;
}

/**
 * Correr Codex CLI (23-oct-2026) sin interacción:
 *   codex exec --cd <worktree> --sandbox <read-only|workspace-write> --skip-git-repo-check --color never
 *              --output-last-message <archivo> -
 * El prompt va por stdin ("-"); la respuesta final la deja Codex en el archivo (fuera del worktree, para
 * que no entre en el commit). Nunca --dangerously-bypass-approvals-and-sandbox: Codex solo escribe
 * archivos dentro del worktree; el commit, las verificaciones y la subida los hace el Coordinador.
 */
async function codex(contexto, prompt, { cwd, timeoutMs, que, sandbox }) {
  const { config, senal } = contexto;
  const respuesta = path.join(config.carpetaTrabajo, "codex", `${path.basename(cwd)}-${Date.now()}.txt`);
  fs.mkdirSync(path.dirname(respuesta), { recursive: true });
  const comando = [
    ...config.comandoCodex,
    "exec",
    "--cd",
    cwd,
    "--sandbox",
    sandbox,
    "--skip-git-repo-check",
    "--color",
    "never",
    "--output-last-message",
    respuesta,
    "-",
  ];
  try {
    const resultado = await correr(comando, { cwd, entrada: prompt, timeoutMs, senal, env: entornoSeguro() });
    if (resultado.cancelado) throw new ErrorDeEtapa(`Se canceló Codex (${que}): la tarjeta venció en el CRM.`, { categoria: "coordinador_cortado" });
    if (resultado.vencido) throw new ErrorDeEtapa(`Codex tardó más de ${Math.round(timeoutMs / MINUTO)} min en ${que}: se cortó.`, { categoria: "tiempo_agotado" });
    const cola = ultimasLineas(`${resultado.errores}\n${resultado.salida}`, 20);
    if (resultado.codigo !== 0) {
      throw new ErrorDeEtapa(`Codex falló al ${que} (código ${resultado.codigo}):\n${cola}`, { limiteDeUso: esLimiteDeCodex(cola), motor: "codex" });
    }
    const texto = (fs.existsSync(respuesta) ? fs.readFileSync(respuesta, "utf8") : resultado.salida).trim();
    if (!texto) throw new ErrorDeEtapa(`Codex no contestó nada al ${que}.`);
    if (texto.length < 300 && esLimiteDeCodex(texto)) {
      throw new ErrorDeEtapa(`Codex llegó a su límite de uso al ${que}: ${texto}`, { limiteDeUso: true, motor: "codex" });
    }
    return texto;
  } finally {
    fs.rmSync(respuesta, { force: true });
  }
}

/** Los argumentos de Claude para cada paso: planear en modo plan; construir y revisar con acceptEdits acotado. */
function argumentosDeClaude(config, paso, tarjeta, modeloElegido) {
  const modelo = ["--model", modeloElegido ?? modeloDelPaso(config, paso, tarjeta)];
  if (paso === "planear") return ["-p", ...modelo, "--permission-mode", "plan", "--output-format", "text"];
  // Construir y revisar NO lanzan subagentes (24-oct-2026: una sesión lanzó 2 en segundo plano y se quedó
  // esperándolos horas): hacen todo ellas, en primer plano. Planear sí puede, porque ahí no se queda esperando.
  const sinSubagentes = (herramientas) => herramientas.filter((herramienta) => !HERRAMIENTAS_DE_SUBAGENTES.includes(herramienta));
  return [
    "-p",
    ...modelo,
    "--permission-mode",
    "acceptEdits",
    "--output-format",
    "text",
    "--allowedTools",
    ...sinSubagentes(config.herramientasPermitidas),
    "--disallowedTools",
    ...new Set([...config.herramientasProhibidas, ...HERRAMIENTAS_DE_SUBAGENTES]),
  ];
}

/** Las herramientas con las que una sesión lanza subagentes o tareas en segundo plano. */
export const HERRAMIENTAS_DE_SUBAGENTES = ["Agent", "Task"];

/**
 * Correr un MOTOR ("claude" | "codex") para un paso ("planear" | "construir" | "revisar") en `cwd`.
 * Planear solo lee (Claude en modo plan, Codex con --sandbox read-only); construir y revisar editan el
 * worktree (Claude acceptEdits con herramientas acotadas, Codex --sandbox workspace-write).
 */
export async function correrMotor(contexto, motor, paso, prompt, { cwd, timeoutMs, que, tarjeta, modelo }) {
  contexto.registro?.info?.(`${que}: motor: ${motor}${motor === "claude" ? `, modelo: ${nombreDelModelo(modelo ?? modeloDelPaso(contexto.config, paso, tarjeta))}` : ""}`);
  if (motor === "codex") return codex(contexto, prompt, { cwd, timeoutMs, que, sandbox: paso === "planear" ? "read-only" : "workspace-write" });
  return claude(contexto, argumentosDeClaude(contexto.config, paso, tarjeta, modelo), prompt, { cwd, timeoutMs, que });
}

/** Qué motor hace `paso` ahora (lo decide el planificador con el uso de Claude y las pausas). */
function motorDelPaso(contexto, paso) {
  const motor = contexto.motorDe ? contexto.motorDe(paso) : paso === "revisar" ? contexto.config.motores.revisar : contexto.config.motores[paso];
  if (!motor && paso !== "revisar") {
    throw new ErrorDeEtapa(`Ningún motor disponible para ${paso} (Codex en pausa por su límite y sin respaldo de Claude): se reintenta después.`, {
      limiteDeUso: true,
      motor: null,
    });
  }
  return motor ?? null;
}

/** La última línea del plan dice quién lo escribió: así el resultado sabe el motor del plan. */
// Con modelo: "Plan escrito con: Claude Code (Opus)". Sin modelo (planes viejos o Codex): como antes.
const MARCA_DEL_PLAN = /^Plan escrito con: (Claude Code|Codex)(?: \(([^)\n]+)\))?\s*$/im;
const firmaDelPlan = (motor, modelo) => `Plan escrito con: ${motor === "codex" ? "Codex" : `Claude Code${modelo ? ` (${nombreDelModelo(modelo)})` : ""}`}`;
/** El modelo con que se escribió el plan ("Opus", "Sonnet"...), o null. */
export function modeloDelPlan(plan) {
  return String(plan ?? "").match(MARCA_DEL_PLAN)?.[2]?.trim() || null;
}
export function motorDelPlan(plan) {
  const marca = String(plan ?? "").match(MARCA_DEL_PLAN);
  return marca ? (marca[1] === "Codex" ? "codex" : "claude") : null;
}

/** La revisión no se come el tiempo de construir: como mucho esto. */
const REVISAR_MAXIMO_MINUTOS = 20;

const MOTIVO_ENSAYO ="El ensayo de la migración falló: la migración no corre bien en la base. No se subió nada.";

const REGLAS_DE_ZONAS =
  "No toques Meta Ads (anuncios, campañas, píxel), el bot de ventas (el agente que atiende WhatsApp) ni el libro del agente V3.";

/** Subagentes (22-oct-2026): más rápido y mejor revisado. Los subagentes siguen las mismas reglas. */
const SUBAGENTES_AL_PLANEAR =
  "Usa subagentes (herramienta Agent) para investigar el código en paralelo: por ejemplo uno que encuentre dónde vive lo que hay que cambiar y otro que busque las pruebas y los usos que se pueden romper. Ellos tampoco cambian archivos.";
// Construir NO usa subagentes (24-oct-2026): el intento de las 2:23 p. m. lanzó 2 en segundo plano, dijo
// "Revisaré de nuevo en unos 30 minutos" y se quedó esperando desde las 3:11 p. m.
const SUBAGENTES_AL_CONSTRUIR = [
  "- Haz TODO tú, en esta misma sesión, en orden y en PRIMER PLANO. PROHIBIDO lanzar subagentes (herramienta Agent o Task) o cualquier cosa en segundo plano, y PROHIBIDO quedarte esperando algo (nada de \"reviso de nuevo en unos minutos\"): si un comando tarda, córrelo en primer plano y espera su resultado aquí mismo.",
  "- Trabaja en este orden: primero investiga el código que toca el plan; después edita; escribe o completa las pruebas del cambio;",
  "  al terminar, REVISA tu cambio completo (git diff y git status) buscando errores, casos que faltan y reglas rotas, y arréglalo antes de entregar.",
].join("\n");
/** Codex no tiene subagentes: lo mismo, hecho por él en orden. */
const SIN_SUBAGENTES_AL_PLANEAR = "Antes de planear, investiga el código: dónde vive lo que hay que cambiar, las pruebas y los usos que se pueden romper.";
const SIN_SUBAGENTES_AL_CONSTRUIR = [
  "- Haz todo tú, en orden y en primer plano; nunca dejes nada corriendo en segundo plano ni te quedes esperando algo para después.",
  "- Trabaja en este orden: primero investiga el código que toca el plan; después edita; escribe o completa las pruebas del cambio;",
  "  al terminar, REVISA tu cambio completo (git diff y git status) buscando errores, casos que faltan y reglas rotas, y arréglalo antes de entregar.",
  "- Si un comando necesita internet o la base y no puede correr acá, sigue: el Coordinador corre tsc, build, lint y las pruebas después.",
].join("\n");

const REGLA_DEL_MANUAL = (tarjeta) =>
  `No edites docs/que-es-esta-aplicacion.md, aunque el plan lo diga: el Coordinador junta los cambios en el manual una vez cada noche. Si tu cambio agrega un modelo, una pantalla, una automatización, una limitación o una advertencia de operación, escríbelo en docs/cambios-pendientes/${idCorto(tarjeta.id)}.md (el formato está en docs/cambios-pendientes/README.md: la sección del manual con su mismo título "## ..." y líneas "- <clave>: descripción"). Cada tarea escribe solo su propio archivo.`;

function contextoDeLaTarjeta(tarjeta) {
  const error = tarjeta.resultado?.error?.motivo;
  return [
    `Tarea: ${tarjeta.titulo}`,
    `Tablero: ${tarjeta.tablero}`,
    `Detalle:\n${tarjeta.detalle || "(sin detalle)"}`,
    tarjeta.intentos > 1 ? `Es el intento ${tarjeta.intentos}.${error ? ` El anterior falló así:\n${error}` : ""}` : "",
    tarjeta.riesgo
      ? `Riesgo que ya tiene la tarjeta en el CRM: ${tarjeta.riesgo}${tarjeta.riesgoMotivo ? ` (${tarjeta.riesgoMotivo})` : ""}. Es solo un punto de partida: tú revisas el plan y pones tu propia línea RIESGO.`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Reparación (24-oct-2026): lo que el Coordinador ya sabe del intento anterior que falló. `tarjeta.reparacion` =
 * { numero, de, causa, categoria, error, estrategia } (lo arma el bucle con lo que trae /tomar). `patchAplicado`:
 * el trabajo del intento anterior ya está puesto en los archivos del worktree.
 */
export function bloqueDeReparacion(tarjeta, { patchAplicado = false } = {}) {
  const r = tarjeta.reparacion;
  if (!r) return "";
  return [
    `REPARACIÓN ${r.numero} de ${r.de ?? 3}: el intento anterior falló y SOLO eso hay que corregir.`,
    `La causa fue: ${r.causa || "(no se sabe)"}${r.categoria ? ` (categoría: ${r.categoria})` : ""}.`,
    r.error ? `El error exacto es:\n${recortar(r.error, 3500)}` : "",
    "Corrige solo eso y no rehagas lo demás.",
    r.categoria === "sesion_atascada"
      ? "El intento anterior se atascó esperando tareas en segundo plano. En ESTE intento no lances subagentes ni dejes nada en segundo plano, y no esperes nada: haz todo tú, en primer plano, y termina."
      : "",
    patchAplicado
      ? "El trabajo del intento anterior YA está aplicado en los archivos de este worktree (míralo con git status y git diff): parte de ahí, no lo escribas otra vez."
      : "El trabajo del intento anterior no se pudo conservar: empieza desde la base, pero con la causa de arriba presente para no repetir el error.",
    patchAplicado?.conflictos?.length
      ? `OJO: main cambió desde el intento anterior y estos archivos quedaron con MARCAS DE CONFLICTO (<<<<<<< / ======= / >>>>>>>): ${patchAplicado.conflictos.join(", ")}. Resuélvelas PRIMERO: deja lo nuevo de main y suma lo de esta tarea, y borra todas las marcas. El Coordinador no sube nada que tenga marcas.`
      : "",
    r.estrategia === "opus" ? "Ya falló dos veces por lo mismo: antes de editar, piensa con calma por qué y busca otra forma de resolverlo." : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function promptDelPlan(tarjeta, repo, motor = "claude") {
  return [
    `Eres el Coordinador del Tablero IA de Magilus. Tienes que escribir un PLAN para esta tarea del repositorio "${repo.clave}". ${
      motor === "codex" ? "Estás en modo de solo lectura" : "Estás en modo plan"
    }: NO cambies ningún archivo, solo lee el código y planea.`,
    contextoDeLaTarjeta(tarjeta),
    bloqueDeReparacion(tarjeta),
    [
      "Escribe el plan en español sencillo, para el dueño del negocio (no es programador), con estas partes:",
      "1. Qué se cambia.",
      "2. Qué efecto tiene (para el negocio, las asesoras o los clientes).",
      "3. Riesgos.",
      "4. Migración de base de datos: sí o no. Si sí, cuál (solo aditiva y escrita a mano). El CRM revisa esta parte buscando SQL destructivo: NO escribas las palabras DROP, DELETE, UPDATE, RENAME ni TRUNCATE (ni siquiera para decir que no se usan) salvo que de verdad se vayan a usar.",
      "5. Archivos que se tocan.",
      "6. Cómo se va a probar.",
    ].join("\n"),
    `Reglas: ${REGLAS_DE_ZONAS} Si la tarea lo requiere, dilo claro al principio del plan: "TOCA ZONA PROTEGIDA: <cuál y por qué>".`,
    motor === "codex" ? SIN_SUBAGENTES_AL_PLANEAR : SUBAGENTES_AL_PLANEAR,
    "En la parte 5 escribe cada archivo con su ruta completa desde la raíz del repo (por ejemplo src/features/coach/servicio.ts): el Coordinador la usa para no construir a la vez dos tareas que tocan lo mismo.",
    fraseAlTerminar(repo),
    INSTRUCCION_DE_RIESGO,
    "Contesta SOLO con el plan.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * El riesgo del plan (24-oct-2026): el CRM lee esta línea para aprobar solo las tareas sencillas. Los
 * criterios espejan src/features/tableros-inteligentes/services/reglas-riesgo.ts; el CRM además lo
 * revisa por su cuenta (la parte 4 y las rutas de la parte 5), así que marcar BAJO no basta.
 */
export const INSTRUCCION_DE_RIESGO = [
  'En las PRIMERAS líneas del plan (junto a la frase "Al terminar: ...") escribe una línea exacta con este formato:',
  "RIESGO: BAJO — <motivo en una frase>",
  "o bien",
  "RIESGO: ALTO — <motivo en una frase>",
  "Es BAJO solo si cumple TODO esto:",
  "- no toca ninguna zona protegida (CHATS, BOT_VENTAS, LIBRO_V3, META_ADS);",
  "- no hay migración, o es solo aditiva (nada de DROP, ALTER destructivo, RENAME, DELETE, UPDATE ni TRUNCATE);",
  "- no toca dinero (abonos, saldos, nómina, comisiones, facturación, pagos), ni permisos, usuarios, contraseñas o credenciales, ni envía mensajes a clientes;",
  "- no toca el propio trabajador (trabajador-tablero/) ni las reglas de aprobación del tablero.",
  "Si algo de eso no se cumple, o tienes duda, es ALTO. Es mejor pedirle permiso al dueño de más que de menos.",
  "",
  "Además, en otra línea exacta, di si el plan puede pasar solo a construir sin esperar el sí del dueño (regla del dueño del 24-oct):",
  "APROBAR PLAN: SOLO",
  "o bien",
  "APROBAR PLAN: ESPERA TU SÍ — <motivo en una línea>",
  "Escribe ESPERA TU SÍ solo si el plan toca dinero en Gestión (abonos, saldos, nómina, comisiones, facturación, pagos) o puede subir presupuesto, activar campañas o crear gasto en Meta Ads. En cualquier otro caso (aunque el RIESGO sea ALTO) escribe SOLO.",
].join("\n");

/** Lo que el plan tiene que decir al principio: si al terminar sube solo o espera el sí del dueño. */
function fraseAlTerminar(repo) {
  if (!repo.subirSolo) {
    return 'Al principio del plan escribe esta frase: "Al terminar: espera tu sí" (en este repositorio el Coordinador todavía no sube solo a producción).';
  }
  const rutas = Object.entries(repo.zonasProtegidas ?? {})
    .map(([zona, globs]) => `${zona}: ${(globs ?? []).join(", ")}`)
    .join("\n");
  return [
    "Al principio del plan escribe UNA de estas dos frases:",
    '- "Al terminar: sube solo a producción" si el cambio NO toca ninguna de las rutas de abajo.',
    '- "Al terminar: espera tu sí (toca chats / agentes / Meta Ads)" si toca alguna (di cuál). Esos cambios se construyen y prueban igual, pero no suben sin el sí del dueño.',
    `Las rutas de chats, agentes, libro V3 y Meta Ads:\n${rutas || "(ninguna configurada)"}`,
  ].join("\n");
}

export function promptDeConstruir(tarjeta, repo, rama, motor = "claude", { patchAplicado = false } = {}) {
  const aprobadas = tarjeta.zonasAprobadas?.length ? tarjeta.zonasAprobadas.join(", ") : "ninguna";
  return [
    `Eres el Coordinador del Tablero IA de Magilus. Implementa EXACTAMENTE el plan que aprobó el dueño, en este repositorio ("${repo.clave}"). Estás en un worktree aparte, en la rama ${rama}.`,
    contextoDeLaTarjeta(tarjeta),
    `PLAN APROBADO:\n${tarjeta.plan}`,
    bloqueDeReparacion(tarjeta, { patchAplicado }),
    [
      "Reglas:",
      "- No hagas git push ni commit, no cambies de rama ni toques el remoto: el Coordinador hace el commit y sube la rama él mismo.",
      "- Migraciones: solo aditivas, escritas a mano (una carpeta nueva en prisma/migrations con su migration.sql, con BEGIN/COMMIT y guardas IF NOT EXISTS). NUNCA prisma migrate dev, migrate deploy, db push ni nada contra una base de datos.",
      `- ${REGLAS_DE_ZONAS} Zonas protegidas aprobadas por el dueño para esta tarea: ${aprobadas}.`,
      "- Respeta el estilo del repo y escribe los comentarios en español.",
      `- ${REGLA_DEL_MANUAL(tarjeta)}`,
      motor === "codex" ? SIN_SUBAGENTES_AL_CONSTRUIR : SUBAGENTES_AL_CONSTRUIR,
      "- NO corras `npm run build` ni `next build` (ni `next dev`, ni nada que quede corriendo): el Coordinador compila él mismo al terminar, y dos builds en la misma carpeta se traban en `.next/lock`.",
      // 25-oct-2026: `eslint .` y toda la batería dentro de la sesión corrían FUERA de la cola de pasos pesados (cola.mjs)
      // y, con 3 sesiones, saturaban el i3. Claude prueba lo suyo; lo completo lo corre el Coordinador, de a uno.
      "- Al final corre `npx tsc --noEmit`, el lint SOLO de los archivos que cambiaste (`npx eslint <esos archivos>`, sin errores nuevos) y las pruebas del módulo que tocaste, y arregla lo que falle. NO corras `eslint .` del repo entero ni toda la batería de pruebas: el Coordinador corre todo eso al terminar, de a uno en aizen1.",
      "- Si terminas SIN haber cambiado ningún archivo (porque ya estaba hecho, o no se puede hacer), escribe como última línea: NO_CAMBIE: <el motivo en una frase>. Es la única forma de decir que no hacía falta cambiar nada.",
      "- Termina con un RESUMEN corto en español sencillo: qué cambiaste, qué archivos y cómo lo probaste.",
    ].join("\n"),
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * La instrucción para la sesión de la NUBE (25-oct-2026, `claude --cloud`): el plan aprobado completo, la orden de
 * leer CLAUDE.md, las 4 lecciones, las prohibiciones y la orden de dejar todo en la rama tablero/<id>. Nunca lleva
 * claves, .env ni tokens: `entorno` solo trae variables NO secretas (la dirección de base falsa de siempre).
 */
export function promptDeNube(tarjeta, repo, rama, { entorno = {}, modelo = null } = {}) {
  const aprobadas = tarjeta.zonasAprobadas?.length ? tarjeta.zonasAprobadas.join(", ") : "ninguna";
  const pasos = [repo.instalar, ...(repo.verificar ?? []), ...(repo.pruebas ?? [])].filter(Boolean).map((comando) => `\`${comoTexto(comando)}\``);
  const variables = Object.entries(entorno).map(([nombre, valor]) => `export ${nombre}="${valor}"`);
  return [
    `Eres el Coordinador del Tablero IA de Magilus. Implementa EXACTAMENTE el plan que aprobó el dueño, en este repositorio ("${repo.clave}"). Estás en una sesión de Claude en la nube, sobre la rama ${rama} (ya existe en GitHub: es la tuya).`,
    contextoDeLaTarjeta(tarjeta),
    `PLAN APROBADO:\n${tarjeta.plan}`,
    bloqueDeReparacion(tarjeta),
    modelo ? `MODELO PEDIDO: ${nombreDelModelo(modelo)} (construir se hace con ese modelo; no cambies a otro).` : "",
    "LO PRIMERO: lee el archivo CLAUDE.md de la raíz del repositorio y cumple sus REGLAS DE EJECUCIÓN (son obligatorias).",
    [
      "LECCIONES OBLIGATORIAS:",
      `1. PREPARACIÓN, en este orden: ${pasos.join(" → ")}. Sin \`npx prisma generate\` el build falla con errores de tipos falsos.`,
      variables.length
        ? `   Antes de compilar o probar, exporta estas variables (NO son secretas, son direcciones falsas a propósito):\n${variables.map((linea) => `   ${linea}`).join("\n")}`
        : "",
      "2. TODO EN PRIMER PLANO: nada en segundo plano ni subagentes esperando. No digas \"reviso más tarde\": la sesión no termina hasta tener el resultado (OK o error).",
      `3. DEJA TODO EN LA RAMA ${rama}: haz commit y \`git push origin ${rama}\` (sin --force). No uses otra rama ni abras pull requests. Como ÚLTIMO paso deja un commit VACÍO y súbelo:`,
      '   git commit --allow-empty -m "resultado: build=OK tests=OK segundos=<N>"',
      "   (build=FALLO o tests=FALLO si algo falló; <N> = los segundos que tardó todo).",
      '4. SI FALLA: no preguntes ni te quedes dando vueltas. Si no lo puedes arreglar, deja el commit vacío con FALLO y pon en su CUERPO las últimas 30 líneas del error: git commit --allow-empty -m "resultado: build=FALLO tests=FALLO segundos=<N>" -m "<últimas 30 líneas>", y súbelo.',
    ]
      .filter(Boolean)
      .join("\n"),
    [
      "PROHIBIDO:",
      "- Tocar bases de datos (nada de prisma migrate, db push, psql ni conexiones reales), claves, tokens, archivos .env ni nada secreto. No hay claves de producción acá y no se piden.",
      "- git push --force (ni --force-with-lease) a ninguna rama.",
      `- ${REGLAS_DE_ZONAS} Zonas protegidas aprobadas por el dueño para esta tarea: ${aprobadas}.`,
      "- Migraciones: solo aditivas, escritas a mano (una carpeta nueva en prisma/migrations con su migration.sql, con BEGIN/COMMIT y guardas IF NOT EXISTS). El Coordinador las ensaya después contra producción, no tú.",
    ].join("\n"),
    `MANUAL: ${REGLA_DEL_MANUAL(tarjeta)}`,
    "Respeta el estilo del repo y escribe los comentarios en español. Si terminas SIN haber cambiado ningún archivo, escribe como última línea de tu resumen: NO_CAMBIE: <el motivo en una frase>. Termina con un RESUMEN corto en español sencillo: qué cambiaste, qué archivos y cómo lo probaste.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Una rama que no exista todavía en GitHub: tablero/<id>-<nombre>, o con -nube2, -nube3… si un intento anterior ya la
 * dejó (la de la nube no se rehace con --force: cada intento usa la suya).
 */
async function ramaParaLaNube(repo, tarjeta) {
  const principal = nombreDeRama(tarjeta);
  for (let n = 1; n <= 20; n += 1) {
    const rama = n === 1 ? principal : `${principal}-nube${n}`;
    if (!(await ramaExisteEnElRemoto(repo.ruta, repo.remoto, rama))) return rama;
  }
  throw new ErrorDeEtapa(`Ya hay 20 ramas de la nube para esta tarjeta en GitHub (${principal}-nube…): hay que borrarlas a mano.`);
}

/**
 * La parte de CONSTRUIR que pasa en la nube: crea la rama desde main y la sube (sin --force), lanza `claude --cloud`,
 * guarda el link de la sesión (contexto.fase -> el latido se lo cuenta al CRM) y vigila la rama hasta el commit
 * "resultado:". Si dejó FALLO lanza el error con las últimas 30 líneas. Devuelve lo que necesita el resto de construir.
 */
async function construirLaParteDeLaNube(contexto, tarjeta, { repo, rama, base, reloj }) {
  const { config, registro } = contexto;
  const carpeta = carpetaDe(contexto, tarjeta, "nube");
  try {
    await crearWorktree(repo, carpeta, base, rama);
    await pushDeRama(carpeta, repo.remoto, rama, { forzar: false });
    const vistos = new Set((await git(carpeta, ["rev-list", "-n", "100", "HEAD"])).salida.split(/\r?\n/).filter(Boolean));
    const entorno = { ...Object.fromEntries(["DATABASE_URL", "DIRECT_URL"].map((nombre) => [nombre, entornoSeguro()[nombre]])), ...config.nube.entorno };
    contexto.fase?.("construyendo", { lugar: "nube", linkSesion: null });
    // El modelo sale de la misma regla fija que en aizen1 (modelos.mjs): construir -> Sonnet, nunca Opus.
    const modelo = modeloDelPaso(config, "construir", tarjeta);
    registro.info(`construir en la nube: modelo ${nombreDelModelo(modelo)}`);
    const lanzado = await lanzarEnNube(contexto, { cwd: carpeta, prompt: promptDeNube(tarjeta, repo, rama, { entorno, modelo }), modelo });
    contexto.fase?.("construyendo", { lugar: "nube", linkSesion: lanzado.link });
    registro.info(`construyo en la nube: sesión ${lanzado.link}, rama ${rama} (${lanzado.via})`);
    let resultado;
    try {
      resultado = await esperarResultado(contexto, { repo, rama, vistos, reloj, link: lanzado.link });
    } catch (error) {
      if (error instanceof ErrorDeEtapa && !error.message.includes(lanzado.link)) error.message += `\nSesión de la nube: ${lanzado.link}`;
      throw error;
    }
    registro.info(`la nube terminó: build=${resultado.build} tests=${resultado.tests} segundos=${resultado.segundos ?? "?"}`);
    if (!resultado.paso) {
      if (esLimiteDeUso(resultado.detalle)) {
        throw new ErrorDeEtapa(`Claude llegó a su límite de uso en la nube: ${ultimasLineas(resultado.detalle, 5)}`, { limiteDeUso: true, motor: "claude" });
      }
      throw new ErrorDeEtapa(
        `La sesión de la nube dejó el resultado FALLO (build=${resultado.build} tests=${resultado.tests}). No se subió nada.\nÚltimas líneas del error que dejó en la rama ${rama}:\n${ultimasLineas(resultado.detalle, 30) || "(no dejó líneas)"}\nSesión de la nube: ${lanzado.link}`,
      );
    }
    // La rama vuelve a aizen1: se verifica sobre el commit de main del que salió (así lo que se prueba es lo de la nube).
    await git(repo.ruta, ["fetch", repo.remoto]);
    const baseComun = (await git(repo.ruta, ["merge-base", base, `${repo.remoto}/${rama}`])).salida.trim();
    return {
      link: lanzado.link,
      segundos: resultado.segundos,
      baseComun,
      // Solo se anota el modelo si de verdad se pidió con --model; si no, la tarjeta lo dice en una línea.
      modelo: lanzado.modeloForzado ? modelo : null,
      resumen: [
        lanzado.modeloForzado ? "" : "La nube no deja elegir modelo; se pidió en el prompt.",
        `Construido por Claude en la nube (${resultado.segundos === null ? "sin tiempo" : `${resultado.segundos} s`}): build=${resultado.build} tests=${resultado.tests}. Sesión: ${lanzado.link}`,
        resultado.detalle ? `Lo que dejó en la rama:\n${resultado.detalle}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    };
  } finally {
    await quitarWorktree(repo, carpeta, rama);
  }
}

/**
 * La sesión de PARTIR (24-oct-2026): una tarea que se pasó del tiempo (o es muy grande) se divide en 2 a 4
 * partes pequeñas, en orden. Solo lee; contesta SOLO con un JSON { "partes": [{ "titulo", "detalle" }] }.
 */
export function promptDePartir(tarjeta, repo, { causa, error, motor = "claude" } = {}) {
  return [
    `Eres el Coordinador del Tablero IA de Magilus. Tienes que DIVIDIR en partes pequeñas esta tarea del repositorio "${repo.clave}", porque no se pudo hacer de una sola vez. ${
      motor === "codex" ? "Estás en modo de solo lectura" : "Estás en modo plan"
    }: NO cambies ningún archivo, solo lee el código.`,
    contextoDeLaTarjeta(tarjeta),
    tarjeta.plan ? `PLAN APROBADO (lo que hay que lograr entre todas las partes):\n${tarjeta.plan}` : "",
    `Por qué no se pudo: ${causa || "(no se sabe)"}${error ? `\nÚltimo error:\n${recortar(error, 2000)}` : ""}`,
    [
      `Divide el trabajo en entre ${MINIMO_DE_PARTES} y ${MAXIMO_DE_PARTES} partes. Reglas:`,
      "- Las partes se hacen EN ORDEN, cada una en su propia sesión y subida a main: la parte 2 parte de main con la parte 1 ya subida.",
      "- Cada parte es PEQUEÑA (ideal: menos de 6 archivos), tiene sentido por sí sola y deja el proyecto compilando y con las pruebas pasando.",
      "- Todas juntas cubren TODO el plan, sin repetir trabajo ni dejar huecos. No hagas partes que solo sean pruebas o solo documentación.",
      "- `titulo`: corto, qué logra esa parte. `detalle`: qué hay que hacer EXACTO en esa parte (archivos con su ruta desde la raíz, qué cambia, cómo se prueba), escrito para quien no vio el resto.",
      REGLAS_DE_ZONAS,
    ].join("\n"),
    'Contesta SOLO con un JSON válido, sin texto antes ni después: {"partes":[{"titulo":"...","detalle":"..."},{"titulo":"...","detalle":"..."}]}',
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Las partes que contestó la sesión de partir (2 a 4 con título y detalle), o ErrorDeEtapa si no sirven. */
export function partesDeLaRespuesta(texto) {
  const bruto = String(texto ?? "");
  const candidatos = [];
  const cerca = bruto.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (cerca) candidatos.push(cerca[1]);
  const primera = bruto.indexOf("{");
  const ultima = bruto.lastIndexOf("}");
  if (primera >= 0 && ultima > primera) candidatos.push(bruto.slice(primera, ultima + 1));
  const primeraLista = bruto.indexOf("[");
  const ultimaLista = bruto.lastIndexOf("]");
  if (primeraLista >= 0 && ultimaLista > primeraLista) candidatos.push(bruto.slice(primeraLista, ultimaLista + 1));
  for (const candidato of candidatos) {
    let datos;
    try {
      datos = JSON.parse(candidato);
    } catch {
      continue;
    }
    const lista = Array.isArray(datos) ? datos : datos?.partes;
    if (!Array.isArray(lista)) continue;
    const partes = lista
      .map((parte) => ({ titulo: enUnaLinea(parte?.titulo, 120), detalle: String(parte?.detalle ?? "").trim().slice(0, 6000) }))
      .filter((parte) => parte.titulo && parte.detalle);
    if (partes.length !== lista.length) continue;
    if (partes.length >= MINIMO_DE_PARTES && partes.length <= MAXIMO_DE_PARTES) return partes;
    throw new ErrorDeEtapa(`La sesión de dividir devolvió ${partes.length} parte(s): tienen que ser de ${MINIMO_DE_PARTES} a ${MAXIMO_DE_PARTES}.`, { categoria: "otra" });
  }
  throw new ErrorDeEtapa(`La sesión de dividir no devolvió partes válidas (un JSON con "partes" de título y detalle):\n${ultimasLineas(bruto, 10)}`, { categoria: "otra" });
}

/** La revisión (23-oct-2026): otro motor (por defecto Claude) revisa y corrige lo que construyó Codex. */
export function promptDeRevisar(tarjeta, repo, rama, quienConstruyo) {
  return [
    `Eres el REVISOR del Coordinador del Tablero IA de Magilus, en el repositorio "${repo.clave}" (worktree aparte, rama ${rama}). ${
      quienConstruyo === "codex" ? "Codex" : "Claude"
    } acaba de implementar el plan aprobado; los cambios están sin commit.`,
    contextoDeLaTarjeta(tarjeta),
    `PLAN APROBADO:\n${tarjeta.plan}`,
    [
      "Qué hacer:",
      "- Mira el cambio completo (git status y git diff, también los archivos nuevos) y compáralo con el plan.",
      "- Busca errores, casos que faltan, pruebas que faltan y reglas rotas. Arréglalos tú mismo editando los archivos.",
      "- No rehagas lo que está bien ni agregues cosas que el plan no pide.",
      "- No hagas git push ni commit, no cambies de rama ni toques el remoto.",
      `- ${REGLAS_DE_ZONAS}`,
      "- Termina con una REVISIÓN corta en español sencillo: qué encontraste y qué arreglaste (o \"todo bien\").",
    ].join("\n"),
  ].join("\n\n");
}

/**
 * El lint de main se guarda por commit (25-oct-2026): <carpetaTrabajo>/cache/lint/<repo>-<sha>.json. Varias tareas
 * salen del mismo commit de main y `eslint .` en un i3 tarda minutos: con el guardado, solo la primera lo mide.
 */
function archivoDeLintGuardado(contexto, repo, sha) {
  const llave = crypto.createHash("sha1").update(JSON.stringify(repo.lint?.comando ?? [])).digest("hex").slice(0, 8);
  return path.join(contexto.config.carpetaTrabajo, "cache", "lint", `${String(repo.clave ?? "repo").replace(/[^\w-]/g, "")}-${sha}-${llave}.json`);
}

/** El lint de la base: del guardado si ya se midió ese commit; si no, se mide (con turno en la cola) y se guarda. */
async function lintDeLaBase(contexto, repo, cwd, reloj, sha) {
  const archivo = sha ? archivoDeLintGuardado(contexto, repo, sha) : null;
  if (archivo) {
    try {
      const guardado = new Map(JSON.parse(fs.readFileSync(archivo, "utf8")));
      contexto.registro?.info?.(`lint de main ${sha.slice(0, 8)}: ya estaba medido (no se vuelve a correr)`);
      return guardado;
    } catch {
      // No estaba o no se pudo leer: se mide.
    }
  }
  const cuenta = await conTurno(contexto, reloj, PRIORIDAD.preparar, "medir el lint de main", () => erroresDeLint(contexto, repo, cwd, reloj));
  if (archivo) {
    try {
      fs.mkdirSync(path.dirname(archivo), { recursive: true });
      fs.writeFileSync(archivo, JSON.stringify([...cuenta]));
      // Solo los últimos 20 commits medidos.
      const carpeta = path.dirname(archivo);
      const viejos = fs
        .readdirSync(carpeta)
        .map((nombre) => ({ nombre, cuando: fs.statSync(path.join(carpeta, nombre)).mtimeMs }))
        .sort((a, b) => b.cuando - a.cuando)
        .slice(20);
      for (const viejo of viejos) fs.rmSync(path.join(carpeta, viejo.nombre), { force: true });
    } catch {
      // Guardar es una ayuda: si falla, la próxima vez se mide de nuevo.
    }
  }
  return cuenta;
}

/** Los errores de lint (no avisos) como firmas "archivo|regla|mensaje", contados. */
async function erroresDeLint(contexto, repo, cwd, reloj) {
  const timeoutMs = Math.min(reloj.resta(), contexto.config.tiempos.comandoMinutos * MINUTO);
  const resultado = await correr(repo.lint.comando, { cwd, env: entornoSeguro(), senal: contexto.senal, timeoutMs });
  if (resultado.vencido || resultado.cancelado) {
    throw new ErrorDeEtapa(`El lint (${comoTexto(repo.lint.comando)}) se pasó del tiempo. No se subió nada.`, { categoria: resultado.cancelado ? "coordinador_cortado" : "tiempo_agotado" });
  }
  let datos;
  try {
    datos = JSON.parse(resultado.salida.slice(resultado.salida.indexOf("[")));
  } catch {
    throw new ErrorDeEtapa(`El lint no devolvió JSON (${comoTexto(repo.lint.comando)}):\n${ultimasLineas(`${resultado.errores}\n${resultado.salida}`, 20)}`);
  }
  const cuenta = new Map();
  for (const archivo of datos) {
    const relativo = path.relative(cwd, archivo.filePath ?? "").replace(/\\/g, "/");
    for (const mensaje of archivo.messages ?? []) {
      if (mensaje.severity !== 2) continue;
      const firma = `${relativo}|${mensaje.ruleId ?? "?"}|${mensaje.message}`;
      cuenta.set(firma, (cuenta.get(firma) ?? 0) + 1);
    }
  }
  return cuenta;
}

function erroresNuevos(base, despues) {
  const nuevos = [];
  for (const [firma, veces] of despues) if (veces > (base.get(firma) ?? 0)) nuevos.push(firma);
  return nuevos;
}

/** Instalar + verificar + pruebas en el worktree. Devuelve el texto de "pruebas" para el resultado. */
async function verificar(contexto, repo, cwd, reloj, prioridad = PRIORIDAD.verificar) {
  const lineas = [];
  // Panel "Coordinador en vivo": desde acá la tarea está "probando".
  contexto.fase?.("probando");
  const comandos = [...repo.verificar.map((comando) => [comando, false]), ...repo.pruebas.map((comando) => [comando, true])];
  for (const [comando, esPrueba] of comandos) {
    await esperarAlPc(contexto, reloj, `correr ${comoTexto(comando)}`);
    // Un build que quedó a medias (otro intento, una sesión) deja .next/lock: se borra antes de compilar (24-oct-2026).
    if (/\bbuild\b/.test(comoTexto(comando))) await cerrarRestos(contexto, cwd);
    const resultado = await paso(contexto, comando, { cwd, reloj, que: "la verificación", motivo: motivoDeVerificacion(comando, esPrueba), prioridad });
    const cola = ultimasLineas(resultado.salida, 3);
    lineas.push(`✔ ${comoTexto(comando)}${cola ? `\n  ${cola.replace(/\n/g, "\n  ")}` : ""}`);
  }
  return lineas;
}

/** PLANEANDO -> el texto del plan. */
export async function planear(contexto, tarjeta) {
  const repo = configDelRepo(contexto, tarjeta);
  const reloj = relojDeEtapa(contexto.config.tiempos.planMinutos, "escribir el plan");
  const carpeta = carpetaDe(contexto, tarjeta, "plan");
  await git(repo.ruta, ["fetch", repo.remoto]);
  try {
    await crearWorktree(repo, carpeta, `${repo.remoto}/${repo.ramaBase}`, null);
    const motor = motorDelPaso(contexto, "planear");
    // El modelo lo decide el código, con reglas fijas (modelos.mjs), no una IA.
    const dificultad = dificultadDeLaTarea(tarjeta);
    const modelo = motor === "claude" ? modeloDelPaso(contexto.config, "planear", tarjeta) : null;
    if (modelo) {
      contexto.registro?.info?.(`plan: ${dificultad.dificil ? `tarea difícil (${dificultad.motivos.join("; ")})` : "tarea sencilla"} -> ${nombreDelModelo(modelo)}`);
    }
    const texto = await correrMotor(contexto, motor, "planear", promptDelPlan(tarjeta, repo, motor), {
      cwd: carpeta,
      timeoutMs: reloj.resta(),
      que: "escribir el plan",
      tarjeta,
      modelo,
    });
    return { plan: `${texto.replace(MARCA_DEL_PLAN, "").trimEnd()}\n\n${firmaDelPlan(motor, modelo)}`, motor, modelo };
  } finally {
    await quitarWorktree(repo, carpeta);
  }
}

/**
 * EN_CURSO -> el resultado (rama empujada, todo verificado).
 * `contexto.lugar === "nube"` (25-oct-2026, lo decide el planificador): el trabajo de escribir el código lo hace una
 * sesión de `claude --cloud` en la rama tablero/<id>; al volver, esta etapa trae la rama a aizen1 y hace lo mismo
 * que con cualquier tarea (instalar, prisma generate, tipos, build, pruebas, lint, zonas, ensayo y subir la rama).
 */
export async function construir(contexto, tarjeta) {
  const { config, registro } = contexto;
  if (!tarjeta.plan) throw new ErrorDeEtapa("La tarjeta no tiene plan aprobado.");
  const repo = configDelRepo(contexto, tarjeta);
  const enNube = contexto.lugar === "nube";
  // En la nube el reloj de la espera es el de construirNubeMinutos; al volver, la verificación en aizen1 tiene el suyo.
  let reloj = relojDeEtapa(enNube ? config.tiempos.construirNubeMinutos : config.tiempos.construirMinutos, enNube ? "construir en la nube" : "construir", {
    topeMinutos: enNube ? null : TOPE_DEL_CRM.construir,
  });
  let liberarPuesto = null;
  let rama = nombreDeRama(tarjeta);
  const base = `${repo.remoto}/${repo.ramaBase}`;
  const carpeta = carpetaDe(contexto, tarjeta, "construir");
  const intentos = carpetaDeIntentos(config.carpetaTrabajo, tarjeta.id);
  // La 2ª reparación seguida por lo mismo se hace con un modelo más fuerte (decidir -> estrategia "opus").
  const modeloElegido = tarjeta.reparacion?.estrategia === "opus" ? (config.modelos?.planear ?? "opus") : undefined;
  await git(repo.ruta, ["fetch", repo.remoto]);
  let baseSha = null;
  try {
    // En la nube: primero la rama sale de main, la sesión trabaja y deja su resultado; la verificación parte del
    // commit de main del que salió la rama (nube.baseComun) para medir el lint de la base y comparar.
    let nube = null;
    if (enNube) {
      rama = await ramaParaLaNube(repo, tarjeta);
      nube = await construirLaParteDeLaNube(contexto, tarjeta, { repo, rama, base, reloj });
    }
    // Ya volvió de la nube: lo que sigue (instalar, tipos, build, pruebas, ensayo) corre en aizen1. Hace fila por un puesto
    // (no más verificaciones a la vez que puestos de aizen1) y tiene su propio reloj, que no gastó la espera de la nube.
    if (nube) {
      contexto.fase?.("probando", { lugar: "aizen1" });
      liberarPuesto = (await contexto.puestoParaVerificar?.(contexto.senal)) ?? null;
      reloj = relojDeEtapa(config.nube.verificarMinutos, "verificar lo que volvió de la nube");
    }
    await crearWorktree(repo, carpeta, nube ? nube.baseComun : base, rama);
    baseSha = (await git(carpeta, ["rev-parse", "HEAD"])).salida.trim();
    // Lo que vuelve de la nube ya esperó: se verifica con la prioridad de verificar; una tarea nueva de aizen1, con la de preparar.
    const prioridadDeInstalar = nube ? PRIORIDAD.verificar : PRIORIDAD.preparar;
    if (repo.instalar) await paso(contexto, repo.instalar, { cwd: carpeta, reloj, que: "instalar dependencias", motivo: "No se pudieron instalar las dependencias", prioridad: prioridadDeInstalar });
    // El lint de main, para que solo cuenten los errores NUEVOS (guardado por commit: el mismo commit no se mide dos veces).
    const lintBase = repo.lint ? await lintDeLaBase(contexto, repo, carpeta, reloj, baseSha) : null;
    if (nube) {
      // La rama de la nube se trae encima de esa base. Si cambió las dependencias, se instala otra vez.
      await git(carpeta, ["merge", "--ff-only", `${repo.remoto}/${rama}`]);
      const tocoPaquetes = (await archivosCambiados(carpeta, nube.baseComun)).some((cambio) => /(^|\/)package(-lock)?\.json$/.test(cambio.archivo));
      if (tocoPaquetes && repo.instalar) await paso(contexto, repo.instalar, { cwd: carpeta, reloj, que: "instalar dependencias", motivo: "No se pudieron instalar las dependencias", prioridad: PRIORIDAD.verificar });
    }
    // Lo ya hecho en el intento anterior se reaplica (si encaja sobre main) DESPUÉS de medir el lint de la base.
    const patchAplicado = nube ? false : await reaplicarTrabajo(contexto, tarjeta, carpeta, intentos);

    let motor = nube ? "claude" : motorDelPaso(contexto, "construir");
    let resumenDelMotor;
    if (nube) resumenDelMotor = nube.resumen;
    else try {
      resumenDelMotor = await correrMotor(contexto, motor, "construir", promptDeConstruir(tarjeta, repo, rama, motor, { patchAplicado }), {
        cwd: carpeta,
        timeoutMs: reloj.resta(),
        que: "construir",
        tarjeta,
        modelo: modeloElegido,
      });
    } catch (error) {
      // Codex se agotó: se pausa. Pasa a Claude SOLO con motores.respaldoClaude (y si Claude está disponible).
      if (!(error instanceof ErrorDeEtapa && error.limiteDeUso && error.motor === "codex")) throw error;
      contexto.alLimite?.("codex");
      const respaldo = config.motores.respaldoClaude ? motorDelPaso(contexto, "construir") : null;
      if (respaldo !== "claude") throw error;
      registro.aviso("Codex llegó a su límite de uso: construyo con Claude (respaldoClaude)");
      // Lo que Codex alcanzó a escribir se descarta: Claude empieza limpio desde la base.
      await git(carpeta, ["reset", "--hard", baseSha]);
      await git(carpeta, ["clean", "-fd"]);
      motor = "claude";
      resumenDelMotor = await correrMotor(contexto, motor, "construir", promptDeConstruir(tarjeta, repo, rama, motor, { patchAplicado: false }), {
        cwd: carpeta,
        timeoutMs: reloj.resta(),
        que: "construir",
        tarjeta,
        modelo: modeloElegido,
      });
    } finally {
      // Lo que la sesión dejó corriendo (un next build colgado, un servidor) y el candado .next/lock.
      await cerrarRestos(contexto, carpeta);
    }
    const motores = { ...(motorDelPlan(tarjeta.plan) ? { plan: motorDelPlan(tarjeta.plan) } : {}), construir: motor };
    // Qué modelo hizo cada paso (para mostrarlo en la tarjeta). Codex no tiene modelo que elijamos acá.
    const modelos = {
      ...(modeloDelPlan(tarjeta.plan) ? { plan: modeloDelPlan(tarjeta.plan) } : {}),
      ...(motor === "claude" && !nube ? { construir: modeloElegido ?? modeloDelPaso(config, "construir", tarjeta), subagentes: modeloDelPaso(config, "subagentes", tarjeta) } : {}),
      ...(nube?.modelo ? { construir: nube.modelo } : {}),
    };

    // Lo que construyó Codex lo revisa otro paso (Claude por defecto; Codex si Claude está alto). Claude ya
    // se revisa con un subagente. Si la revisión falla, no se pierde lo construido: siguen las verificaciones.
    let revision = null;
    if (motor === "codex") {
      const revisor = motorDelPaso(contexto, "revisar");
      if (revisor) {
        try {
          revision = await correrMotor(contexto, revisor, "revisar", promptDeRevisar(tarjeta, repo, rama, motor), {
            cwd: carpeta,
            timeoutMs: Math.min(reloj.resta(), REVISAR_MAXIMO_MINUTOS * MINUTO),
            que: "revisar",
            tarjeta,
          });
          motores.revisar = revisor;
          if (revisor === "claude") modelos.revisar = modeloDelPaso(config, "revisar", tarjeta);
        } catch (error) {
          if (contexto.senal?.aborted) throw error;
          if (error instanceof ErrorDeEtapa && error.limiteDeUso && error.motor) contexto.alLimite?.(error.motor);
          registro.aviso(`la revisión con ${revisor} no se pudo (sigo con las verificaciones): ${error.message.split("\n")[0]}`);
        }
      }
    }

    // Marcas de conflicto que quedaron (de reaplicar a 3 vías): no se compila ni se sube nada con ellas.
    const sinResolver = await archivosConMarcasDeConflicto(carpeta);
    if (sinResolver.length) {
      throw new ErrorDeEtapa(`Quedaron marcas de conflicto (<<<<<<<) sin resolver en: ${sinResolver.slice(0, 10).join(", ")}. No se subió nada.`, { categoria: "no_compila" });
    }
    // El commit lo hace el Coordinador (si el motor hizo alguno, queda debajo).
    await git(carpeta, ["add", "-A"]);
    const pendiente = await git(carpeta, ["diff", "--cached", "--quiet"], { permitirFallo: true });
    if (pendiente.codigo !== 0) {
      await git(carpeta, ["commit", "-m", `tablero: ${tarjeta.titulo} (${idCorto(tarjeta.id)})`, "-m", `Tarjeta del Tablero IA: ${tarjeta.link}`], {
        identidad: config.git,
      });
    }
    const cambios = await archivosCambiados(carpeta, base);
    if (!cambios.length) {
      // "NO_CAMBIE: <motivo>" es la forma de decir que no hacía falta cambiar nada: ese motivo es la causa.
      const noCambie = String(resumenDelMotor).match(/^\s*NO_CAMBIE:\s*(.+)$/im)?.[1]?.trim();
      throw new ErrorDeEtapa(`${nombreDelMotor(motor)} no cambió ningún archivo${noCambie ? ` (NO_CAMBIE: ${noCambie})` : ""}.`, { categoria: "no_cambio_nada", archivosCambiados: 0 });
    }
    const archivos = cambios.map((cambio) => cambio.archivo);
    if (nube) {
      // Los .env nunca viajan: si la sesión de la nube dejó uno en la rama, no se sube nada.
      const secretos = archivos.filter((archivo) => /(^|\/)\.env(\.|$)/.test(archivo) && !/\.(example|sample|template)$/.test(archivo));
      if (secretos.length) throw new ErrorDeEtapa(`La sesión de la nube dejó archivos .env en la rama (${secretos.join(", ")}): no se sube nada. Sesión de la nube: ${nube.link}`);
    }

    // Zonas protegidas (chats, agentes, libro V3, Meta Ads): ya no es ERROR. Se construye y prueba igual,
    // pero no sube sola: el CRM la deja POR_REVISAR con la zona marcada, esperando el sí del dueño.
    const tocadas = zonasTocadas(archivos, repo.zonasProtegidas);
    const zonas = Object.keys(tocadas);
    const subeSolo = repo.subirSolo === true && zonas.length === 0 && !(tarjeta.zonasAprobadas ?? []).length;
    const zonasTexto = zonas.map((zona) => `${zona} (${tocadas[zona].slice(0, 5).join(", ")}${tocadas[zona].length > 5 ? "…" : ""})`).join("; ");

    const pruebas = await verificar(contexto, repo, carpeta, reloj);
    if (lintBase) {
      const nuevos = erroresNuevos(lintBase, await conTurno(contexto, reloj, PRIORIDAD.verificar, "lint", () => erroresDeLint(contexto, repo, carpeta, reloj)));
      if (nuevos.length) throw new ErrorDeEtapa(`El lint tiene ${nuevos.length} error(es) nuevo(s):\n${nuevos.slice(0, 15).join("\n")}\nNo se subió nada.`, { categoria: "lint" });
      pruebas.push("✔ lint sin errores nuevos");
    }
    const migraciones = migracionesNuevas(cambios, repo.carpetaMigraciones);
    let migracion = null;
    try {
      const ensayar = () =>
        ensayarMigraciones({
          migraciones,
          repo,
          ssh: config.ssh,
          cwd: carpeta,
          env: entornoSeguro(),
          senal: contexto.senal,
          timeoutMs: Math.min(reloj.resta(), config.tiempos.comandoMinutos * MINUTO),
        });
      migracion = migraciones.length ? await conTurno(contexto, reloj, PRIORIDAD.verificar, "ensayar la migración", ensayar) : await ensayar();
    } catch (error) {
      // Cortada esperando turno, o sin tiempo por la cola: no es la migración.
      if (error instanceof ErrorDeEtapa && ["coordinador_cortado", "pc_sobrecargado"].includes(error.categoria)) throw error;
      throw new ErrorDeEtapa(`${MOTIVO_ENSAYO}\nDetalle técnico: ${error.message}`, { categoria: "migracion" });
    }
    if (migracion) pruebas.push(`✔ ensayo de la migración: ${migracion}`);
    // Riesgo: lo destructivo de las migraciones nuevas. No hace fallar nada: el CRM decide si pide el sí del dueño.
    const destructivo = migracionDestructiva(migraciones, (ruta) => fs.readFileSync(path.join(carpeta, ruta), "utf8"));
    if (destructivo.length) pruebas.push(`⚠ migración con cambios destructivos: ${destructivo.join(", ")}`);
    const alTerminar = subeSolo
      ? "construido, sube solo"
      : zonas.length
        ? `construido, espera tu sí (zona ${zonasTexto})`
        : "construido, espera tu sí (en este repositorio el Coordinador todavía no sube solo)";
    pruebas.push(`→ ${alTerminar}`);

    reloj.resta();
    // La rama de la nube se sube sin --force, encima de lo que dejó la sesión; las de aizen1 se rehacen cada intento.
    await pushDeRama(carpeta, repo.remoto, rama, { forzar: !nube });
    const commit = (await git(carpeta, ["rev-parse", "HEAD"])).salida.trim();
    const web = webDeGithub(await urlDelRemoto(repo));
    registro.info(`rama ${rama} empujada (${commit.slice(0, 10)}): ${alTerminar}`);
    // Terminó bien: el patch del trabajo a medias de un intento anterior ya no sirve.
    borrarTrabajoGuardado(intentos);
    const textoMotores = Object.entries(motores)
      .map(([paso, cual]) => `${paso} ${cual}${modelos[paso] ? ` (${nombreDelModelo(modelos[paso])})` : ""}`)
      .join(" · ");
    return {
      resumen: [
        resumenDelMotor.slice(-3500),
        revision ? `Revisión (${motores.revisar}): ${revision.slice(-800)}` : null,
        `Archivos (${archivos.length}): ${archivos.slice(0, 40).join(", ")}${archivos.length > 40 ? "…" : ""}`,
        `Motores: ${textoMotores}.`,
        `Construida en: ${nube ? `la nube (${nube.link})` : "aizen1"}.`,
        `Al terminar: ${alTerminar}.`,
      ]
        .filter(Boolean)
        .join("\n\n"),
      motor: motores,
      modelo: modelos,
      pruebas: pruebas.join("\n").slice(0, 7000),
      paso: true,
      rama,
      linkRama: web ? `${web}/compare/${repo.ramaBase}...${encodeURIComponent(rama).replace(/%2F/g, "/")}` : null,
      commit,
      migracion,
      subeSolo,
      base: baseSha,
      // Para la última revisión de riesgo del CRM: los archivos que de verdad cambió y lo destructivo de la migración.
      archivos: archivos.slice(0, 300),
      migracionDestructiva: destructivo,
      // Dónde se construyó y el link de la sesión de la nube: la tarjeta lo muestra.
      construidoEn: nube ? "nube" : "aizen1",
      ...(nube ? { linkSesion: nube.link, segundosNube: nube.segundos } : {}),
      ...(zonas.length ? { zonaProtegida: zonas } : {}),
    };
  } catch (error) {
    // Lo ya hecho se guarda para el siguiente intento (un patch) y se anota cuántos archivos llevaba.
    // (En la nube lo hecho queda en la rama de GitHub: no hay patch que guardar.)
    if (baseSha && !enNube && error instanceof Error) await guardarTrabajo(contexto, tarjeta, carpeta, baseSha, intentos, error);
    throw error;
  } finally {
    fs.rmSync(path.join(carpeta, ".next", "lock"), { force: true });
    await quitarWorktree(repo, carpeta, rama);
    liberarPuesto?.();
  }
}

/* ── El trabajo a medias entre intentos: <carpetaTrabajo>/intentos/<idCorto>/trabajo.patch ── */

const firmaDelPlanAprobado = (tarjeta) => crypto.createHash("sha1").update(String(tarjeta.plan ?? "")).digest("hex").slice(0, 16);

function borrarTrabajoGuardado(carpetaIntentos) {
  for (const nombre of ["trabajo.patch", "trabajo.json"]) fs.rmSync(path.join(carpetaIntentos, nombre), { force: true });
}

/**
 * Al fallar construir: guarda lo que se alcanzó a cambiar como un patch contra main (con el commit, si el
 * Coordinador ya lo hizo, y los archivos nuevos) y anota en el error cuántos archivos eran. Nunca lanza.
 */
async function guardarTrabajo(contexto, tarjeta, carpeta, baseSha, carpetaIntentos, error) {
  try {
    if (!fs.existsSync(carpeta)) return;
    await git(carpeta, ["add", "-A"], { permitirFallo: true });
    const nombres = (await git(carpeta, ["diff", "--cached", "--name-only", baseSha], { permitirFallo: true })).salida.split(/\r?\n/).filter(Boolean);
    if (error.archivosCambiados === null || error.archivosCambiados === undefined) error.archivosCambiados = nombres.length;
    if (!nombres.length) {
      borrarTrabajoGuardado(carpetaIntentos);
      return;
    }
    const patch = await git(carpeta, ["diff", "--cached", "--binary", baseSha], { permitirFallo: true });
    if (patch.codigo !== 0 || !patch.salida.trim()) return;
    fs.mkdirSync(carpetaIntentos, { recursive: true });
    fs.writeFileSync(path.join(carpetaIntentos, "trabajo.patch"), patch.salida.endsWith("\n") ? patch.salida : `${patch.salida}\n`);
    fs.writeFileSync(path.join(carpetaIntentos, "trabajo.json"), JSON.stringify({ plan: firmaDelPlanAprobado(tarjeta), archivos: nombres.length, guardado: new Date().toISOString() }));
    contexto.registro?.info?.(`guardé el trabajo a medias (${nombres.length} archivo(s)) en ${path.join(carpetaIntentos, "trabajo.patch")}`);
  } catch (otro) {
    contexto.registro?.aviso?.(`no se pudo guardar el trabajo a medias: ${otro.message}`);
  }
}

/** Los archivos (versionados o nuevos) que tienen marcas de conflicto de git al principio de una línea. */
async function archivosConMarcasDeConflicto(carpeta) {
  const r = await git(carpeta, ["grep", "-l", "--untracked", "-E", "^(<<<<<<<|>>>>>>>)( |$)"], { permitirFallo: true });
  return r.codigo === 0 ? r.salida.split(/\r?\n/).map((linea) => linea.trim()).filter(Boolean) : [];
}

/**
 * Reaplica el patch del intento anterior sobre la base limpia si encaja (git apply --check); si no encaja, a 3 vías.
 * true = quedó aplicado; { conflictos: [archivos] } = aplicado con marcas de conflicto por resolver; false = limpio.
 */
async function reaplicarTrabajo(contexto, tarjeta, carpeta, carpetaIntentos) {
  const archivoPatch = path.join(carpetaIntentos, "trabajo.patch");
  if (!fs.existsSync(archivoPatch)) return false;
  const { registro } = contexto;
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(carpetaIntentos, "trabajo.json"), "utf8"));
    if (meta.plan !== firmaDelPlanAprobado(tarjeta)) {
      registro?.info?.("el trabajo guardado es de otro plan: empiezo limpio");
      borrarTrabajoGuardado(carpetaIntentos);
      return false;
    }
  } catch {
    borrarTrabajoGuardado(carpetaIntentos);
    return false;
  }
  const comprobacion = await git(carpeta, ["apply", "--check", archivoPatch], { permitirFallo: true });
  if (comprobacion.codigo !== 0) {
    // 25-oct-2026: antes se tiraba el trabajo y Claude rehacía TODO. Ahora se aplica a 3 vías: lo que encaja queda, y lo
    // que choca con lo nuevo de main queda con marcas de conflicto (<<<<<<<) para que Claude solo resuelva eso.
    const tresVias = await git(carpeta, ["apply", "--3way", "--whitespace=nowarn", archivoPatch], { permitirFallo: true });
    const conMarcas = await archivosConMarcasDeConflicto(carpeta);
    if (tresVias.codigo === 0 || conMarcas.length) {
      // Las marcas quedan como cambios normales (sin "unmerged" en el índice): Claude las ve con git diff y las arregla.
      await git(carpeta, ["reset", "-q"], { permitirFallo: true });
      registro?.info?.(`reapliqué el trabajo del intento anterior a 3 vías${conMarcas.length ? `; quedan conflictos por resolver en: ${conMarcas.join(", ")}` : ""}`);
      return conMarcas.length ? { conflictos: conMarcas } : true;
    }
    await git(carpeta, ["checkout", "--", "."], { permitirFallo: true });
    await git(carpeta, ["clean", "-fd"], { permitirFallo: true });
    registro?.aviso?.("el trabajo del intento anterior no encaja sobre main: empiezo limpio (con la causa escrita en el prompt)");
    borrarTrabajoGuardado(carpetaIntentos);
    return false;
  }
  const aplicado = await git(carpeta, ["apply", "--whitespace=nowarn", archivoPatch], { permitirFallo: true });
  if (aplicado.codigo !== 0) {
    await git(carpeta, ["checkout", "--", "."], { permitirFallo: true });
    await git(carpeta, ["clean", "-fd"], { permitirFallo: true });
    borrarTrabajoGuardado(carpetaIntentos);
    return false;
  }
  registro?.info?.("reapliqué el trabajo del intento anterior sobre main");
  return true;
}

const dormir = (ms) => new Promise((resolver) => setTimeout(resolver, ms));

/** Reemplaza {commit} y {run} en un comando de la configuración. */
const conValores = (comando, valores) => comando.map((parte) => parte.replace(/\{(\w+)\}/g, (todo, clave) => valores[clave] ?? todo));

/**
 * Espera el CI del commit (si está configurado): busca la corrida y la mira hasta que termine.
 * Solo lanza si el CI corrió y FALLÓ. Si no se pudo consultar GitHub (gh sin sesión, que pasa cuando el
 * Coordinador corre como tarea programada, o la corrida no aparece) devuelve el motivo y sigue: la prueba
 * de verdad es que /api/version diga el commit nuevo (22-10-2026: por esto se deshizo un cambio bueno).
 */
async function esperarCi(contexto, repo, commit, cwd, reloj) {
  const { ciBuscar, ciEsperar, ciMinutos } = repo.subida;
  if (!ciBuscar || !ciEsperar) return "CI: no configurado";
  const limite = Date.now() + Math.min(ciMinutos * MINUTO, reloj.resta());
  let corrida = "";
  while (!corrida) {
    const resultado = await correr(conValores(ciBuscar, { commit }), { cwd, timeoutMs: 60_000, senal: contexto.senal });
    if (resultado.cancelado) throw new ErrorDeEtapa("Se canceló la espera del CI: la tarjeta venció en el CRM.");
    if (resultado.codigo !== 0 && /gh auth login|GH_TOKEN|authentication/i.test(resultado.errores)) {
      return "CI: no se pudo consultar (gh sin sesión en este PC; poner GH_TOKEN)";
    }
    // Solo un número es una corrida: con la lista vacía `--jq .[0].databaseId` escribe "null" (25-oct-2026: eso se
    // tomaba por una corrida, `gh run watch null` fallaba y se deshacía una subida buena).
    corrida = resultado.codigo === 0 ? (resultado.salida.trim().split(/\s+/).find((palabra) => /^\d+$/.test(palabra)) ?? "") : "";
    if (corrida) break;
    if (Date.now() > limite) return `CI: no apareció la corrida de ${commit.slice(0, 10)} (se revisa la versión)`;
    await dormir(10_000);
  }
  // Panel "Coordinador en vivo": mientras espera las pruebas automáticas, la tarea figura en GitHub Actions.
  const web = webDeGithub(await urlDelRemoto(repo));
  contexto.fase?.("subiendo", { lugar: "github", linkWorkflow: web ? `${web}/actions/runs/${corrida}` : null });
  let resultado;
  try {
    resultado = await correr(conValores(ciEsperar, { commit, run: corrida }), {
      cwd,
      timeoutMs: Math.max(1, limite - Date.now()),
      senal: contexto.senal,
    });
  } finally {
    contexto.fase?.("subiendo", { lugar: "aizen1", linkWorkflow: null });
  }
  if (resultado.codigo !== 0) {
    throw new ErrorDeEtapa(
      `Subió a ${repo.ramaBase} (commit ${commit.slice(0, 10)}) pero el CI ${resultado.vencido ? "se pasó del tiempo" : "falló"}: ${ultimasLineas(
        `${resultado.errores}\n${resultado.salida}`,
        20,
      )}`,
    );
  }
  return `CI ${corrida}: ok`;
}

/** ¿`version` (lo que dice /api/version) es el commit subido o uno más nuevo que ya lo incluye? */
async function versionIncluye(repo, version, commit) {
  if (!version) return false;
  if (version === commit || commit.startsWith(version) || version.startsWith(commit)) return true;
  // Otro push llegó justo después y quedó en producción: si ese commit contiene el nuestro, también arrancó.
  await git(repo.ruta, ["fetch", repo.remoto], { permitirFallo: true });
  const ancestro = await git(repo.ruta, ["merge-base", "--is-ancestor", commit, version], { permitirFallo: true });
  return ancestro.codigo === 0;
}

/** Espera que la URL de versión diga el commit nuevo, o uno posterior que lo incluya (= arrancó la versión nueva). */
async function esperarVersion(contexto, repo, commit, reloj, { sinCi = false } = {}) {
  const { urlVersion, campoVersion, versionMinutos, urlArranque, ciMinutos } = repo.subida;
  if (!urlVersion) return { version: null, texto: "versión: no configurada" };
  // Si no se encontró la corrida del CI, el despliegue puede venir atrasado: se le da también el tiempo del CI
  // antes de decir "no arrancó" y deshacer (25-oct-2026).
  const minutos = sinCi ? versionMinutos + (ciMinutos ?? 0) : versionMinutos;
  const limite = Date.now() + Math.min(minutos * MINUTO, reloj.resta());
  let ultima = "";
  for (;;) {
    try {
      const respuesta = await fetch(urlVersion, { headers: { "Cache-Control": "no-cache" }, signal: AbortSignal.timeout(15_000) });
      const datos = await respuesta.json();
      ultima = String(datos?.[campoVersion] ?? "");
      if (await versionIncluye(repo, ultima, commit)) break;
    } catch {
      // El servidor puede estar reiniciando: se vuelve a preguntar.
    }
    if (Date.now() > limite) {
      throw new ErrorDeEtapa(
        `Subió a ${repo.ramaBase} y el CI pasó, pero ${urlVersion} sigue diciendo "${ultima || "nada"}" en vez de ${commit.slice(0, 10)}: la versión nueva no arrancó.`,
      );
    }
    await dormir(10_000);
  }
  if (urlArranque) {
    const respuesta = await fetch(urlArranque, { signal: AbortSignal.timeout(15_000) }).catch(() => null);
    if (!respuesta || respuesta.status >= 500) {
      throw new ErrorDeEtapa(`La versión nueva arrancó pero ${urlArranque} contesta ${respuesta?.status ?? "nada"}.`);
    }
  }
  return { version: ultima, texto: `versión ${ultima.slice(0, 10)}: ok` };
}

/**
 * SUBIENDO -> sube a main. Llega acá sola (construir pasó todo, subirSolo y sin zona protegida) o con
 * el sí final del dueño (las de zona protegida y las que ya estaban POR_REVISAR).
 */
export async function subir(contexto, tarjeta) {
  const { config, registro } = contexto;
  const repo = configDelRepo(contexto, tarjeta);
  const reloj = relojDeEtapa(config.tiempos.subirMinutos, "subir", { topeMinutos: TOPE_DEL_CRM.subir });
  const rama = tarjeta.resultado?.rama;
  if (!esRamaDelTrabajador(rama)) throw new ErrorDeEtapa(`La tarjeta no tiene una rama del Coordinador para subir (rama: ${rama ?? "ninguna"}).`);
  if (tarjeta.resultado?.paso !== true) throw new ErrorDeEtapa("El resultado no dice que todo pasó: no se sube.");
  const base = `${repo.remoto}/${repo.ramaBase}`;
  const carpeta = carpetaDe(contexto, tarjeta, "subir");
  const ramaLocal = `subida/${idCorto(tarjeta.id)}`;
  await git(repo.ruta, ["fetch", repo.remoto]);
  try {
    await crearWorktree(repo, carpeta, `${repo.remoto}/${rama}`, ramaLocal);
    const cabeza = (await git(carpeta, ["rev-parse", "HEAD"])).salida.trim();
    let antes;
    let pruebas;
    let commit;
    // 25-oct-2026: rebase (con los .md y demás "sin choque" juntados solos, git.mjs: rebaseSobre), verificar y push. Si
    // main cambió MIENTRAS se verificaba (push rechazado), se reintenta UNA vez sola: fetch, rebase y verificar de nuevo.
    for (let vuelta = 1; ; vuelta += 1) {
      antes = (await git(carpeta, ["rev-parse", base])).salida.trim();
      // Si main sigue donde estaba al construir y la rama es la que se probó, ya está todo verificado.
      const mainIgual = vuelta === 1 && Boolean(tarjeta.resultado?.base) && tarjeta.resultado.base === antes && tarjeta.resultado?.commit === cabeza;
      const rebase = await rebaseSobre(carpeta, base, { identidad: config.git, carpetaTrabajo: config.carpetaTrabajo, sinChoque: repo.sinChoque, nombre: repo.clave });
      if (!rebase.ok) {
        throw new ErrorDeEtapa(
          `Choca con lo nuevo de ${repo.ramaBase}: alguien cambió los mismos archivos mientras se construía (conflicto en el rebase de ${rama}${rebase.conflicto.length ? `: ${rebase.conflicto.join(", ")}` : ""}). No se subió nada; hay que reintentar (construir de nuevo).`,
          { categoria: "choca_con_main" },
        );
      }
      if (mainIgual) {
        pruebas = [`✔ ${repo.ramaBase} no cambió desde que se construyó: no se vuelve a compilar`];
      } else {
        if (repo.instalar) await paso(contexto, repo.instalar, { cwd: carpeta, reloj, que: "instalar dependencias", motivo: "No se pudieron instalar las dependencias", prioridad: PRIORIDAD.subir });
        pruebas = await verificar(contexto, repo, carpeta, reloj, PRIORIDAD.subir);
        contexto.fase?.("subiendo");
        const cambios = await archivosCambiados(carpeta, base);
        const migraciones = migracionesNuevas(cambios, repo.carpetaMigraciones);
        try {
          const ensayar = () =>
            ensayarMigraciones({
              migraciones,
              repo,
              ssh: config.ssh,
              cwd: carpeta,
              env: entornoSeguro(),
              senal: contexto.senal,
              timeoutMs: Math.min(reloj.resta(), config.tiempos.comandoMinutos * MINUTO),
            });
          const migracion = migraciones.length ? await conTurno(contexto, reloj, PRIORIDAD.subir, "ensayar la migración", ensayar) : await ensayar();
          if (migracion) pruebas.push(`✔ ensayo de la migración: ${migracion}`);
        } catch (error) {
          if (error instanceof ErrorDeEtapa && ["coordinador_cortado", "pc_sobrecargado"].includes(error.categoria)) throw error;
          throw new ErrorDeEtapa(`${MOTIVO_ENSAYO}\nDetalle técnico: ${error.message}`, { categoria: "migracion" });
        }
      }
      if (vuelta > 1) pruebas.unshift(`✔ ${repo.ramaBase} cambió mientras se verificaba: rebase y verificación otra vez (reintento automático)`);

      reloj.resta();
      commit = (await git(carpeta, ["rev-parse", "HEAD"])).salida.trim();
      try {
        await pushARamaBase(carpeta, repo.remoto, repo.ramaBase);
        break;
      } catch (error) {
        const rechazado = /rejected|fetch first|non-fast-forward|failed to push/i.test(String(error?.message ?? ""));
        if (rechazado && vuelta === 1) {
          registro.info(`${repo.ramaBase} cambió mientras se verificaba (push rechazado): rebase de nuevo y reintento una vez`);
          await git(repo.ruta, ["fetch", repo.remoto]);
          continue;
        }
        throw new ErrorDeEtapa(`No se pudo subir a ${repo.ramaBase} (¿cambió mientras tanto?). No se subió nada.\nDetalle técnico: ${error.message}`, { categoria: "choca_con_main" });
      }
    }
    registro.info(`subido a ${repo.ramaBase}: ${commit.slice(0, 10)} (${tarjeta.titulo})`);
    let version;
    try {
      const ci = await esperarCi(contexto, repo, commit, carpeta, reloj);
      const comprobada = await esperarVersion(contexto, repo, commit, reloj, { sinCi: !/: ok$/.test(ci) });
      version = comprobada.version;
      registro.info(`${ci}; ${comprobada.texto}`);
    } catch (error) {
      // Se subió y no arrancó: se deshace lo subido para que producción vuelva a la versión anterior.
      throw await deshacerSubida(contexto, repo, carpeta, { antes, commit, motivo: error instanceof Error ? error.message : String(error) });
    }
    const web = webDeGithub(await urlDelRemoto(repo));
    return { commit, version: version ?? commit, pruebas, linkCommit: web ? `${web}/commit/${commit}` : null };
  } finally {
    await quitarWorktree(repo, carpeta, ramaLocal);
  }
}

/**
 * PARTIR (24-oct-2026): una sesión de SOLO LECTURA (worktree desde origin/main, modo plan / sandbox read-only)
 * divide la tarea en 2 a 4 partes pequeñas, en orden. Devuelve [{ titulo, detalle }]; el bucle llama /partir.
 */
export async function partirTarea(contexto, tarjeta, { causa = "", error = "" } = {}) {
  const repo = configDelRepo(contexto, tarjeta);
  const reloj = relojDeEtapa(Math.min(contexto.config.tiempos.planMinutos, 15), "dividir la tarea");
  const carpeta = carpetaDe(contexto, tarjeta, "partir");
  await git(repo.ruta, ["fetch", repo.remoto]);
  try {
    await crearWorktree(repo, carpeta, `${repo.remoto}/${repo.ramaBase}`, null);
    const motor = motorDelPaso(contexto, "planear");
    const modelo = motor === "claude" ? modeloDelPaso(contexto.config, "planear", { ...tarjeta, intentos: 2 }) : null;
    const texto = await correrMotor(contexto, motor, "planear", promptDePartir(tarjeta, repo, { causa, error, motor }), {
      cwd: carpeta,
      timeoutMs: reloj.resta(),
      que: "dividir la tarea",
      tarjeta,
      modelo,
    });
    return partesDeLaRespuesta(texto);
  } finally {
    await quitarWorktree(repo, carpeta);
  }
}

/**
 * DIAGNÓSTICO de una causa desconocida (categoría "otra"): una sesión corta de Claude, SOLO LECTURA (herramientas
 * Read y Grep, sin editar ni correr nada), lee el log del intento y escribe la causa en UNA línea.
 * Devuelve el texto de la causa, o "" si no contestó nada útil. Puede lanzar (el bucle lo ignora).
 */
export async function diagnosticarConClaude(contexto, { rutaLog, error }) {
  const { config } = contexto;
  const cwd = path.dirname(rutaLog);
  const prompt = [
    "Eres el DIAGNOSTICADOR del Coordinador del Tablero IA de Magilus. Una etapa falló y no se reconoció la causa por reglas. SOLO LEES: no cambies nada ni corras comandos.",
    `El log completo del intento está en el archivo ${path.basename(rutaLog)} (en tu carpeta de trabajo: léelo con Read; busca con Grep). Lo último del error:`,
    recortar(String(error ?? ""), 2500),
    "Escribe la causa de la falla en UNA sola línea, en español sencillo, de máximo 200 caracteres: qué pasó de verdad (no repitas el comando). Contesta SOLO con esa línea.",
  ].join("\n\n");
  const modelo = modeloDelPaso(config, "leer");
  const argumentos = ["-p", "--model", modelo, "--permission-mode", "plan", "--output-format", "text", "--allowedTools", "Read", "Grep", "--disallowedTools", "Edit", "Write", "Bash", "WebFetch"];
  const texto = await claude(contexto, argumentos, prompt, { cwd, timeoutMs: (config.reparar?.diagnosticoMinutos ?? 3) * MINUTO, que: "diagnosticar" });
  return enUnaLinea(texto.split(/\r?\n/).find((linea) => linea.trim()) ?? "").replace(/^["'`]+|["'`]+$/g, "");
}

/** Revert del commit en main después de un despliegue fallido. Devuelve el ErrorDeEtapa para la tarjeta. */
async function deshacerSubida(contexto, repo, carpeta, { antes, commit, motivo }) {
  const { config, registro } = contexto;
  registro.error(`el despliegue de ${commit.slice(0, 10)} falló; se deshace: ${motivo}`);
  try {
    const revert = await revertirEnRamaBase(carpeta, {
      remoto: repo.remoto,
      ramaBase: repo.ramaBase,
      antes,
      commit,
      carpetaMigraciones: repo.carpetaMigraciones,
      identidad: config.git,
    });
    registro.info(`deshecho: revert ${revert.slice(0, 10)} de ${commit.slice(0, 10)} en ${repo.ramaBase}`);
    return new ErrorDeEtapa(
      `Se subió, no arrancó y se deshizo; producción vuelve a la versión anterior.\nCommit deshecho: ${commit.slice(0, 10)} (revert ${revert.slice(0, 10)}).\nDetalle técnico: ${motivo}`,
      { reversion: { commit, revert, ok: true } },
    );
  } catch (error) {
    registro.error(`URGENTE: no se pudo deshacer ${commit}: ${error.message}`);
    return new ErrorDeEtapa(
      `URGENTE: no se pudo deshacer, revisar a mano. El commit ${commit} quedó en ${repo.ramaBase} y el despliegue falló.\nPor qué falló el despliegue: ${motivo}\nPor qué no se pudo deshacer: ${error.message}`,
      { reversion: { commit, revert: null, ok: false } },
    );
  }
}
