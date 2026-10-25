// El DIAGNÓSTICO de una falla (24-oct-2026). Puro: no toca disco, red ni procesos, así se prueba sin nada.
//
// Cuando una etapa falla, el Coordinador ya no manda la tarjeta a ERROR a la primera: averigua POR QUÉ
// (diagnosticar), decide qué hacer (decidir: reparar, partir, esperar o escalar) y, si escala, escribe un
// resumen de máximo 3 líneas para el dueño (resumenDeEscalada). El protocolo con el CRM está en el
// README ("Reparar solo") y en reglas-trabajador.ts del CRM (los topes son los mismos).
//
// Las reglas salen de lo que de verdad pasó (22 y 23-oct-2026): "Claude tardó más de 50 min", pruebas que se
// pasan de tiempo con el PC saturado, ".next/lock" / "el build está ocupado", "Claude no cambió ningún
// archivo" y el límite de uso de Claude. Si una etapa ya sabe la causa, lo dice en `error.categoria`
// (ErrorDeEtapa) y acá no se adivina nada.
import { esLimiteDeCodex } from "./motores.mjs";

/** Las categorías (slugs): son las mismas del lado del CRM. */
export const CATEGORIAS = [
  "limite_claude",
  "pc_sobrecargado",
  "tiempo_agotado",
  "no_compila",
  "fallan_pruebas",
  "lint",
  "choca_con_main",
  "migracion",
  "no_cambio_nada",
  "carpeta_trabada",
  "tarea_muy_grande",
  "coordinador_cortado",
  "sesion_atascada",
  "otra",
];

/** Las acciones del historial. */
export const ACCIONES = ["reparar", "partir", "esperar", "escalar"];

/** Iguales a reglas-trabajador.ts del CRM. */
export const TOPE_DE_REPARACIONES = 3;
export const TOPE_DE_ESPERAS_SEGUIDAS = 5;
export const MAXIMO_DE_PARTES = 4;
export const MINIMO_DE_PARTES = 2;

const LARGO_DEL_ERROR = 6000;
const LARGO_DE_LA_CAUSA = 200;

/** Lo que dice `claude -p` cuando la suscripción llegó a su límite de uso ("Claude AI usage limit reached|…", "You've hit your session limit · resets 1:20am": 23-10-2026 este no lo reconocía y marcó 3 tarjetas en ERROR). */
const LIMITE_DE_USO = /usage limit|limit reached|hit your (?:\w+ )?limit|session limit|weekly limit|limit · resets|rate[ _-]?limit|overloaded_error|out of (extra )?usage|límite de uso/i;

/**
 * El modelo pedido no existe para esta cuenta o no está disponible por ahora: se trata como un límite de uso
 * (se espera y se reintenta, sin contar intento) y NUNCA se cambia a otro modelo más fuerte.
 */
// Solo las frases del aviso de la CLI (no "Model User not found" de un build ni "models/x does not exist" de un test).
const MODELO_NO_DISPONIBLE = /issue with the selected model|\bmodel\b[^\n]{0,60}\b(?:is not available|is currently unavailable|is temporarily unavailable)\b|\bmodelo\b[^\n]{0,40}\bno (?:est[aá] )?disponible/i;

export function esLimiteDeUso(texto) {
  return LIMITE_DE_USO.test(String(texto ?? "")) || MODELO_NO_DISPONIBLE.test(String(texto ?? ""));
}

/** Un texto recortado a `n` caracteres (con "…" si se cortó). */
export function recortar(texto, n) {
  const limpio = String(texto ?? "");
  return limpio.length > n ? `${limpio.slice(0, Math.max(0, n - 1))}…` : limpio;
}

/** El texto en UNA línea (sin saltos ni espacios de más) y de máximo `n` caracteres. */
export function enUnaLinea(texto, n = LARGO_DE_LA_CAUSA) {
  return recortar(
    String(texto ?? "")
      .replace(/\s+/g, " ")
      .trim(),
    n,
  );
}

/** El error como texto: un Error (su mensaje), un texto o nada. */
function textoDelError(error) {
  if (error === null || error === undefined) return "";
  if (typeof error === "string") return error;
  return String(error.message ?? error);
}

/** La primera línea con algo escrito: el "motivo en palabras sencillas" que arma cada etapa. */
function titularDe(texto) {
  return (
    String(texto ?? "")
      .split(/\r?\n/)
      .map((linea) => linea.trim())
      .find(Boolean) ?? ""
  );
}

