// La configuración del trabajador: trabajador-tablero/config.local.json (NO se versiona: tiene la clave).
// La plantilla es config.example.json. Acá se leen, se completan los valores por defecto y se revisan.
import fs from "node:fs";
import path from "node:path";

import { MODELOS_POR_DEFECTO } from "./modelos.mjs";

/** Lo que Claude puede usar al CONSTRUIR (acceptEdits): editar dentro del worktree y correr pruebas. */
export const HERRAMIENTAS_PERMITIDAS = [
  "Read",
  "Edit",
  "Write",
  "Glob",
  "Grep",
  "Bash(npm run:*)",
  "Bash(npx tsc:*)",
  "Bash(npx eslint:*)",
  "Bash(npx prisma generate:*)",
  "Bash(npx prisma validate:*)",
  "Bash(npx prisma format:*)",
  "Bash(node scripts/:*)",
  "Bash(git status:*)",
  "Bash(git diff:*)",
  "Bash(git log:*)",
  "Bash(git show:*)",
  // Sin "Agent" ni "Task" (24-oct-2026): construir no lanza subagentes ni tareas en segundo plano, porque una
  // sesión se quedó esperándolos durante horas. Planear sí puede (no usa esta lista).
];

/** Lo que Claude NUNCA puede usar, aunque se cuele en la lista de arriba. */
export const HERRAMIENTAS_PROHIBIDAS = [
  "Bash(git push:*)",
  "Bash(git remote:*)",
  "Bash(git reset:*)",
  "Bash(git checkout:*)",
  "Bash(git rebase:*)",
  "Bash(npx prisma migrate:*)",
  "Bash(npx prisma db:*)",
  "Bash(npm run db:*)",
  "Bash(ssh:*)",
  "Bash(curl:*)",
  // El build lo hace el Coordinador (dos builds en la misma carpeta se traban en .next/lock): la sesión no lo corre.
  "Bash(npm run build:*)",
  "Bash(npx next:*)",
  "Bash(next:*)",
  "WebFetch",
  // Subagentes y tareas en segundo plano: una sesión de construir las lanzó y se quedó esperándolas.
  "Agent",
  "Task",
];

const TIEMPOS_POR_DEFECTO = {
  // Un poco menos que el tope del CRM (20 / 90 / 45 min), para avisar el error antes de que venza.
  planMinutos: 19,
  construirMinutos: 88,
  subirMinutos: 44,
  // Construir en la nube (25-oct-2026): el CRM da 180 min cuando el latido dice "nube". Un poco menos, igual que arriba.
  construirNubeMinutos: 178,
  latidoSegundos: 60,
  intervaloSegundos: 60,
  // Cada comando de verificación (tsc, build, pruebas) como mucho esto.
  comandoMinutos: 30,
  // Si Claude llega a su límite de uso, la tarjeta se suelta sin ERROR y no se abren sesiones por esto.
  pausaLimiteMinutos: 30,
};

/** Los motores que se pueden usar en cada paso (23-oct-2026): Claude Code y Codex CLI (ChatGPT Plus). */
export const MOTORES = ["claude", "codex"];

/**
 * Quién hace cada paso: Claude planea y revisa lo que construyó Codex; Codex construye; sin pasar a Claude
 * si Codex se agota. `revisar` puede ser "ninguno" (no hay revisión aparte).
 */
// 23-10-2026: Alexander ya no tiene ChatGPT Plus. Por defecto todo con Claude; Codex queda listo para
// activarlo poniendo "construir": "codex". respaldoCodex: si Claude pasa el umbral o se agota, ¿sus pasos
// pasan a Codex? Apagado: sobre el umbral solo se avisa, y si Claude se agota la tarjeta espera.
const MOTORES_POR_DEFECTO = { planear: "claude", construir: "claude", revisar: "claude", respaldoClaude: false, respaldoCodex: false };

// Los modelos por paso y las reglas de "tarea difícil" están en modelos.mjs (MODELOS_POR_DEFECTO).

/** Cuántas tarjetas a la vez como mucho EN AIZEN1 (22-oct-2026). El CRM tampoco da más de 12 en total (aizen1 + nube). */
const MAXIMO_EN_PARALELO = 5;

