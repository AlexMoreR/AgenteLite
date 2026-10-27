// REVISIÓN PREVIA (27-oct-2026, tarjeta "Coordinador: revisar antes de arrancar que la tarea se pueda hacer"). Puro: sin disco,
// red ni procesos. El 26-oct fallaron 5 tareas sin que nada estuviera dañado: dependían de otra tarjeta que no estaba en main,
// ya estaban hechas, o chocaron con errores viejos de main. Acá viven las tres palabras que entiende el Coordinador:
//
//  - `DEPENDE_DE: <id o «título»>`  la sesión descubrió que falta algo que otra tarjeta todavía no subió a main. La tarjeta
//                                   queda "Esperando a otra" (no FALLIDO ni ERROR) y no gasta intento ni reparación.
//  - `YA_ESTA_HECHO: <commit> — <motivo>`  lo pedido ya está en main. El Coordinador comprueba el commit con git antes de creerle.
//  - lo que ya fallaba en main (lint, build, pruebas) no se le cobra a la tarea: se comparan las "firmas" de cada falla.

const ID_DE_TARJETA = /\bcm[a-z0-9]{20,28}\b/g;
const TITULO_ENTRE_COMILLAS = /[«"“]([^«»"“”\n]{4,120})[»"”]/g;
const SIN_COLOR = /\u001b\[[0-9;]*[A-Za-z]/g;

/**
 * Solo las primeras (`{ inicio: N }`) o las últimas (`{ final: N }`) N líneas con texto: la palabra clave es la respuesta de la
 * sesión, no una frase de un plan que explica cómo funcionan estas palabras. Sin ventana, todo el texto.
 */
function ventanaDe(texto, ventana) {
  const todo = String(texto ?? "");
  if (!ventana) return todo;
  const lineas = todo.split(/\r?\n/).filter((linea) => linea.trim());
  return (ventana.inicio ? lineas.slice(0, ventana.inicio) : lineas.slice(-(ventana.final ?? lineas.length))).join("\n");
}

/**
 * Las tarjetas de las que la sesión dice depender: líneas "DEPENDE_DE: <id o «título»>" (pueden ser varias, o varias en una línea).
 * -> lista de referencias (ids primero), máximo 5. Vacía si la sesión no escribió la palabra.
 */
export function dependenciasDeLaRespuesta(texto, ventana) {
  const referencias = [];
  for (const linea of String(ventanaDe(texto, ventana)).matchAll(/^[\s>*`_-]*DEPENDE_DE:[ \t]*(.+)$/gim)) {
    const resto = linea[1];
    // La instrucción del prompt ("<id o «título» de esa tarjeta>") repetida tal cual no es una dependencia.
    if (/<[^>]*>/.test(resto)) continue;
    const ids = resto.match(ID_DE_TARJETA) ?? [];
    const titulos = [...resto.matchAll(TITULO_ENTRE_COMILLAS)].map((coincidencia) => coincidencia[1].trim());
    if (ids.length || titulos.length) referencias.push(...ids, ...titulos);
    else {
      // Sin id ni comillas: todo lo que siga es el título.
      const crudo = resto.replace(/[`*_]+/g, "").trim();
      if (crudo.length >= 4) referencias.push(crudo.slice(0, 120));
    }
  }
  return [...new Set(referencias)].slice(0, 5);
}

/**
 * "YA_ESTA_HECHO: <commit> — <motivo>" -> { commit, motivo } o null. El commit es una cadena hexadecimal de 7 a 40 letras.
 * Sin commit legible no vale: sin él no se puede comprobar con git.
 */
export function yaEstaHechoDe(texto, ventana) {
  const linea = String(ventanaDe(texto, ventana)).match(/^[\s>*`_-]*YA_ESTA_HECHO:[ \t]*(.+)$/im)?.[1];
  if (!linea) return null;
  const commit = linea.match(/\b[0-9a-f]{7,40}\b/i)?.[0]?.toLowerCase();
  if (!commit) return null;
  const motivo = linea
    .replace(commit, "")
    .replace(/^[\s`*_:—–-]+/, "")
    .replace(/[`*_]+/g, "")
    .trim();
  return { commit, motivo: motivo.slice(0, 300) };
}

/** La nota con que la tarjeta pasa a HECHO. */
export const notaDeYaHecho = (commit) => `ya estaba hecho (commit ${commit})`;

/* ── Lo que ya fallaba en main ── */

/**
 * Las "firmas" de una salida que falló: una por cada falla reconocible (error de tipos, prueba que no pasó, error de lint,
 * error de build), sin colores, sin números de línea ni tiempos, para poder compararlas con las de main.
 */
export function firmasDeFalla(texto) {
  const firmas = new Set();
  let archivoDeLint = null;
  for (const cruda of String(texto ?? "").replace(SIN_COLOR, "").split(/\r?\n/)) {
    const linea = cruda.trim();
    if (!linea) continue;
    // eslint "stylish": el archivo en su línea y debajo "  12:5  error  mensaje  regla".
    if (/^(?:[A-Za-z]:)?[\w./\\@[\]()-]+\.[a-z]{1,4}$/.test(linea) && !/\s/.test(linea)) {
      archivoDeLint = linea.replace(/\\/g, "/");
      continue;
    }
    const lint = linea.match(/^\d+:\d+\s+error\s+(.+?)\s{2,}([\w@/-]+)$/);
    if (lint) {
      firmas.add(`lint|${archivoDeLint ?? "?"}|${lint[2]}|${lint[1]}`);
      continue;
    }
    const tipos = linea.match(/^(.+?)\(\d+,\d+\):\s*error\s+(TS\d+):\s*(.+)$/) ?? linea.match(/^(.+?):\d+:\d+\s*-\s*error\s+(TS\d+):\s*(.+)$/);
    if (tipos) {
      firmas.add(`tipos|${tipos[1].replace(/\\/g, "/")}|${tipos[2]}|${tipos[3]}`);
      continue;
    }
    // Pruebas: "not ok 3 - nombre", "✖ nombre (12ms)", "FAIL archivo > nombre", "× nombre".
    const prueba = linea.match(/^(?:not ok\s+\d*\s*-?\s*|[✖✗×]\s+|FAIL\s+)(.+)$/);
    if (prueba) {
      firmas.add(`prueba|${prueba[1].replace(/\s*\(\d+(?:\.\d+)?\s*m?s\)\s*$/, "").trim()}`);
      continue;
    }
    // Build: "Failed to compile", "Type error: …", "Module not found: …".
    const build = linea.match(/^(?:Type error|Module not found|Error):\s*(.+)$/);
    if (build) firmas.add(`build|${build[1].trim()}`);
  }
  return firmas;
}

/**
 * ¿La falla de la tarea es SOLO la que ya tenía main? Verdadero únicamente si las dos tienen firmas y toda firma de la tarea
 * está en main. Una falla sin firmas reconocibles, o con una firma nueva, sigue frenando a la tarea.
 */
export function esSoloLoDeMain(firmasDeLaTarea, firmasDeMain) {
  const tarea = [...firmasDeLaTarea];
  if (!tarea.length || !firmasDeMain?.size) return false;
  return tarea.every((firma) => firmasDeMain.has(firma));
}

/* ── La tarjeta única de limpieza ── */

/** El título de la tarjeta de limpieza de un repo: la CRM busca una abierta con este mismo título antes de crear otra. */
export const tituloDeLimpieza = (repo) => `Limpieza: main trae errores viejos (${repo})`;

/** El detalle de la tarjeta de limpieza: la lista de errores viejos (máximo 40 líneas). */
export function detalleDeLimpieza(repo, errores) {
  const lista = [...new Set((errores ?? []).map((error) => String(error).trim()).filter(Boolean))].slice(0, 40);
  return [
    `main de ${repo} ya trae errores que no son de ninguna tarea nueva. El Coordinador los encontró al verificar y dejó pasar las tareas que no los empeoraron.`,
    "Arréglalos sin cambiar lo que hace el sistema (solo lint, tipos o pruebas):",
    ...lista.map((error) => `- ${error}`),
  ].join("\n");
}