/*
  Las reglas, en orden: la primera que calza gana. Cada una mira un texto. Primero se prueban TODAS contra el
  titular (la primera línea del error: lo que la etapa dijo en palabras sencillas) y solo después contra el error
  completo y el log: así un "migration" perdido en la salida de una prueba no le gana a "Fallaron las pruebas".
*/
/** Lo que dice una sesión atascada: el aviso de Claude al cortar tareas en segundo plano, o el del vigilante. */
const SESION_ATASCADA = /se cortaron tareas en segundo plano|tareas? en segundo plano|background (?:tasks?|agents?|shells?)|sesi[oó]n atascada|se qued[oó] quieta|subagentes? en segundo plano/i;

/**
 * Líneas que no son la causa de nada: el aviso de Claude Code de "carpeta sin confianza / permisos ignorados"
 * (23-24-oct-2026 salía en cada sesión y se tomó por la falla). Se quitan antes de diagnosticar.
 */
const RUIDO = /(?:trust(?:ed)?|confianza)[^\n]*(?:settings|permission|permiso)|(?:settings|permission|permiso)[^\n]*(?:ignored|ignorad|not trusted|no (?:es|est[aá]) de confianza)/i;

/** El texto sin las líneas de ruido conocidas. */
export function sinRuido(texto) {
  return String(texto ?? "")
    .split(/\r?\n/)
    .filter((linea) => !RUIDO.test(linea))
    .join("\n");
}

const REGLAS = [
  // Recursos y carpetas: la falla no es de la tarea.
  ["carpeta_trabada", /\.next[\\/]+lock|another next build|next build process|el build est[aá] ocupado|build (?:is )?(?:already )?(?:busy|locked)|unable to acquire lock|index\.lock|EBUSY|EPERM[^\n]*(?:\.next|worktree|unlink|rmdir)|is already checked out|already registered worktree|not a working tree|not a git repository|worktree[^\n]*(?:roto|locked|bloquead)|Directory not empty|ENOTEMPTY/i],
  ["pc_sobrecargado", /ENOMEM|out of memory|heap out of memory|JavaScript heap|allocation failed|PC (?:saturado|sobrecargado|lleno)|con el PC saturado/i],
  // Una sesión que lanzó tareas en segundo plano y se quedó esperándolas, o que el vigilante cortó por quieta.
  ["sesion_atascada", SESION_ATASCADA],
  // Lo que el trabajador no controla.
  ["coordinador_cortado", /venció en el CRM|se canceló|coordinador[^\n]*cortad|la sesión se cayó|se cortó el coordinador|ECONNRESET/i],
  // Las que la etapa nombra con palabras sencillas.
  ["no_cambio_nada", /no cambió ningún archivo|NO_CAMBIE/i],
  ["tarea_muy_grande", /context (?:window|length|limit)|prompt is too long|too many files|demasiados archivos|l[ií]mite del contexto|tarea (?:es )?muy grande|exceeds? the (?:maximum )?context/i],
  ["migracion", /ensayo de la migraci[oó]n|migration[^\n]*(?:failed|error)|migraci[oó]n[^\n]*(?:fall|error)|PGlite|prisma migrate|\bP3\d{3}\b|MIGRATION_FAILED/i],
  ["choca_con_main", /conflicto en el rebase|choca con lo nuevo|\bCONFLICT\b|rebase[^\n]*(?:chocó|fall|conflict)|non-fast-forward|cambió mientras tanto|fetch first|\[rejected\]|failed to push/i],
  ["tiempo_agotado", /tardó más de \d+(?:[.,]\d+)? ?min|se pasó del tiempo|tiempo de (?:construir|escribir el plan|subir)|timed? ?out|se cortó\b|ETIMEDOUT/i],
  ["lint", /El lint (?:tiene|no devolvió)|error\(es\) nuevo\(s\)|\beslint\b|\blint\b[^\n]*error/i],
  ["no_compila", /No compiló|error TS\d+|Type error|Failed to compile|Build failed|build error|Module not found|Cannot find module|SyntaxError|prisma validate|schema\.prisma[^\n]*error|esquema de la base|npm ERR! (?:code|missing)/i],
  ["fallan_pruebas", /Fallaron las pruebas|\d+ (?:tests? |pruebas )?(?:failed|fallaron)|AssertionError|\bnot ok \d+|assertion failed|✖|FAIL /i],
];