/**
 * Tareas grandes y de desborde a la nube con `claude --cloud` (25-oct-2026, decisión del dueño). Reglas fijas, sin IA:
 *  - GRANDE (más de `maxArchivosChica` archivos en el plan, migración, agente nuevo, o ya falló por tamaño o recursos) -> nube;
 *  - chica -> aizen1 si tiene puesto; si aizen1 ya tiene `maxParalelo`, la siguiente aprobada también va a la nube (desborde).
 * `maxTareas` es un tope de seguridad de tareas en la nube a la vez (no un tope del plan de Claude).
 * `terminal`: "auto" (primero sin terminal, y si no sirve una terminal real con node-pty), "sin-terminal" o "pty".
 * `entorno`: variables NO secretas que van dentro de la instrucción (nunca claves, .env ni tokens).
 */
const NUBE_POR_DEFECTO = {
  activa: true,
  maxTareas: 8,
  maxArchivosChica: 8,
  vigilarCadaSegundos: 60,
  // Cuánto se espera el commit "resultado:" de la nube y, aparte, cuánto se da para verificar en aizen1 lo que volvió
  // (instalar, tipos, build, pruebas, ensayo): 120 + 45 caben en los 180 min que da el CRM.
  esperaMinutos: 120,
  verificarMinutos: 45,
  terminal: "auto",
  lanzarMinutos: 5,
  // 26-oct-2026 (regla del dueño): si la nube dejó build=OK y tests=OK, aizen1 no compila ni prueba lo que volvió (ni
  // npm ci, tsc, build, pruebas ni lint): solo zonas, .env, el ensayo de la migración (BEGIN…ROLLBACK) y subir.
  confiarEnResultado: true,
};

/** Si la CPU (promedio SOSTENIDO de los últimos cpuPromedioMinutos) o la memoria pasan de esto, no se abre otra sesión. */
// esperaMaximaMinutos (24-oct-2026): con 0 sesiones y el PC por encima de los límites, el Coordinador espera
// hasta esto antes de tomar una tarjeta (y después la toma igual); la espera dentro de una etapa tampoco se
// come el reloj de la etapa. 0 = no espera.
// cpuPromedioMinutos (25-oct-2026): antes era 1 min y un build de otro worktree ("CPU 100 %") frenaba todo; ahora 3.
const LIMITES_POR_DEFECTO = { cpuPorciento: 85, memoriaPorciento: 85, esperaMaximaMinutos: 10, cpuPromedioMinutos: 3 };

/**
 * Cola de pasos pesados de aizen1 (25-oct-2026, cola.mjs): cuántos npm ci / lint / tsc / build / pruebas corren a la
 * vez en todo aizen1, sin importar cuántas sesiones haya. 0 = sin cola (como antes).
 */
// esperaMaximaMinutos (26-oct-2026): lo más que una tarea NUEVA de aizen1 espera turno para instalar o medir el lint de main
// (prioridad "preparar", antes de que Claude escriba nada). Pasado eso se suelta sin contar el intento y vuelve a la fila del
// tablero, en vez de dejar que el candado del CRM (90 min desde que se tomó) venza con ERROR. 0 = sin límite.
const COLA_PESADA_POR_DEFECTO = { maximo: 1, esperaMaximaMinutos: 20 };

/** Cuándo se parte una tarea en partes más chicas (24-oct-2026): con tantos archivos cambiados a medias, o por contexto, o si se pasa dos veces del tiempo. */
// archivosAntes / archivosConMigracion (25-oct-2026, reparto.mjs: debePartirAntes): una tarea de aizen1 con más archivos
// de código que esto en el plan se parte ANTES de construir. 0 = no se parte antes.
const PARTIR_POR_DEFECTO = { archivosMinimos: 8, archivosAntes: 25, archivosConMigracion: 15 };

/** Reparar solo (24-oct-2026). diagnosticoConClaude: si no se reconoce la causa, una sesión corta de Claude (solo lectura) lee el log. */
const REPARAR_POR_DEFECTO = { diagnosticoConClaude: true, diagnosticoMinutos: 3 };

/** Sesión atascada (24-oct-2026): sin tocar archivos ni usar el procesador por `minutos`, se corta. 0 = apagado. */
const ATASCO_POR_DEFECTO = { minutos: 15, revisarCadaSegundos: 60, cpuMinimaSegundos: 0.3 };

/** Autoactualización (25-oct-2026): cada tanto mira si main trae código nuevo del Coordinador y se reinicia solo. Ver lib/autoactualizar.mjs. */
const AUTOACTUALIZAR_POR_DEFECTO = { activo: true, cadaMinutos: 10, rama: "main", remoto: "origin" };

