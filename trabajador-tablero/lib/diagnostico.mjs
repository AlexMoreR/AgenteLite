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
  // 29-oct-2026: la sesión de la nube no dejó el commit "resultado:" (o no dio señal) / dejó un commit "pregunta:".
  "nube_sin_resultado",
  "nube_pregunta",
  // 29-oct-2026: el plan aprobado tiene preguntas abiertas (preguntas-abiertas.mjs): no se construye.
  "plan_con_preguntas",
  // 29-oct-2026: los 4 revisores (revisores.mjs) siguieron pidiendo cambios tras 2 vueltas de corrección.
  "revision_no_paso",
  // 29-oct-2026: la sesión de la nube iba a quedar sin el repo conectado (claude --cloud subió una copia sin remoto) o la
  // sesión fija del proyecto no responde: no puede subir su rama. No se repara sola.
  "nube_sin_acceso_repo",
  "otra",
];

/**
 * Las categorías que NO se reparan solas (29-oct-2026, 62 % del uso semanal se fue en reintentos ciegos): van directo al
 * dueño con el link y la línea de qué necesita. Repetirlas no cambia nada hasta que alguien encuentre la causa.
 */
export const SIN_REPARACION_AUTOMATICA = ["nube_sin_resultado", "nube_pregunta", "plan_con_preguntas", "revision_no_paso", "nube_sin_acceso_repo"];

/** Las que no son de la tarea (ya tienen su tope de esperas): no cuentan para "la misma causa 2 veces". */
const AJENAS_A_LA_TAREA = ["limite_claude", "pc_sobrecargado", "carpeta_trabada", "coordinador_cortado"];

/** Con cuántas fallas previas de la MISMA categoría (en los intentos de la tarjeta) ya no se repara: se escala. */
export const TOPE_DE_FALLAS_IGUALES = 2;

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
  // La nube preguntó (commit "pregunta:") o no dejó el commit "resultado:" / no dio señal (nube.mjs: esperarResultado).
  ["nube_sin_acceso_repo", /la nube no tiene acceso al repo|la sesi[oó]n fija de [^\n]* no responde/i],
  ["nube_pregunta", /sesi[oó]n de la nube hizo una pregunta/i],
  ["nube_sin_resultado", /sesi[oó]n de la nube no (?:dej[oó] el commit|dio se[nñ]al)/i],
  ["plan_con_preguntas", /el plan tiene preguntas abiertas/i],
  ["revision_no_paso", /la revisi[oó]n no pas[oó]/i],
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
  nube_sin_resultado: "La sesión de la nube no dejó su resultado (ni dio señal a tiempo)",
  nube_pregunta: "La sesión de la nube hizo una pregunta y paró",
  plan_con_preguntas: "El plan tiene preguntas abiertas",
  revision_no_paso: "Los revisores siguieron pidiendo cambios tras 2 vueltas de corrección",
  nube_sin_acceso_repo: "La nube no tiene acceso al repo",
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

const LINK_DE_LA_NUBE = /https:\/\/claude\.ai\/code\/session_[A-Za-z0-9_-]+/;

