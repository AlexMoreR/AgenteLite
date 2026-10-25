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
};

/** Si la CPU (promedio del último minuto) o la memoria pasan de esto, no se abre otra sesión. */
// esperaMaximaMinutos (24-oct-2026): con 0 sesiones y el PC por encima de los límites, el Coordinador espera
// hasta esto antes de tomar una tarjeta (y después la toma igual); la espera dentro de una etapa tampoco se
// come el reloj de la etapa. 0 = no espera.
const LIMITES_POR_DEFECTO = { cpuPorciento: 85, memoriaPorciento: 85, esperaMaximaMinutos: 10 };

/** Cuándo se parte una tarea en partes más chicas (24-oct-2026): con tantos archivos cambiados a medias, o por contexto, o si se pasa dos veces del tiempo. */
const PARTIR_POR_DEFECTO = { archivosMinimos: 8 };

/** Reparar solo (24-oct-2026). diagnosticoConClaude: si no se reconoce la causa, una sesión corta de Claude (solo lectura) lee el log. */
const REPARAR_POR_DEFECTO = { diagnosticoConClaude: true, diagnosticoMinutos: 3 };

/** Sesión atascada (24-oct-2026): sin tocar archivos ni usar el procesador por `minutos`, se corta. 0 = apagado. */
const ATASCO_POR_DEFECTO = { minutos: 15, revisarCadaSegundos: 60, cpuMinimaSegundos: 0.3 };

/** Autoactualización (25-oct-2026): cada tanto mira si main trae código nuevo del Coordinador y se reinicia solo. Ver lib/autoactualizar.mjs. */
const AUTOACTUALIZAR_POR_DEFECTO = { activo: true, cadaMinutos: 10, rama: "main", remoto: "origin" };

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
    try {
      repos[clave] = {
        clave,
        subirSolo,
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
      ? { comando: comando(datos.ssh.comando, "ssh.comando") ?? ["ssh"], destino: datos.ssh.destino, psql: datos.ssh.psql }
      : null;

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

  limites.esperaMaximaMinutos = Number(limites.esperaMaximaMinutos);
  if (!Number.isFinite(limites.esperaMaximaMinutos) || limites.esperaMaximaMinutos < 0 || limites.esperaMaximaMinutos > 240) {
    errores.push("limites.esperaMaximaMinutos: minutos de 0 a 240 (0 = no espera al PC).");
  }
  const partir = { ...PARTIR_POR_DEFECTO, ...(datos.partir ?? {}) };
  partir.archivosMinimos = Number(partir.archivosMinimos);
  if (!Number.isFinite(partir.archivosMinimos) || partir.archivosMinimos < 1) errores.push("partir.archivosMinimos: cuántos archivos cambiados a medias hacen partir la tarea (1 o más).");
  const atasco = { ...ATASCO_POR_DEFECTO, ...(datos.atasco ?? {}) };
  for (const campo of ["minutos", "revisarCadaSegundos", "cpuMinimaSegundos"]) {
    atasco[campo] = Number(atasco[campo]);
    if (!Number.isFinite(atasco[campo]) || atasco[campo] < 0) errores.push(`atasco.${campo}: un número, 0 o más (atasco.minutos en 0 apaga el vigilante).`);
  }
  const reparar = { ...REPARAR_POR_DEFECTO, ...(datos.reparar ?? {}) };
  reparar.diagnosticoMinutos = Number(reparar.diagnosticoMinutos);
  if (typeof reparar.diagnosticoConClaude !== "boolean") errores.push("reparar.diagnosticoConClaude: true o false.");
  if (!Number.isFinite(reparar.diagnosticoMinutos) || reparar.diagnosticoMinutos <= 0) errores.push("reparar.diagnosticoMinutos: minutos, más de 0.");

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
      comandoGh,
      comandoClaude: comandoClaudeNube,
      entorno: entornoNube,
    },
    limites,
    autoactualizar: { activo: auto.activo, cadaMinutos: auto.cadaMinutos, rama: auto.rama, remoto: auto.remoto },
    partir: { archivosMinimos: partir.archivosMinimos },
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