/**
 * El manual de la noche (26-oct-2026, manual-nocturno.mjs): una vez al día, pasada `hora` (Bogotá), junta las notas de
 * docs/cambios-pendientes/ en docs/que-es-esta-aplicacion.md y sube el cambio a main. Solo para el repo `repo`.
 */
const MANUAL_POR_DEFECTO = { activo: true, hora: 23, repo: "aizencrm" };

export function leerConfig(ruta) {
  if (!fs.existsSync(ruta)) {
    throw new Error(`No existe ${ruta}. Copia config.example.json a config.local.json y complétalo (ver README.md).`);
  }
  let datos;
  try {
    datos = JSON.parse(fs.readFileSync(ruta, "utf8").replace(/^﻿/, ""));
  } catch (error) {
    throw new Error(`${ruta} no es un JSON válido: ${error.message}`);
  }
  return completarConfig(datos, path.dirname(ruta));
}

const lista = (valor) => (Array.isArray(valor) ? valor : []);
const comando = (valor, campo) => {
  if (valor === undefined || valor === null) return null;
  if (!Array.isArray(valor) || !valor.length || !valor.every((parte) => typeof parte === "string")) {
    throw new Error(`${campo} va como lista: ["npm", "run", "build"].`);
  }
  return valor;
};

export function completarConfig(datos, base = process.cwd()) {
  const errores = [];
  const urlCrm = typeof datos.urlCrm === "string" ? datos.urlCrm.replace(/\/+$/, "") : "";
  if (!/^https?:\/\//.test(urlCrm)) errores.push('urlCrm: la dirección del CRM, por ejemplo "https://app.aizenbot.com".');
  if (urlCrm.startsWith("http://") && !/^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(urlCrm)) {
    errores.push("urlCrm tiene que ser https (salvo localhost, para pruebas).");
  }
  const claveTrabajador = typeof datos.claveTrabajador === "string" ? datos.claveTrabajador.trim() : "";
  if (!claveTrabajador.startsWith("aizen_trab_")) errores.push("claveTrabajador: la clave que se crea en el panel Coordinador (aizen_trab_...).");
  const carpetaTrabajo = path.resolve(base, typeof datos.carpetaTrabajo === "string" ? datos.carpetaTrabajo : "../../trabajador-tablero-trabajo");

  const repos = {};
  for (const [clave, repo] of Object.entries(datos.repos ?? {})) {
    if (!repo || typeof repo.ruta !== "string") {
      errores.push(`repos.${clave}.ruta: la carpeta del repositorio en este PC.`);
      continue;
    }
    const zonasProtegidas = repo.zonasProtegidas && typeof repo.zonasProtegidas === "object" ? repo.zonasProtegidas : {};
    const subirSolo = repo.subirSolo === true;
    // Un descuido en la configuración no puede hacer que un cambio de chats suba solo: en AizenCRM,
    // subirSolo exige la zona CHATS con sus rutas.
    if (subirSolo && clave === "aizencrm" && !(Array.isArray(zonasProtegidas.CHATS) && zonasProtegidas.CHATS.length)) {
      errores.push(`repos.${clave}.subirSolo está prendido pero falta la zona CHATS en zonasProtegidas: no se prende sin ella.`);
    }
    // Zonas que suben solas (24-oct-2026): las mismas que ZONAS_QUE_SUBEN_SOLAS del CRM. Sin la lista, todas piden el sí.
    const zonasQueSubenSolas = lista(repo.zonasQueSubenSolas).filter((zona) => typeof zona === "string" && zona.trim());
    for (const zona of zonasQueSubenSolas) {
      if (!(Array.isArray(zonasProtegidas[zona]) && zonasProtegidas[zona].length)) {
        errores.push(`repos.${clave}.zonasQueSubenSolas: la zona ${zona} no tiene rutas en zonasProtegidas.`);
      }
    }
    const vigilancia = {
      minutos: Number(repo.vigilancia?.minutos) > 0 ? Number(repo.vigilancia.minutos) : 30,
      cadaSegundos: Number(repo.vigilancia?.cadaSegundos) > 0 ? Number(repo.vigilancia.cadaSegundos) : 60,
      // Cuántos errores nuevos en los logs (que no estaban antes de subir) hacen deshacer el cambio.
      maxErroresNuevos: Number(repo.vigilancia?.maxErroresNuevos) >= 1 ? Math.floor(Number(repo.vigilancia.maxErroresNuevos)) : 3,
    };
    if (vigilancia.minutos > 40) errores.push(`repos.${clave}.vigilancia.minutos: de 1 a 40 (el candado de subir en el CRM es de 80 min).`);
    try {
      repos[clave] = {
        clave,
        subirSolo,
        zonasQueSubenSolas,
        vigilancia,
        // "dueño/repo" en GitHub: la vigilancia de la rama en la nube lo usa (si falta, se saca del remoto).
        github: typeof repo.github === "string" && /^[\w.-]+\/[\w.-]+$/.test(repo.github) ? repo.github : null,
        ruta: path.resolve(base, repo.ruta),
        ramaBase: typeof repo.ramaBase === "string" ? repo.ramaBase : "main",
        remoto: typeof repo.remoto === "string" ? repo.remoto : "origin",
        instalar: comando(repo.instalar, `repos.${clave}.instalar`),
        verificar: lista(repo.verificar).map((uno, i) => comando(uno, `repos.${clave}.verificar[${i}]`)),
        pruebas: lista(repo.pruebas).map((uno, i) => comando(uno, `repos.${clave}.pruebas[${i}]`)),
        lint: repo.lint?.comando ? { comando: comando(repo.lint.comando, `repos.${clave}.lint.comando`) } : null,
        carpetaMigraciones: typeof repo.carpetaMigraciones === "string" ? repo.carpetaMigraciones.replace(/\\/g, "/") : null,
        ensayoPglite: comando(repo.ensayoPglite, `repos.${clave}.ensayoPglite`),
        ensayoProduccion: repo.ensayoProduccion?.tablaGuia ? { tablaGuia: String(repo.ensayoProduccion.tablaGuia) } : null,
        zonasProtegidas,
        // Archivos de solo agregar que no hacen chocar y se juntan (merge=union) al subir (choques.mjs: noChoca); por defecto los .md.
        sinChoque: Array.isArray(repo.sinChoque) ? repo.sinChoque.filter((glob) => typeof glob === "string" && glob.trim()) : ["**/*.md"],
        // GitHub Actions revisa la rama antes que aizen1 (ciDeRama.activo). Apagado o sin comandos: todo como antes.
        ciDeRama: {
          activo: repo.ciDeRama?.activo === true,
          buscar: comando(repo.ciDeRama?.buscar, `repos.${clave}.ciDeRama.buscar`),
          esperar: comando(repo.ciDeRama?.esperar, `repos.${clave}.ciDeRama.esperar`),
          log: comando(repo.ciDeRama?.log, `repos.${clave}.ciDeRama.log`),
          minutos: Number(repo.ciDeRama?.minutos) > 0 ? Number(repo.ciDeRama.minutos) : 20,
        },
        subida: {
          ciBuscar: comando(repo.subida?.ciBuscar, `repos.${clave}.subida.ciBuscar`),
          ciEsperar: comando(repo.subida?.ciEsperar, `repos.${clave}.subida.ciEsperar`),
          ciMinutos: Number(repo.subida?.ciMinutos) || 20,
          urlVersion: typeof repo.subida?.urlVersion === "string" ? repo.subida.urlVersion : null,
          campoVersion: typeof repo.subida?.campoVersion === "string" ? repo.subida.campoVersion : "version",
          versionMinutos: Number(repo.subida?.versionMinutos) || 10,
          urlArranque: typeof repo.subida?.urlArranque === "string" ? repo.subida.urlArranque : null,
        },
      };
    } catch (error) {
      errores.push(error.message);
    }
  }
  if (!Object.keys(repos).length) errores.push("repos: falta al menos un repositorio (gestion, aizencrm).");

  const ssh =
    datos.ssh && typeof datos.ssh.destino === "string" && typeof datos.ssh.psql === "string"
      ? {
          comando: comando(datos.ssh.comando, "ssh.comando") ?? ["ssh"],
          destino: datos.ssh.destino,
          psql: datos.ssh.psql,
          // Vigilancia de 30 min (zonas que suben solas): el comando remoto que imprime los últimos logs del contenedor
          // y el que dice si sigue corriendo ("true <reinicios>"). Solo lectura.
          logs: typeof datos.ssh.logs === "string" && datos.ssh.logs.trim() ? datos.ssh.logs.trim() : null,
          estado: typeof datos.ssh.estado === "string" && datos.ssh.estado.trim() ? datos.ssh.estado.trim() : null,
        }
      : null;
  for (const repo of Object.values(repos)) {
    if (repo.zonasQueSubenSolas.length && !ssh?.logs) {
      errores.push(`repos.${repo.clave}.zonasQueSubenSolas necesita ssh.logs (el comando que lee los logs): sin vigilancia de 30 minutos no suben solas.`);
    }
  }

  const maxParalelo = datos.maxParalelo === undefined ? 2 : Math.floor(Number(datos.maxParalelo));
  if (!Number.isFinite(maxParalelo) || maxParalelo < 1 || maxParalelo > MAXIMO_EN_PARALELO) {
    errores.push(`maxParalelo: cuántas tarjetas a la vez en aizen1, de 1 a ${MAXIMO_EN_PARALELO}.`);
  }
  const limites = { ...LIMITES_POR_DEFECTO, ...(datos.limites ?? {}) };
  for (const campo of ["cpuPorciento", "memoriaPorciento"]) {
    limites[campo] = Number(limites[campo]);
    if (!Number.isFinite(limites[campo]) || limites[campo] < 10 || limites[campo] > 100) {
      errores.push(`limites.${campo}: un porcentaje de 10 a 100.`);
    }
  }

  limites.cpuPromedioMinutos = Number(limites.cpuPromedioMinutos);
  if (!Number.isFinite(limites.cpuPromedioMinutos) || limites.cpuPromedioMinutos < 0.5 || limites.cpuPromedioMinutos > 15) {
    errores.push("limites.cpuPromedioMinutos: de 0.5 a 15 minutos (el promedio de CPU que decide si se abre otra sesión).");
  }
  const colaPesada = { ...COLA_PESADA_POR_DEFECTO, ...(datos.colaPesada ?? {}) };
  colaPesada.maximo = Math.floor(Number(colaPesada.maximo));
  if (!Number.isFinite(colaPesada.maximo) || colaPesada.maximo < 0 || colaPesada.maximo > 5) errores.push("colaPesada.maximo: de 0 a 5 (0 = sin cola).");
  colaPesada.esperaMaximaMinutos = Number(colaPesada.esperaMaximaMinutos);
  if (!Number.isFinite(colaPesada.esperaMaximaMinutos) || colaPesada.esperaMaximaMinutos < 0 || colaPesada.esperaMaximaMinutos > 80) {
    errores.push("colaPesada.esperaMaximaMinutos: de 0 a 80 minutos (0 = sin límite; el candado del CRM al construir es de 90).");
  }
  limites.esperaMaximaMinutos = Number(limites.esperaMaximaMinutos);
  if (!Number.isFinite(limites.esperaMaximaMinutos) || limites.esperaMaximaMinutos < 0 || limites.esperaMaximaMinutos > 240) {
    errores.push("limites.esperaMaximaMinutos: minutos de 0 a 240 (0 = no espera al PC).");
  }
  const partir = { ...PARTIR_POR_DEFECTO, ...(datos.partir ?? {}) };
  partir.archivosMinimos = Number(partir.archivosMinimos);
  if (!Number.isFinite(partir.archivosMinimos) || partir.archivosMinimos < 1) errores.push("partir.archivosMinimos: cuántos archivos cambiados a medias hacen partir la tarea (1 o más).");
  for (const campo of ["archivosAntes", "archivosConMigracion"]) {
    partir[campo] = Number(partir[campo]);
    if (!Number.isFinite(partir[campo]) || partir[campo] < 0) errores.push(`partir.${campo}: un número de archivos, 0 o más (0 = no se parte antes de construir).`);
  }
  const atasco = { ...ATASCO_POR_DEFECTO, ...(datos.atasco ?? {}) };
  for (const campo of ["minutos", "revisarCadaSegundos", "cpuMinimaSegundos"]) {
    atasco[campo] = Number(atasco[campo]);
    if (!Number.isFinite(atasco[campo]) || atasco[campo] < 0) errores.push(`atasco.${campo}: un número, 0 o más (atasco.minutos en 0 apaga el vigilante).`);
  }
  const reparar = { ...REPARAR_POR_DEFECTO, ...(datos.reparar ?? {}) };
  reparar.diagnosticoMinutos = Number(reparar.diagnosticoMinutos);
  if (typeof reparar.diagnosticoConClaude !== "boolean") errores.push("reparar.diagnosticoConClaude: true o false.");
  if (!Number.isFinite(reparar.diagnosticoMinutos) || reparar.diagnosticoMinutos <= 0) errores.push("reparar.diagnosticoMinutos: minutos, más de 0.");

  const manual = { ...MANUAL_POR_DEFECTO, ...(datos.manual ?? {}) };
  if (typeof manual.activo !== "boolean") errores.push("manual.activo: true o false.");
  manual.hora = Number(manual.hora);
  if (!Number.isInteger(manual.hora) || manual.hora < 0 || manual.hora > 23) errores.push("manual.hora: la hora de la noche, un entero de 0 a 23 (hora de Bogotá).");
  if (typeof manual.repo !== "string" || !manual.repo.trim()) errores.push("manual.repo: el nombre del repo (en repos) que tiene el manual.");

  const auto = { ...AUTOACTUALIZAR_POR_DEFECTO, ...(datos.autoactualizar ?? {}) };
  if (typeof auto.activo !== "boolean") errores.push("autoactualizar.activo: true o false.");
  auto.cadaMinutos = Number(auto.cadaMinutos);
  if (!Number.isFinite(auto.cadaMinutos) || auto.cadaMinutos < 1) errores.push("autoactualizar.cadaMinutos: minutos, 1 o más.");
  for (const campo of ["rama", "remoto"]) {
    if (typeof auto[campo] !== "string" || !/^[\w./-]+$/.test(auto[campo])) errores.push(`autoactualizar.${campo}: un nombre de git.`);
  }

  const nube = { ...NUBE_POR_DEFECTO, ...(datos.nube ?? {}) };
  if (typeof nube.activa !== "boolean") errores.push("nube.activa: true o false.");
  for (const campo of ["maxTareas", "maxArchivosChica"]) {
    nube[campo] = Number(nube[campo]);
    if (!Number.isFinite(nube[campo]) || nube[campo] < 1) errores.push(`nube.${campo}: un número, 1 o más.`);
  }
  for (const campo of ["vigilarCadaSegundos", "esperaMinutos", "verificarMinutos", "lanzarMinutos"]) {
    nube[campo] = Number(nube[campo]);
    if (!Number.isFinite(nube[campo]) || nube[campo] <= 0) errores.push(`nube.${campo}: un número, más de 0.`);
  }
  // El CRM da 12 tarjetas a la vez entre aizen1 y la nube: más que eso lo recorta en silencio y contesta "ocupado".
  if (nube.activa === true && Number.isFinite(maxParalelo) && maxParalelo + nube.maxTareas > 12) {
    errores.push(`maxParalelo (${maxParalelo}) + nube.maxTareas (${nube.maxTareas}) no pueden pasar de 12: es lo que da el CRM a la vez entre aizen1 y la nube.`);
  }
  if (!["auto", "sin-terminal", "pty"].includes(nube.terminal)) errores.push('nube.terminal: "auto", "sin-terminal" o "pty".');
  if (typeof nube.confiarEnResultado !== "boolean") errores.push("nube.confiarEnResultado: true o false.");
  let comandoGh = ["gh"];
  let comandoClaudeNube = null;
  try {
    comandoGh = comando(nube.comandoGh, "nube.comandoGh") ?? ["gh"];
    comandoClaudeNube = comando(nube.comandoClaude, "nube.comandoClaude");
  } catch (error) {
    errores.push(error.message);
  }
  const entornoNube = {};
  for (const [nombre, valor] of Object.entries(nube.entorno ?? {})) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(nombre) || typeof valor !== "string") errores.push(`nube.entorno.${nombre}: NOMBRE_EN_MAYUSCULAS con un texto.`);
    else entornoNube[nombre] = valor;
  }

  const motores = { ...MOTORES_POR_DEFECTO, ...(datos.motores ?? {}) };
  for (const paso of ["planear", "construir"]) {
    if (!MOTORES.includes(motores[paso])) errores.push(`motores.${paso}: "claude" o "codex".`);
  }
  if (![...MOTORES, "ninguno"].includes(motores.revisar)) errores.push('motores.revisar: "claude", "codex" o "ninguno".');
  if (typeof motores.respaldoClaude !== "boolean") errores.push("motores.respaldoClaude: true o false.");
  if (typeof motores.respaldoCodex !== "boolean") errores.push("motores.respaldoCodex: true o false.");
  const modelos = { ...MODELOS_POR_DEFECTO, ...(datos.modelos ?? {}) };
  for (const paso of Object.keys(MODELOS_POR_DEFECTO)) {
    if (typeof modelos[paso] !== "string" || !/^[\w.:-]+$/.test(modelos[paso])) errores.push(`modelos.${paso}: un nombre de modelo ("opus", "sonnet" o el id completo).`);
  }
  const pausaLimiteCodexMinutos = datos.pausaLimiteCodexMinutos === undefined ? 30 : Number(datos.pausaLimiteCodexMinutos);
  if (!Number.isFinite(pausaLimiteCodexMinutos) || pausaLimiteCodexMinutos < 1) errores.push("pausaLimiteCodexMinutos: minutos, 1 o más.");
  const umbralClaude = datos.umbralClaude === undefined ? 80 : Number(datos.umbralClaude);
  if (!Number.isFinite(umbralClaude) || umbralClaude < 1 || umbralClaude > 100) errores.push("umbralClaude: un porcentaje de 1 a 100.");
  let comandoCodex = ["codex"];
  try {
    comandoCodex = comando(datos.comandoCodex, "comandoCodex") ?? ["codex"];
  } catch (error) {
    errores.push(error.message);
  }

  if (errores.length) throw new Error(`La configuración tiene problemas:\n- ${errores.join("\n- ")}`);

  return {
    urlCrm,
    claveTrabajador,
    carpetaTrabajo,
    repos,
    ssh,
    maxParalelo,
    nube: {
      activa: nube.activa,
      maxTareas: Math.floor(nube.maxTareas),
      maxArchivosChica: Math.floor(nube.maxArchivosChica),
      vigilarCadaSegundos: nube.vigilarCadaSegundos,
      esperaMinutos: nube.esperaMinutos,
      verificarMinutos: nube.verificarMinutos,
      lanzarMinutos: nube.lanzarMinutos,
      terminal: nube.terminal,
      confiarEnResultado: nube.confiarEnResultado,
      comandoGh,
      comandoClaude: comandoClaudeNube,
      entorno: entornoNube,
    },
    limites,
    manual: { activo: manual.activo, hora: manual.hora, repo: manual.repo },
    autoactualizar: { activo: auto.activo, cadaMinutos: auto.cadaMinutos, rama: auto.rama, remoto: auto.remoto },
    colaPesada: { maximo: colaPesada.maximo, esperaMaximaMinutos: colaPesada.esperaMaximaMinutos },
    partir: { archivosMinimos: partir.archivosMinimos, archivosAntes: partir.archivosAntes, archivosConMigracion: partir.archivosConMigracion },
    atasco: { minutos: atasco.minutos, revisarCadaSegundos: atasco.revisarCadaSegundos, cpuMinimaSegundos: atasco.cpuMinimaSegundos },
    reparar: { diagnosticoConClaude: reparar.diagnosticoConClaude, diagnosticoMinutos: reparar.diagnosticoMinutos },
    comandoClaude: comando(datos.comandoClaude, "comandoClaude") ?? ["claude"],
    comandoCodex,
    motores: {
      planear: motores.planear,
      construir: motores.construir,
      revisar: motores.revisar === "ninguno" ? null : motores.revisar,
      respaldoClaude: motores.respaldoClaude,
      respaldoCodex: motores.respaldoCodex,
    },
    modelos: Object.fromEntries(Object.keys(MODELOS_POR_DEFECTO).map((paso) => [paso, modelos[paso]])),
    pausaLimiteCodexMinutos,
    umbralClaude,
    // Cada cuánto se mira el uso del plan de Claude (`claude -p /usage`). 0 = no se mira.
    vigilarUsoMinutos: datos.vigilarUsoMinutos === undefined ? 10 : Math.max(0, Number(datos.vigilarUsoMinutos) || 0),
    herramientasPermitidas: lista(datos.herramientasPermitidas).length ? datos.herramientasPermitidas : HERRAMIENTAS_PERMITIDAS,
    herramientasProhibidas: [...new Set([...HERRAMIENTAS_PROHIBIDAS, ...lista(datos.herramientasProhibidas)])],
    tiempos: { ...TIEMPOS_POR_DEFECTO, ...(datos.tiempos ?? {}) },
    git: {
      nombre: typeof datos.git?.nombre === "string" ? datos.git.nombre : "Coordinador Tablero IA",
      correo: typeof datos.git?.correo === "string" ? datos.git.correo : "gestionmagilus@gmail.com",
    },
  };
}