/** La causa en una línea de máximo 200 que termina con el link de la sesión de la nube (si el texto trae uno). */
function conElLink(frase, texto) {
  const link = String(texto ?? "").match(LINK_DE_LA_NUBE)?.[0];
  const sinLink = String(frase).replace(LINK_DE_LA_NUBE, "").replace(/\s*M[ií]rala:\s*$/i, "").replace(/\s+/g, " ").trim();
  if (!link) return enUnaLinea(sinLink);
  return `${enUnaLinea(sinLink.replace(/[.:\s]+$/, ""), LARGO_DE_LA_CAUSA - link.length - 3)} — ${link}`;
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
  // La nube y el plan con preguntas: el link de la sesión no se corta nunca (es lo que el dueño abre para ver dónde se quedó).
  if (SIN_REPARACION_AUTOMATICA.includes(categoria)) return conElLink(titular || CAUSA_BASE[categoria], texto);
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

/** La marca que `reparar` deja en la causa cuando cambia de estrategia: "[estrategia: opus]". */
const MARCA_DE_ESTRATEGIA = /\s*\[estrategia: (opus|partir|nube)\]\s*$/;

/** La causa sin la marca de estrategia. */
export function causaSinMarca(causa) {
  return String(causa ?? "").replace(MARCA_DE_ESTRATEGIA, "");
}

/** La estrategia que quedó marcada en la causa de un intento ("opus" | "partir" | "nube" | null). */
export function estrategiaDeLaCausa(causa) {
  return String(causa ?? "").match(MARCA_DE_ESTRATEGIA)?.[1] ?? null;
}

/**
 * La causa para comparar "¿es la misma?": sin la marca de estrategia, sin números (una línea, un tiempo, un conteo
 * cambian de un intento a otro) ni mayúsculas, signos o espacios de más.
 */
export function causaNormalizada(causa) {
  return causaSinMarca(causa)
    .toLowerCase()
    .replace(/\d+/g, "")
    .replace(/[^\p{L}]+/gu, " ")
    .trim();
}

/** ¿Dos causas son la misma? Una causa vacía no se puede comparar: nunca cuenta como igual. */
export function esLaMismaCausa(a, b) {
  const x = causaNormalizada(a);
  return x !== "" && x === causaNormalizada(b);
}

/** El último intento que fue una acción de la tarea (las esperas por límite, PC o carpeta no cuentan). */
function ultimoIntentoReal(intentos) {
  return [...(intentos ?? [])].reverse().find((intento) => intento && intento.accion !== "esperar") ?? null;
}

/** Una causa que nunca queda vacía: si no se sabe, lo dice con la etapa y el intento. */
export function causaSegura(causa, { etapa, intento } = {}) {
  const limpia = enUnaLinea(causa);
  return limpia || `El Coordinador no supo la causa (etapa ${etapa || "?"}, intento ${intento ?? "?"})`;
}

/** Un motivo que nunca queda vacío. */
export function motivoSeguro(motivo, { etapa, intento } = {}) {
  const limpio = String(motivo ?? "").trim();
  return limpio || `El Coordinador no mandó motivo (etapa ${etapa || "?"}, intento ${intento ?? "?"})`;
}

const FRASE_DE_ESTRATEGIA = {
  opus: "se construye con un modelo más fuerte (Opus)",
  partir: "la tarea se divide en partes más chicas",
  nube: "lo que verificó la nube cambió: se construye y se vuelve a verificar en la nube",
};

/**
 * Qué cambia en este intento frente al anterior, en UNA frase. Sale de lo guardado en los intentos:
 *   ultimo     el intento de reparación que mandó la tarjeta a la fila (su causa puede traer la marca de estrategia)
 *   anterior   el intento de antes de ese (o null)
 */
export function queCambiaEntre(ultimo, anterior) {
  if (!ultimo) return "Primer intento: no hay un intento anterior con qué comparar.";
  const estrategia = estrategiaDeLaCausa(ultimo.causa);
  if (estrategia && FRASE_DE_ESTRATEGIA[estrategia]) return `${FRASE_DE_ESTRATEGIA[estrategia][0].toUpperCase()}${FRASE_DE_ESTRATEGIA[estrategia].slice(1)}.`;
  if (!anterior) return "Es la primera reparación: se corrige solo lo que falló, con el error exacto a la vista.";
  if (anterior.categoria !== ultimo.categoria) return `La falla es de otro tipo que la anterior (antes: ${anterior.categoria || "otra"}, ahora: ${ultimo.categoria || "otra"}).`;
  if (!esLaMismaCausa(anterior.causa, ultimo.causa)) return `La causa es distinta a la del intento anterior (antes: ${enUnaLinea(causaSinMarca(anterior.causa), 120)}).`;
  return "Nada distinto frente al intento anterior: la misma causa; piensa otra forma de resolverla.";
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
 *   causa       (30-oct-2026) la causa en una frase, nunca vacía
 *   queCambia   (30-oct-2026) qué cambia en el siguiente intento frente al anterior, en una frase
 *
 * Entradas: { diagnostico, tarjeta, etapa, config, archivosCambiados, reversion, modeloConstruir, verificarEnNube }
 *   tarjeta: reparaciones, topeReparaciones, esperasSeguidas, esParte, ultimosIntentos (como llegan de /tomar)
 *   archivosCambiados: cuántos archivos llevaba cambiados el intento que falló (o undefined)
 *   reversion: la etapa subió a main y tuvo que revertir -> siempre escala
 */
function decidirBase({ diagnostico, tarjeta = {}, etapa, config = {}, archivosCambiados, reversion = null, modeloConstruir = null, verificarEnNube = false } = {}) {
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

  // 29-oct-2026: la nube que no dejó resultado (o preguntó) y el plan con preguntas abiertas no se reparan solos.
  if (SIN_REPARACION_AUTOMATICA.includes(categoria)) {
    return { accion: "escalar", cuenta: true, motivo: `${categoria}: no se repara solo, lo ve el dueño (con el link)` };
  }
  // La MISMA causa ya falló TOPE_DE_FALLAS_IGUALES veces en la tarjeta (contando todos los intentos, no solo las
  // reparaciones): queda quieta en ERROR hasta que alguien encuentre la causa. Las ajenas a la tarea tienen su tope de esperas.
  if (!AJENAS_A_LA_TAREA.includes(categoria)) {
    const iguales = intentos.filter((intento) => intento?.categoria === categoria).length;
    if (iguales >= TOPE_DE_FALLAS_IGUALES) return { accion: "escalar", cuenta: true, motivo: `${categoria} ya falló ${iguales} veces en esta tarjeta: no se reintenta a ciegas` };
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

  // 30-oct-2026: la MISMA categoría con la MISMA causa que el último intento: solo se repara si hay algo distinto que probar
  // (un modelo más fuerte, partir la tarea, verificar otra vez en la nube). Si no, se escala en vez de repetir a ciegas.
  const ultimo = ultimoIntentoReal(intentos);
  if (ultimo && ultimo.categoria === categoria && esLaMismaCausa(ultimo.causa, diagnostico?.causa)) {
    const yaEsOpus = /opus/i.test(String(modeloConstruir ?? ""));
    const estrategiaPrevia = estrategiaDeLaCausa(ultimo.causa);
    if (etapa === "construir" && !yaEsOpus && estrategiaPrevia !== "opus") return { accion: "reparar", cuenta: true, estrategia: "opus", motivo: `${categoria} con la misma causa: se repara con un modelo más fuerte (Opus)` };
    if (etapa === "construir" && !esParte) return { accion: "partir", cuenta: false, motivo: `${categoria} con la misma causa y Opus ya lo intentó: se parte` };
    if (verificarEnNube && estrategiaPrevia !== "nube") return { accion: "reparar", cuenta: true, estrategia: "nube", motivo: `${categoria} con la misma causa: se verifica otra vez en la nube` };
    return { accion: "escalar", cuenta: true, motivo: "misma causa que el intento anterior, nada distinto que probar" };
  }

  // La 2ª reparación seguida con la misma categoría cambia de estrategia: modelo más fuerte o partir. (Desde el 29-oct, con 2
  // fallas iguales se escala arriba: el cambio de estrategia llega en la 2ª, no en la 3ª.)
  if (reparacionesSeguidasCon(intentos, categoria) >= 1) {
    const yaEsOpus = /opus/i.test(String(modeloConstruir ?? ""));
    if (etapa === "construir" && !esParte && yaEsOpus) return { accion: "partir", cuenta: false, motivo: `${categoria} otra vez y Opus ya lo intentó: se parte` };
    if (etapa === "construir" && !yaEsOpus) return { accion: "reparar", cuenta: true, estrategia: "opus", motivo: `${categoria} otra vez: se repara con un modelo más fuerte (Opus)` };
  }
  return { accion: "reparar", cuenta: true, motivo: `${categoria}: se repara (${reparaciones + 1} de ${tope})` };
}

/**
 * Qué hacer con la falla (ver decidirBase). Además de la acción, devuelve `causa` (una frase, nunca vacía) y `queCambia`
 * (qué cambia frente al intento anterior): son lo que el siguiente intento recibe como "CAUSA:" y "QUÉ CAMBIA:".
 */
export function decidir(entrada = {}) {
  const decision = decidirBase(entrada);
  const intentos = entrada.tarjeta?.ultimosIntentos ?? [];
  const causa = causaSegura(entrada.diagnostico?.causa, { etapa: entrada.etapa, intento: entrada.tarjeta?.intentos });
  const ultimo = ultimoIntentoReal(intentos);
  const categoria = entrada.diagnostico?.categoria ?? "otra";
  const mismaCausa = ultimo && ultimo.categoria === categoria && esLaMismaCausa(ultimo.causa, causa);
  let queCambia;
  if (decision.accion === "escalar") queCambia = "Nada: pasa al dueño.";
  else if (decision.estrategia && FRASE_DE_ESTRATEGIA[decision.estrategia]) queCambia = `${FRASE_DE_ESTRATEGIA[decision.estrategia][0].toUpperCase()}${FRASE_DE_ESTRATEGIA[decision.estrategia].slice(1)}.`;
  else if (decision.accion === "partir") queCambia = `${FRASE_DE_ESTRATEGIA.partir[0].toUpperCase()}${FRASE_DE_ESTRATEGIA.partir.slice(1)}.`;
  else if (decision.accion === "esperar") queCambia = "Nada: se espera a que se libere lo que faltaba y se reintenta.";
  else if (!ultimo) queCambia = "Primer intento de reparación: se corrige solo lo que falló, con el error exacto a la vista.";
  else if (ultimo.categoria !== categoria) queCambia = `La falla es de otro tipo que la anterior (antes: ${ultimo.categoria || "otra"}, ahora: ${categoria}).`;
  else if (!mismaCausa) queCambia = `La causa es distinta a la del intento anterior (antes: ${enUnaLinea(causaSinMarca(ultimo.causa), 120)}).`;
  else queCambia = "Nada distinto frente al intento anterior.";
  return { ...decision, causa, queCambia };
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
  nube_sin_resultado: "Abrir el link de la sesión de la nube, ver dónde se quedó y, con la causa clara, tocar Reintentar.",
  nube_pregunta: "Responder la pregunta (en el detalle de la tarjeta) y aprobar de nuevo la tarea para que se planee con la respuesta.",
  plan_con_preguntas: "Responder las preguntas del plan (en el detalle de la tarjeta) y aprobar de nuevo la tarea, o aprobar el plan tal cual.",
  revision_no_paso: "Leer qué pidió el revisor (en el detalle de la tarjeta): si tiene razón, aclarar el plan y aprobar de nuevo; si no, tocar Reintentar.",
  nube_sin_acceso_repo: "Revisar que la app de GitHub de Claude tenga acceso al repo (o abrir la sesión fija del proyecto en claude.ai y ver que siga viva) y tocar Reintentar.",
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

/** El CRM no acepta avisos al dueño de más de 500 caracteres (26-oct-2026: uno de 869 no salió). */
export const LARGO_MAXIMO_DEL_AVISO = 500;

/** Un aviso al dueño de máximo 3 líneas y LARGO_MAXIMO_DEL_AVISO caracteres (cada línea sin saltos ni espacios de más). */
export function recortarAviso(texto, n = LARGO_MAXIMO_DEL_AVISO, maxLineas = 3) {
  const lineas = String(texto ?? "")
    .split(/\r?\n/)
    .map((linea) => linea.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const primeras = lineas.slice(0, maxLineas - 1);
  const ultima = lineas.slice(maxLineas - 1).join(" ");
  return recortar([...primeras, ...(ultima ? [ultima] : [])].join("\n"), n);
}

/** La causa de una reversión en una línea: el "Detalle técnico" si lo hay (es lo que de verdad falló), si no la primera línea. */
function causaDeLaReversion(motivo) {
  const texto = String(motivo ?? "");
  const tecnico = texto.match(/Detalle técnico:\s*([^\n]+)/);
  const linea = tecnico?.[1] ?? texto.split(/\r?\n/).find((l) => l.trim()) ?? "";
  return linea.replace(/^Revertida:\s*/, "").trim();
}

/**
 * El aviso al dueño cuando una subida se deshizo (o no se pudo deshacer): 3 líneas y máximo 500 caracteres.
 * El detalle completo queda en el tablero (motivo de la tarjeta).
 */
export function textoDelAvisoDeReversion(titulo, motivo, reversion) {
  const corto = (sha) => String(sha ?? "").slice(0, 10);
  const nombre = enUnaLinea(titulo, 120);
  const [primera, ultima] = reversion?.ok
    ? [`Se deshizo una subida de "${nombre}".`, `Commit deshecho: ${corto(reversion.commit)}; commit de la reversión: ${corto(reversion.revert)}. Detalle en el tablero.`]
    : [`URGENTE: no se pudo deshacer una subida de "${nombre}", hay que revisar a mano.`, `Commit en producción: ${corto(reversion?.commit)}. Detalle en el tablero.`];
  const espacio = LARGO_MAXIMO_DEL_AVISO - primera.length - ultima.length - 2 - "Motivo: ".length;
  const causa = enUnaLinea(causaDeLaReversion(motivo), Math.max(40, espacio));
  return recortarAviso([primera, `Motivo: ${causa}`, ultima].join("\n"));
}