/** Qué dice cada categoría, para la causa (una línea) cuando el error no trae algo mejor. */
const CAUSA_BASE = {
  limite_claude: "Claude llegó al límite de uso de su plan",
  pc_sobrecargado: "El PC estaba saturado (CPU o memoria) y el comando no alcanzó a terminar",
  tiempo_agotado: "Una etapa se pasó del tiempo máximo",
  no_compila: "El código no compila",
  fallan_pruebas: "Fallaron las pruebas que ya existían",
  lint: "El lint encontró errores nuevos",
  choca_con_main: "El cambio choca con lo nuevo de main",
  migracion: "El ensayo de la migración de la base falló",
  no_cambio_nada: "Claude terminó sin cambiar ningún archivo",
  carpeta_trabada: "La carpeta de trabajo quedó trabada (.next/lock o el build ocupado)",
  tarea_muy_grande: "La tarea es demasiado grande para una sola sesión",
  coordinador_cortado: "El Coordinador se cortó mientras trabajaba (se reinició o se canceló)",
  sesion_atascada: "La sesión de Claude se quedó esperando tareas en segundo plano y no avanzó (sesión atascada)",
  otra: "No se reconoció la causa",
};

/** Las dos primeras reglas (el PC y la carpeta) mandan sobre el titular: un "No compiló" puede ser un .next/lock. */
const DEL_ENTORNO = REGLAS.slice(0, 2);

function categoriaPorReglas(texto, reglas = REGLAS) {
  for (const [categoria, regla] of reglas) if (regla.test(texto)) return categoria;
  return null;
}

const CON_DETALLE = ["no_compila", "fallan_pruebas", "lint", "migracion"];

/** La primera línea del texto que cuenta una falla concreta (un error de TypeScript, un "not ok"...), sin los encabezados que arma el Coordinador. */
function lineaClave(texto) {
  return (
    String(texto ?? "")
      .split(/\r?\n/)
      .map((linea) => linea.trim())
      .find(
        (linea) =>
          /error TS\d+|\bnot ok\b|AssertionError|\bFAIL\b|✖|Type error|Module not found|Cannot find module|SyntaxError|\bError:/i.test(linea) &&
          !/^(?:Detalle técnico|Líneas que fallaron|Últimas \d+ líneas|Salida completa)/i.test(linea),
      ) ?? ""
  );
}

/**
 * Una línea con la causa: lo que la etapa dijo (su titular) si dice algo útil; si no, la frase de la categoría.
 * `no_cambio_nada` agrega el motivo que Claude escribió en "NO_CAMBIE: <motivo>".
 */
function causaDe(categoria, titular, texto) {
  if (categoria === "no_cambio_nada") {
    const motivo = String(texto).match(/NO_CAMBIE:\s*([^\n]+)/i)?.[1];
    return enUnaLinea(motivo ? `${CAUSA_BASE.no_cambio_nada}: ${motivo}` : CAUSA_BASE.no_cambio_nada);
  }
  if (categoria === "otra") return enUnaLinea(titular || CAUSA_BASE.otra);
  // El titular de una sesión cortada por Claude no dice nada útil ("Claude falló al construir (código 1)"): se dice la causa.
  if (categoria === "sesion_atascada" && !/atascada|quieta/i.test(titular)) return enUnaLinea(CAUSA_BASE.sesion_atascada);
  if (!titular) return enUnaLinea(CAUSA_BASE[categoria]);
  // Compilación, pruebas, lint y migración: el titular es genérico ("No pasó la verificación"); la causa útil es
  // la primera línea que de verdad falló ("error TS2322...", "not ok 300 - ...").
  const clave = CON_DETALLE.includes(categoria) ? lineaClave(texto) : "";
  if (clave) return enUnaLinea(`${CAUSA_BASE[categoria]}: ${clave}`);
  // Si el titular ya explica la causa, se deja; se le pone delante la frase de la categoría solo si es muy corto.
  const base = CAUSA_BASE[categoria];
  const sinPunto = titular.replace(/[.:]\s*$/, "");
  return enUnaLinea(sinPunto.length >= 25 ? sinPunto : `${base} (${sinPunto})`);
}

/**
 * Diagnostica una falla.
 *   error      el ErrorDeEtapa / Error / texto que lanzó la etapa. Si trae `categoria` (la etapa ya lo sabe),
 *              esa manda; `limiteDeUso` es limite_claude.
 *   etapa      "planear" | "construir" | "subir"
 *   textoLog   lo que escribió la sesión mientras corría (opcional): sirve cuando el mensaje no alcanza.
 *   tarjeta    (opcional) no cambia las reglas hoy; queda para reglas por tarjeta.
 *   recursos   (opcional) { cpu, memoria, limites }: si un comando se pasó de tiempo con el PC saturado.
 * -> { categoria, causa (UNA línea, <= 200), error (recortado a 6000) }
 */
export function diagnosticar({ error, etapa, textoLog = "", tarjeta = null, recursos = null } = {}) {
  void etapa;
  void tarjeta;
  const texto = sinRuido(textoDelError(error));
  const titular = titularDe(texto);
  const completo = `${texto}\n${sinRuido(textoLog)}`;
  const resultado = (categoria, causa) => ({ categoria, causa: enUnaLinea(causa), error: recortar(texto || sinRuido(textoLog), LARGO_DEL_ERROR) });

  // 1. La etapa ya sabe la causa.
  if (error && typeof error === "object") {
    if (error.limiteDeUso) return resultado("limite_claude", causaDe("limite_claude", titular, texto));
    if (CATEGORIAS.includes(error.categoria)) {
      // Una categoría "blanda" (compila, pruebas, lint, otra) no le gana a una carpeta trabada o a un PC sin memoria que se ve en el texto.
      const blanda = ["no_compila", "fallan_pruebas", "lint", "otra"].includes(error.categoria);
      const delEntorno = blanda ? categoriaPorReglas(completo, DEL_ENTORNO) : null;
      const categoria = delEntorno ?? error.categoria;
      return resultado(categoria, causaDe(categoria, titular, completo));
    }
  }

  // 2. El límite de uso (Claude o Codex) solo se mira donde lo dice un motor, no en la salida de una prueba.
  if (/^(?:Claude|Codex) (?:falló|llegó|no contestó)/i.test(titular) && (esLimiteDeUso(texto) || esLimiteDeCodex(texto))) {
    return resultado("limite_claude", causaDe("limite_claude", titular, texto));
  }

  // 3. Un comando pasado de tiempo con el PC saturado: es el PC, no la tarea.
  if (recursos && /se pasó del tiempo|tardó más de/i.test(titular)) {
    const { cpu = 0, memoria = 0, limites = {} } = recursos;
    if (cpu > (limites.cpuPorciento ?? 85) || memoria > (limites.memoriaPorciento ?? 85)) {
      return resultado("pc_sobrecargado", `${titular.replace(/[.:]\s*$/, "")} con el PC saturado (CPU ${cpu} %, memoria ${memoria} %)`);
    }
  }

  // 4. Las reglas: primero las del entorno (PC, carpeta trabada) en todo el texto, después el titular y al final todo el texto.
  const delEntorno = categoriaPorReglas(completo, DEL_ENTORNO);
  if (delEntorno) return resultado(delEntorno, causaDe(delEntorno, titular, completo));
  const porTitular = categoriaPorReglas(titular);
  if (porTitular) return resultado(porTitular, causaDe(porTitular, titular, completo));
  const porTexto = categoriaPorReglas(completo);
  if (porTexto) return resultado(porTexto, causaDe(porTexto, titular, completo));

  return resultado("otra", causaDe("otra", titular, completo));
}

/** ¿Lo que se intentó antes (los últimos intentos de la tarjeta) ya tiene `categoria` N veces seguidas contando reparaciones? */
function reparacionesSeguidasCon(intentos, categoria) {
  let n = 0;
  for (const intento of [...(intentos ?? [])].reverse()) {
    if (intento.accion !== "reparar") continue;
    if (intento.categoria !== categoria) break;
    n += 1;
  }
  return n;
}

/**
 * Qué hacer con la falla. Devuelve { accion, cuenta, estrategia?, motivo }.
 *   accion      "reparar" | "partir" | "esperar" | "escalar"
 *   cuenta      si cuenta como una de las 3 reparaciones (reparar y escalar sí; esperar y partir no)
 *   estrategia  "opus" cuando la 2ª reparación seguida con la misma categoría cambia de modelo
 *   arreglo     "sin_claude": el Coordinador lo arregla solo (cierra procesos, limpia la carpeta, espera al PC)
 *   motivo      por qué, para el log
 *
 * Entradas: { diagnostico, tarjeta, etapa, config, archivosCambiados, reversion, modeloConstruir }
 *   tarjeta: reparaciones, topeReparaciones, esperasSeguidas, esParte, ultimosIntentos (como llegan de /tomar)
 *   archivosCambiados: cuántos archivos llevaba cambiados el intento que falló (o undefined)
 *   reversion: la etapa subió a main y tuvo que revertir -> siempre escala
 */
export function decidir({ diagnostico, tarjeta = {}, etapa, config = {}, archivosCambiados, reversion = null, modeloConstruir = null } = {}) {
  const categoria = diagnostico?.categoria ?? "otra";
  const reparaciones = Number(tarjeta.reparaciones) || 0;
  const tope = Number(tarjeta.topeReparaciones) || TOPE_DE_REPARACIONES;
  const esperasSeguidas = Number(tarjeta.esperasSeguidas) || 0;
  const intentos = tarjeta.ultimosIntentos ?? [];
  const esParte = tarjeta.esParte === true;
  const minimoDeArchivos = config.partir?.archivosMinimos ?? 8;

  if (reversion) return { accion: "escalar", cuenta: true, motivo: "falló después de subir a main y se revirtió: lo ve el dueño" };

  if (categoria === "limite_claude") return { accion: "esperar", cuenta: false, motivo: "límite de uso de Claude: se espera su reinicio" };
  // Con tope (como el PC y la carpeta): una tarjeta que corta al Coordinador cada vez no puede esperar para siempre; pasado el tope cuenta como reparación.
  if (categoria === "coordinador_cortado" && esperasSeguidas < TOPE_DE_ESPERAS_SEGUIDAS) return { accion: "esperar", cuenta: false, motivo: "el Coordinador se cortó: se vuelve a tomar" };

  if (categoria === "pc_sobrecargado" || categoria === "carpeta_trabada") {
    if (esperasSeguidas < TOPE_DE_ESPERAS_SEGUIDAS) {
      return { accion: "esperar", cuenta: false, arreglo: "sin_claude", motivo: `${categoria}: el Coordinador lo arregla sin Claude (${esperasSeguidas + 1}ª espera seguida de ${TOPE_DE_ESPERAS_SEGUIDAS})` };
    }
    // Ya esperó demasiado: cuenta como una reparación (y si ya no quedan, escala).
    return reparaciones < tope
      ? { accion: "reparar", cuenta: true, motivo: `${categoria} ${TOPE_DE_ESPERAS_SEGUIDAS} veces seguidas: cuenta como reparación` }
      : { accion: "escalar", cuenta: true, motivo: `${categoria} ${TOPE_DE_ESPERAS_SEGUIDAS} veces seguidas y ya no quedan reparaciones` };
  }

  const puedePartir = etapa === "construir" && !esParte;
  const sesionesPasadas = intentos.filter((intento) => intento.categoria === "tiempo_agotado").length;
  if ((categoria === "tiempo_agotado" || categoria === "tarea_muy_grande") && puedePartir) {
    const muchoTrabajo = Number(archivosCambiados) >= minimoDeArchivos;
    if (categoria === "tarea_muy_grande" || muchoTrabajo || sesionesPasadas >= 1) {
      return {
        accion: "partir",
        cuenta: false,
        motivo: categoria === "tarea_muy_grande" ? "la tarea es muy grande" : muchoTrabajo ? `ya llevaba ${archivosCambiados} archivos cambiados` : "es la 2ª vez que se pasa del tiempo",
      };
    }
  }

  // Sesión atascada: la 1ª vez se repara (el siguiente intento recibe la orden de no esperar nada); si se vuelve a atascar, la tarea se parte.
  if (categoria === "sesion_atascada" && puedePartir && intentos.some((intento) => intento.categoria === "sesion_atascada")) {
    return { accion: "partir", cuenta: false, motivo: "la sesión se atascó otra vez: se parte la tarea" };
  }

  if (reparaciones >= tope) return { accion: "escalar", cuenta: true, motivo: `ya se hicieron ${reparaciones} reparaciones` };

  // La 2ª reparación seguida con la misma categoría cambia de estrategia: modelo más fuerte o partir.
  if (reparacionesSeguidasCon(intentos, categoria) >= 2) {
    const yaEsOpus = /opus/i.test(String(modeloConstruir ?? ""));
    if (etapa === "construir" && !esParte && yaEsOpus) return { accion: "partir", cuenta: false, motivo: `${categoria} otra vez y Opus ya lo intentó: se parte` };
    if (etapa === "construir" && !yaEsOpus) return { accion: "reparar", cuenta: true, estrategia: "opus", motivo: `${categoria} otra vez: se repara con un modelo más fuerte (Opus)` };
  }
  return { accion: "reparar", cuenta: true, motivo: `${categoria}: se repara (${reparaciones + 1} de ${tope})` };
}

/** Una frase de qué necesita el dueño, según la causa. */
const NECESITA = {
  limite_claude: "Esperar a que Claude vuelva a tener cupo y tocar Reintentar.",
  pc_sobrecargado: "Revisar que el PC aizen1 no esté saturado (cerrar programas) y tocar Reintentar.",
  tiempo_agotado: "Mirar si la tarea se puede dividir en tareas más chicas, o tocar Reintentar.",
  no_compila: "Que alguien mire el error de compilación de abajo (Detalles técnicos).",
  fallan_pruebas: "Que alguien mire qué prueba falla (Detalles técnicos) o cambiar lo que pide la tarea.",
  lint: "Que alguien mire los errores de lint nuevos (Detalles técnicos).",
  choca_con_main: "Tocar Reintentar para construir otra vez sobre lo último de main, o revisar qué más cambió.",
  migracion: "Que alguien revise la migración de la base (Detalles técnicos) antes de reintentar.",
  no_cambio_nada: "Decir con más claridad qué hay que cambiar, o confirmar que ya está hecho (Marcar hecho a mano).",
  carpeta_trabada: "Revisar el PC aizen1 (carpeta de trabajo trabada) y tocar Reintentar.",
  tarea_muy_grande: "Dividir la tarea en tarjetas más chicas.",
  coordinador_cortado: "Revisar que el Coordinador esté encendido en aizen1 y tocar Reintentar.",
  sesion_atascada: "Tocar Reintentar; si se vuelve a atascar, dividir la tarea en partes más chicas.",
  otra: "Que alguien mire los Detalles técnicos y diga qué hacer.",
};

/**
 * El resumen para el dueño, de MÁXIMO 3 líneas sencillas (qué falló / qué se probó / qué necesita).
 *   { tarjeta, intentos, diagnostico }  `intentos`: los de la tarjeta (más viejo a más nuevo), si se tienen.
 */
export function resumenDeEscalada({ tarjeta = {}, intentos, diagnostico } = {}) {
  const lista = intentos ?? tarjeta.ultimosIntentos ?? [];
  const categoria = diagnostico?.categoria ?? "otra";
  const queFallo = `Qué falló: ${enUnaLinea(diagnostico?.causa || CAUSA_BASE[categoria], 220)}`;
  const reparaciones = lista.filter((intento) => intento.accion === "reparar").length || Number(tarjeta.reparaciones) || 0;
  const partidas = lista.filter((intento) => intento.accion === "partir").length;
  const esperas = lista.filter((intento) => intento.accion === "esperar").length;
  const hecho = [];
  if (reparaciones) hecho.push(reparaciones === 1 ? "1 reparación automática" : `${reparaciones} reparaciones automáticas`);
  if (partidas) hecho.push("dividir la tarea");
  if (esperas) hecho.push(`esperar ${esperas} vez${esperas === 1 ? "" : "es"}`);
  const causas = [...new Set(lista.filter((intento) => intento.accion === "reparar").map((intento) => intento.categoria))].filter(Boolean);
  const queSeProbo = `Qué se probó: ${hecho.length ? `${hecho.join(", ")}${causas.length ? ` (causas: ${causas.join(", ")})` : ""}` : "nada todavía, no había forma segura de repararlo solo"}.`;
  const necesita = `Qué necesita de ti: ${NECESITA[categoria] ?? NECESITA.otra}`;
  return [queFallo.replace(/\.?$/, "."), enUnaLinea(queSeProbo, 240), enUnaLinea(necesita, 240)].join("\n");
}
