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
import { esErrorDeSesion } from "./sesion-claude.mjs";

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
  // 30-oct-2026: una tarjeta de chats o del bot de ventas que no puede subir sola (p. ej. agrega un envío nuevo a clientes): ERROR
  // con el motivo. Repararla sola podría borrar el envío que se pidió.
  "zona",
  // 31-oct-2026: el rebase con main no tuvo conflicto de texto, pero lo nuevo de main y la tarea no encajan (la lógica
  // choca). No se repara sola: reconstruir otra vez no lo arregla, alguien tiene que decidir cómo juntarlos.
  "choque_de_logica",
  // 27-nov-2026: el plan nombra archivos de otro repo; el Coordinador le cambia el repo a la tarjeta (o la vuelve a planear) sin
  // construir ni gastar intento (acción "cambiar-repo" del CRM).
  "repo_equivocado",
  // 27-nov-2026 (incidente T-956): la sesión dijo DEPENDE_DE a una tarjeta HECHA a mano o FALLIDA cuyo código no está en main
  // (bucle.mjs: esperarPorDependencia). No se repara sola: hasta que alguien suba ese código, reintentar da la misma vuelta.
  "depende_de_sin_main",
  "otra",
];

/**
 * Las categorías que NO se reparan solas (29-oct-2026, 62 % del uso semanal se fue en reintentos ciegos): van directo al
 * dueño con el link y la línea de qué necesita. Repetirlas no cambia nada hasta que alguien encuentre la causa.
 */
export const SIN_REPARACION_AUTOMATICA = ["nube_pregunta", "plan_con_preguntas", "revision_no_paso", "nube_sin_acceso_repo", "zona", "choque_de_logica", "depende_de_sin_main"];

/**
 * 25-nov-2026 (parte 2 de «las 4 fallas repetidas»): la nube sin señal ya no va directo al dueño. Se repara con la estrategia
 * `sesion_nueva`: el intento siguiente abre SIEMPRE una sesión nueva de la nube (nunca la de un intento anterior, ni la sesión
 * fija del proyecto). Su causa sigue terminando con el link de la sesión: con él se sabe qué sesión no se puede volver a usar.
 */
const CON_EL_LINK = [...SIN_REPARACION_AUTOMATICA, "nube_sin_resultado"];

/**
 * Las que no son de la tarea (ya tienen su tope de esperas): no cuentan para "la misma causa 2 veces". El choque con main
 * (31-oct-2026) tampoco: es main que cambió mientras tanto, no la tarea; tiene su propio tope (TOPE_DE_CHOQUES_SEGUIDOS).
 */
const AJENAS_A_LA_TAREA = ["limite_claude", "pc_sobrecargado", "carpeta_trabada", "coordinador_cortado", "choca_con_main"];

/**
 * Con cuántas fallas previas de la MISMA categoría (en los intentos de la tarjeta) ya no se repara: se escala. 25-nov-2026
 * (parte 4): no aplica a las fallas repetidas (ESTRATEGIAS_DE_LAS_FALLAS), que usan el tope de 3 reparaciones del CRM.
 */
export const TOPE_DE_FALLAS_IGUALES = 2;

/**
 * LAS FALLAS REPETIDAS (25-nov-2026, parte 4 de «las 4 fallas repetidas»): la nube sin señal, Claude sin cambiar nada y las
 * pruebas que fallan ya no escalan a la 2.ª falla igual. Usan el tope de 3 reparaciones del CRM (puedeReparar) y cada
 * reparación prueba una estrategia DISTINTA, en este orden. Si la estrategia ya se probó con la misma causa (esLaMismaCausa),
 * no cuenta como distinta: se pasa a la siguiente. La 4.ª falla (tras 3 intentos distintos) escala UNA vez, `agotado`: queda
 * una sola alerta en /cliente/alertas, sin WhatsApp. "No arrancó" (la subida deshecha) ya tiene su tope de 3 en
 * TOPE_INTENTOS_DE_SUBIDA y su alerta única (categoría subida_revertida).
 */
export const ESTRATEGIAS_DE_LAS_FALLAS = {
  nube_sin_resultado: ["sesion_nueva", "opus", "plan_nuevo"],
  no_cambio_nada: ["plan_nuevo", "opus", "nube"],
  fallan_pruebas: ["arreglo", "opus", "nube"],
};

/**
 * La estrategia que toca para una falla repetida: la primera de su lista que no se probó ya con la misma causa (las reparaciones
 * anteriores de la tarjeta llevan su estrategia marcada en la causa). null si no es una falla repetida o ya no queda ninguna.
 */
export function estrategiaParaLaFalla(diagnostico, intentos) {
  const lista = ESTRATEGIAS_DE_LAS_FALLAS[diagnostico?.categoria];
  if (!lista) return null;
  const usadas = new Set(
    (intentos ?? [])
      .filter((intento) => intento?.accion === "reparar" && esLaMismaCausa(diagnostico, intento))
      .map((intento) => estrategiaDeLaCausa(intento.causa))
      .filter(Boolean),
  );
  return lista.find((estrategia) => !usadas.has(estrategia)) ?? null;
}

/** Las estrategias que ya probó la tarjeta con reparaciones de esta categoría (en orden, sin repetir): van al resumen del dueño. */
export function estrategiasProbadas(intentos, categoria) {
  const vistas = [];
  for (const intento of intentos ?? []) {
    if (intento?.accion !== "reparar" || intento.categoria !== categoria) continue;
    const estrategia = estrategiaDeLaCausa(intento.causa);
    if (estrategia && !vistas.includes(estrategia)) vistas.push(estrategia);
  }
  return vistas;
}

/** Las acciones del historial. */
export const ACCIONES = ["reparar", "partir", "esperar", "escalar"];

/** Iguales a reglas-trabajador.ts del CRM. */
export const TOPE_DE_REPARACIONES = 3;
export const TOPE_DE_ESPERAS_SEGUIDAS = 5;
/** Cuántos choques con main seguidos se reconstruyen sin gastar una reparación; el siguiente se escala. */
export const TOPE_DE_CHOQUES_SEGUIDOS = 3;
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

/**
 * ¿Lo que dijo Claude es que la sesión de aizen1 se venció ("OAuth session expired and could not be refreshed", "Not logged
 * in"…)? 24-nov-2026 (parte 2): no es culpa de la tarjeta; se suelta sin ERROR y el Coordinador entra en pausa. Las frases
 * son las mismas de sesion-claude.mjs (no se repite la lista).
 */
export function esErrorDeSesionClaude(texto) {
  return esErrorDeSesion(texto);
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
  zona: "El cambio de chats o del bot de ventas no puede subir solo",
  choque_de_logica: "Lo nuevo de main y el cambio de la tarea no encajan (choque de lógica)",
  repo_equivocado: "El plan nombra archivos de otro repo (repo equivocado)",
  depende_de_sin_main: "Depende de una tarjeta HECHA a mano o FALLIDA cuyo código no está en main",
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
  if (CON_EL_LINK.includes(categoria)) return conElLink(titular || CAUSA_BASE[categoria], texto);
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

/*
  No repetir a ciegas (30-oct-2026). Antes de reparar, el Coordinador arma { causa, queCambia }: la causa en una frase y
  qué cambia frente al intento anterior. Si la falla es IGUAL a la del último intento (misma categoría y misma causa) y no
  queda una estrategia distinta que probar (Opus, partir, verificar otra vez en la nube), no gasta otro intento igual:
  escala con el motivo MISMA_CAUSA. Las esperas (límite de Claude, PC, carpeta, Coordinador cortado) no cambian.
*/

export const MISMA_CAUSA = "misma causa que el intento anterior, nada distinto que probar";

/**
 * La marca que `reparar` deja en la causa cuando cambia de estrategia: "[estrategia: opus]". El CRM, al guardarla, le
 * agrega " (estrategia: opus)" y recorta a 200 letras (causaConEstrategia): en la base puede quedar
 * "X [estrategia: opus] (estrategia: opus)" o "X [estrategia: op (estrategia: opus)". Se reconocen todas.
 */
// "nube" (26-oct-2026): lo que verificó la nube cambió al subir; la reparación se vuelve a construir y verificar en la nube.
// "sesion_nueva" (25-nov-2026): la nube no dio señal; el intento siguiente abre una sesión nueva de la nube.
const MARCAS_DE_ESTRATEGIA = /\s*[[(]estrategia:[^\])]*(?:[\])]|$)/g;
const ESTRATEGIA_MARCADA = /[[(]estrategia: (opus|partir|nube|sesion_nueva|plan_nuevo|arreglo)\b/g;

/** La causa sin las marcas de estrategia. */
export function sinMarcaDeEstrategia(causa) {
  return String(causa ?? "").replace(MARCAS_DE_ESTRATEGIA, "").trim();
}

/** Lo que el CRM le pone al final a la causa al guardarla (causaConEstrategia de reglas-trabajador.ts) y su tope de letras. */
const COLA_DEL_CRM = (estrategia) => ` (estrategia: ${estrategia})`;

/**
 * La causa con la marca "[estrategia: X]" al final, para /reparar. Sin link: los 160 primeros caracteres, como siempre. Con el
 * link de la sesión de la nube (25-nov-2026): se acorta la frase y el link queda entero, para que ni la marca ni lo que agrega
 * el CRM lo corten (con ese link se sabe qué sesión no se vuelve a usar).
 */
export function causaConMarca(causa, estrategia) {
  if (!estrategia) return causa;
  const marca = ` [estrategia: ${estrategia}]`;
  const link = String(causa ?? "").match(LINK_DE_LA_NUBE)?.[0];
  if (!link) return `${enUnaLinea(causa, 160)}${marca}`;
  const espacio = LARGO_DE_LA_CAUSA - COLA_DEL_CRM(estrategia).length - marca.length - link.length - 3;
  const frase = sinMarcaDeEstrategia(String(causa).replace(LINK_DE_LA_NUBE, "")).replace(/[\s—.:]+$/, "");
  return `${enUnaLinea(frase, Math.max(20, espacio))} — ${link}${marca}`;
}

/** La estrategia que quedó marcada en la causa de un intento ("opus", "partir", "nube", "sesion_nueva"…) o null (la última si hay varias). */
export function estrategiaDeLaCausa(causa) {
  return [...String(causa ?? "").matchAll(ESTRATEGIA_MARCADA)].at(-1)?.[1] ?? null;
}

/**
 * La causa lista para comparar: sin la marca de estrategia, sin links, sin números (una línea o un tiempo distinto no
 * hace distinta la falla), en minúsculas y con espacios simples.
 */
export function causaParaComparar(causa) {
  return sinHashesNiFechas(sinMarcaDeEstrategia(causa).replace(/https?:\/\/\S+/g, ""))
    .replace(/\d+/g, "#")
    .toLowerCase()
    // 25-nov-2026: también el guion que separa la causa de su link ("… — https://…"), para que dos causas de la nube con link
    // distinto cuenten como la misma.
    .replace(/[\s.…:;,—–]+/g, " ")
    .trim();
}

/**
 * 27-nov-2026 (parte 3 de «si una reparación falla por el mismo motivo, no repetir igual»): los hashes de commit (7 a 40 letras
 * hexadecimales con al menos un número) y las fechas ("2026-11-27", "27/11/2026", "27-nov-2026", "27 de noviembre de 2026") no
 * hacen distinta una falla: dos fallas que solo cambian en un commit o una fecha cuentan como la misma.
 */
const HASH_DE_COMMIT = /\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b/gi;
const MESES = "ene(?:ro)?|feb(?:rero)?|mar(?:zo)?|abr(?:il)?|may(?:o)?|jun(?:io)?|jul(?:io)?|ago(?:sto)?|sep(?:tiembre)?|set(?:iembre)?|oct(?:ubre)?|nov(?:iembre)?|dic(?:iembre)?|jan|apr|aug|dec";
const FECHA = new RegExp(
  [
    "\\b\\d{4}-\\d{2}-\\d{2}(?:[T ]\\d{2}:\\d{2}(?::\\d{2}(?:\\.\\d+)?)?Z?)?\\b",
    "\\b\\d{1,2}[/.-]\\d{1,2}[/.-]\\d{2,4}\\b",
    `\\b\\d{1,2}(?:-|\\s+de\\s+|\\s+)(?:${MESES})\\.?(?:(?:-|\\s+de\\s+|\\s+)\\d{4})?\\b`,
  ].join("|"),
  "gi",
);

/** El texto sin hashes de commit ni fechas. */
export function sinHashesNiFechas(texto) {
  return (
    String(texto ?? "")
      .replace(FECHA, " ")
      .replace(HASH_DE_COMMIT, " ")
      // Lo que queda sin su dato ("(commit )", "del ]") tampoco hace distinta la falla.
      .replace(/\b(?:commits?|el|del)\s*(?=[)\]]|$)/gi, " ")
      .replace(/\(\s*\)|\[\s*\]/g, " ")
  );
}

/**
 * La causa en UNA frase, para el historial de la tarjeta y la bitácora: "categoría: causa", sin hashes de commit, fechas, links,
 * números (quedan como "N") ni la marca de estrategia. Con ella se ve de un vistazo si dos fallas son la misma.
 */
export function causaEnUnaFrase(diagnostico) {
  const categoria = diagnostico?.categoria || "otra";
  const limpia = sinHashesNiFechas(sinMarcaDeEstrategia(diagnostico?.causa).replace(/https?:\/\/\S+/g, " "))
    .replace(/\d+/g, "N")
    .replace(/\s+([.,;:])/g, "$1")
    .replace(/[\s—–:.,;]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
  return enUnaLinea(`${categoria}: ${limpia || CAUSA_BASE[categoria] || CAUSA_BASE.otra}`);
}

/**
 * ¿La causa es de una dependencia o de main, ajena al código? ("la parte 1 no está en main", "depende de «X»", DEPENDE_DE,
 * "parte 2 de 4 no está"). Repararla con otro modelo o partiéndola no cambia nada: hay que esperar a la otra tarjeta. No cuenta
 * la frase del propio Coordinador "no cambió nada y no está en main" (la estrategia plan_nuevo), que no es una dependencia.
 */
const DE_DEPENDENCIA = /no est[aá] (?:todav[ií]a |a[uú]n )?(?:subid[ao] )?en main|\bdepende(?:n)? de\b|\bDEPENDE_DE\b|\bparte \d+(?: de \d+)? (?:todav[ií]a |a[uú]n )?no est[aá]/i;
const FRASE_DEL_COORDINADOR = /no cambi[oó] nada y no est[aá] en main/gi;

export function esCausaDeDependencia(texto) {
  return DE_DEPENDENCIA.test(String(texto ?? "").replace(FRASE_DEL_COORDINADOR, " "));
}

/** El último intento que de verdad probó algo (no una espera): con él se compara la falla nueva. null si no hay. */
export function intentoAnterior(intentos) {
  return [...(intentos ?? [])].reverse().find((intento) => intento && intento.accion !== "esperar") ?? null;
}

/** Desde cuántas letras una causa recortada (la que guardó el CRM con la marca) cuenta como el principio de la otra. */
const LARGO_PARA_PREFIJO = 60;

/** ¿La falla (categoría y causa) es la misma del intento anterior? Una causa recortada al guardarla cuenta como la misma. */
export function esLaMismaCausa(diagnostico, anterior) {
  if (!anterior || !diagnostico || anterior.categoria !== diagnostico.categoria) return false;
  const ahora = causaParaComparar(diagnostico.causa);
  const antes = causaParaComparar(anterior.causa);
  if (!ahora || !antes) return false;
  if (ahora === antes) return true;
  const [corta, larga] = ahora.length < antes.length ? [ahora, antes] : [antes, ahora];
  return corta.length >= LARGO_PARA_PREFIJO && larga.startsWith(corta);
}

/*
  Causa externa (31-oct-2026, parte 3 de «si algo falla, encontrar la causa»). Cuando la falla NO es de la tarea (la vigilancia
  revirtió la subida, main ya trae lint o pruebas rotas, choca con otra tarjeta, el servidor / SSH / base no responde), no se
  gastan reparaciones en ella: el Coordinador pide UNA tarjeta pequeña que arregla esa causa (título fijo por causa y repo: tope de
  1 abierta por causa) y la original espera a esa con la flecha de dependencia, sin ERROR ni intento. Ante la duda: null (el camino
  de siempre). Puro: no toca disco ni red.
*/

/** El comienzo del título de cada tarjeta de causa: una tarjeta que ya es de causa nunca crea otra (no se forma una cadena). */
export const PREFIJOS_DE_CAUSA = { vigilancia: "Vigilancia:", main_roto: "Main roto:", servidor: "Servidor:" };

/**
 * El comienzo del título de la tarjeta que arregla una subida deshecha (24-nov-2026, parte 3). Va aparte de PREFIJOS_DE_CAUSA:
 * esa lista tiene que ser igual a PREFIJOS_DE_CAUSA_EXTERNA del CRM (lo exige probar-trabajador.mjs); es el mismo
 * PREFIJO_DE_ARREGLO_DE_SUBIDA de reglas-trabajador.ts.
 */
export const PREFIJO_DE_ARREGLO_DE_SUBIDA = "Arreglo de subida:";

/** Cuántas subidas deshechas aguanta una tarjeta (igual a TOPE_INTENTOS_DE_SUBIDA de reglas-trabajador.ts): con la 3.ª se escala. */
export const TOPE_INTENTOS_DE_SUBIDA = 3;

/** ¿La tarjeta ya es una tarjeta de causa? (su título empieza con "Vigilancia:", "Main roto:", "Servidor:" o "Arreglo de subida:") */
export function esTarjetaDeCausa(tarjeta) {
  const titulo = String(tarjeta?.titulo ?? "").trim();
  return [...Object.values(PREFIJOS_DE_CAUSA), PREFIJO_DE_ARREGLO_DE_SUBIDA].some((prefijo) => titulo.startsWith(prefijo));
}

/** Cuántas subidas deshechas lleva la tarjeta: sus intentos con categoría `subida_revertida` (como intentosDeSubida del CRM). */
export function intentosDeSubida(intentos) {
  return (intentos ?? []).filter((intento) => intento?.categoria === "subida_revertida").length;
}

/** ¿La deshizo la vigilancia de 30 min? (la 1.ª línea empieza con "Revertida:" o el texto lo dice). */
function esDeLaVigilancia(texto) {
  return /^\s*Revertida:/.test(texto) || /vigilancia de 30 min/i.test(texto);
}

/** Categorías del diagnóstico que dicen que el error es del código (aunque los logs no lo muestren). */
const ERROR_DE_CODIGO = ["no_compila", "fallan_pruebas", "lint", "migracion"];

/**
 * Qué se hace con una subida que se deshizo bien (reversion.ok), según su causa (24-nov-2026, parte 3). Pura.
 *   "arreglo": la clase es codigo o arranque, o no se supo pero hay un error de código (la vigilancia vio fallas nuevas, o el
 *              diagnóstico es de compilación o pruebas): se pide la tarjeta «Arreglo de subida: …» y después se reintenta esta.
 *   "esperar": la clase es pasajera o falsa (25-nov-2026: se deshizo antes de que el servidor bajara la imagen), o no se supo y no
 *              hay error de código: se suelta y se reintenta en la vuelta siguiente.
 */
export function queHacerConLaSubidaDeshecha(diagnostico, reversion) {
  const clase = reversion?.clase;
  if (clase === "codigo" || clase === "arranque") return "arreglo";
  // 25-nov-2026: reversión falsa (se deshizo antes de que el servidor bajara la imagen): se espera y se sube el mismo commit.
  if (clase === "pasajera" || clase === "falsa") return "esperar";
  const conErrorDeCodigo = esDeLaVigilancia(String(diagnostico?.error ?? "")) || ERROR_DE_CODIGO.includes(diagnostico?.categoria);
  return conErrorDeCodigo ? "arreglo" : "esperar";
}

/** Lo que dice el texto cuando lint o pruebas ya fallaban en main sin el cambio. */
const YA_FALLA_EN_MAIN = /ya fallaba[n]? en main|tambi[eé]n falla[n]? en main|main ya trae/i;
/** "choca con la tarjeta «X»": el nombre de la otra tarjeta. */
const CHOCA_CON_TARJETA = /choca con la tarjeta [«"]([^»"\n]{1,200})[»"]/i;
/** El servidor, el SSH o la base no responden (lo que dicen Node, Prisma y ssh). */
const SERVIDOR_CAIDO = /ECONNREFUSED|Can't reach database server|\bP1001\b|ssh: connect to host|ssh:[^\n]*Connection (?:refused|timed out)|No se pudieron leer los logs del servidor \(ssh\)/i;

/** Las líneas del texto que dicen la causa (para el detalle de la tarjeta de causa), máximo 8. */
function lineasDeLaCausa(texto, regla) {
  return String(texto ?? "")
    .split(/\r?\n/)
    .map((linea) => linea.trim())
    .filter((linea) => linea && regla.test(linea))
    .slice(0, 8)
    .map((linea) => `- ${recortar(linea, 300)}`);
}

/**
 * ¿La falla es de una causa externa a la tarea? -> { tipo, titulo, detalle, referencia? } o null (el camino de siempre).
 *   diagnostico  el de diagnosticar() ({ categoria, causa, error })
 *   reversion    { ok, commit, revert } si la etapa subió y se revirtió (o null)
 *   repo         la clave del repo de la tarjeta ("aizencrm", "gestion")
 *   tarjeta      la tarjeta que falló ({ titulo })
 * tipo: "subida" | "main_roto" | "choque" | "servidor". En "choque" no hay tarjeta nueva: `referencia` es la otra tarjeta. En
 * "subida" (una subida que se deshizo bien, por el código o el arranque) también trae `lineas` (las del log, una por línea).
 * null si la reversión no se pudo hacer (sigue siendo URGENTE), si la tarjeta ya es de causa o si la subida deshecha fue pasajera.
 */
export function causaExterna(diagnostico, { reversion = null, repo = "", tarjeta = null } = {}) {
  if (!diagnostico) return null;
  if (reversion && reversion.ok !== true) return null;
  if (esTarjetaDeCausa(tarjeta)) return null;
  const texto = String(diagnostico.error ?? "");
  const todo = `${diagnostico.causa ?? ""}\n${texto}`;
  const deLa = repo ? ` (${repo})` : "";
  const nombre = enUnaLinea(tarjeta?.titulo ?? "otra tarjeta", 120);

  // 24-nov-2026 (parte 3): una subida que se deshizo bien. Si es del código o del arranque (o la deshizo la vigilancia), se pide la
  // tarjeta «Arreglo de subida: …» (tipo "subida" del CRM, con su tope de 3); si es pasajera, null: el bucle la suelta sin arreglo.
  if (reversion?.ok) {
    if (queHacerConLaSubidaDeshecha(diagnostico, reversion) !== "arreglo") return null;
    const vigilancia = esDeLaVigilancia(texto);
    const delLog = (Array.isArray(reversion.lineas) ? reversion.lineas : []).map((linea) => String(linea ?? "").trim()).filter(Boolean);
    const lineas = (delLog.length ? delLog : texto.split(/\r?\n/).map((linea) => linea.trim()).filter((linea) => /\[minuto \d+\]|error|fall/i.test(linea))).slice(0, 8);
    const sencilla = enUnaLinea(causaDeLaReversion(texto, reversion) || diagnostico.causa, 300);
    // La causa corta del título: la primera línea del log que la muestra (sin la marca del minuto) o, si no hay, la frase sencilla.
    const corta = (lineas[0] ?? "").replace(/^.*?\[minuto \d+\]\s*/i, "").replace(/^Revertida:\s*/i, "").replace(/^\[?\d{4}-\d{2}-\d{2}[T ][\d:.,]+Z?\]?\s*/, "").trim() || sencilla.replace(/[.:\s]+$/, "");
    const espacio = 200 - PREFIJO_DE_ARREGLO_DE_SUBIDA.length - 1 - deLa.length;
    return {
      tipo: "subida",
      titulo: `${PREFIJO_DE_ARREGLO_DE_SUBIDA} ${enUnaLinea(corta, espacio)}${deLa}`,
      detalle: [`${vigilancia ? "La vigilancia de 30 min deshizo" : "Se deshizo"} la subida de «${nombre}»; producción volvió a la versión anterior. Causa: ${sencilla}`, `Arréglalo para que «${nombre}» se pueda volver a subir.`].join("\n"),
      lineas: lineas.map((linea) => recortar(linea, 300)).join("\n"),
    };
  }

  if (["lint", "fallan_pruebas"].includes(diagnostico.categoria) && YA_FALLA_EN_MAIN.test(todo)) {
    return {
      tipo: "main_roto",
      titulo: `${PREFIJOS_DE_CAUSA.main_roto} lint o pruebas fallan sin el cambio${deLa}`,
      detalle: [`Al verificar «${nombre}», ${diagnostico.categoria === "lint" ? "el lint" : "las pruebas"} ya fallaban en main sin el cambio. Arréglalo sin cambiar lo que hace el sistema. Causa: ${enUnaLinea(diagnostico.causa, 300)}`, ...lineasDeLaCausa(texto, /error|fail|not ok|✖/i)].join("\n"),
    };
  }

  const otra = todo.match(CHOCA_CON_TARJETA)?.[1]?.trim();
  if (otra && otra !== String(tarjeta?.titulo ?? "").trim()) {
    return { tipo: "choque", titulo: otra, referencia: otra, detalle: `«${nombre}» choca con la tarjeta «${otra}»: espera a que esa llegue a HECHO.` };
  }

  if (SERVIDOR_CAIDO.test(todo)) {
    return {
      tipo: "servidor",
      titulo: `${PREFIJOS_DE_CAUSA.servidor} el servidor, el SSH o la base no responde${deLa}`,
      detalle: [`Al trabajar «${nombre}», el servidor, el SSH o la base no respondieron. Revisa que estén arriba (si no tiene arreglo en código, dilo con NECESITO). Causa: ${enUnaLinea(diagnostico.causa, 300)}`, ...lineasDeLaCausa(texto, SERVIDOR_CAIDO)].join("\n"),
    };
  }
  return null;
}

/**
 * Las causas distintas que ya probó la tarjeta: sus intentos (sin las esperas) más la falla de ahora, sin repetir. Dos causas
 * son la misma si tienen la misma categoría y la misma causa (esLaMismaCausa, con causaParaComparar). Puro.
 * -> [{ categoria, causa }] (en el orden en que pasaron)
 */
export function causasDistintas(intentos, diagnostico) {
  const lista = [...(intentos ?? []).filter((intento) => intento && intento.accion !== "esperar"), ...(diagnostico ? [diagnostico] : [])];
  const distintas = [];
  for (const falla of lista) {
    const causa = { categoria: falla.categoria ?? "otra", causa: enUnaLinea(sinMarcaDeEstrategia(falla.causa), 120) };
    if (!distintas.some((ya) => ya.categoria === causa.categoria && (causaParaComparar(ya.causa) === causaParaComparar(causa.causa) || esLaMismaCausa(causa, ya)))) distintas.push(causa);
  }
  return distintas;
}

/** Con cuántas causas distintas sin resolverlo queda la línea "AVISO AL CTO" en el registro del Coordinador. */
export const CAUSAS_PARA_AVISAR_AL_CTO = 3;

/** La causa cuando no se supo (nunca se manda vacía al CRM). */
export function sinCausa(etapa, intento) {
  return `El Coordinador no supo la causa (etapa ${etapa ?? "?"}, intento ${intento ?? "?"}).`;
}

const QUE_CAMBIA_POR_ESTRATEGIA = {
  // El nombre "opus" se queda (las causas guardadas en el CRM lo traen); desde el 27-nov-2026 se repara con el modelo de `reparar`.
  opus: "se repara pensando otra forma de resolverlo (modelo de reparar), sin repetir lo de antes",
  nube: "lo que verificó la nube cambió al subir: se vuelve a construir y verificar en la nube",
  partir: "la tarea se divide en partes más chicas",
  sesion_nueva: "la nube no dio señal: se abre una sesión nueva de la nube (nunca la de un intento anterior)",
  plan_nuevo: "no cambió nada y no está en main: se vuelve a planear con el main de hoy (el plan viejo queda en los intentos)",
  arreglo: "se corrige leyendo el log completo del intento anterior (su ruta y las últimas 30 líneas), no solo la primera línea",
};

/**
 * Qué cambia frente al intento anterior, en una frase (sale solo de lo guardado en los intentos: no hay campo nuevo).
 *   diagnostico { categoria, causa }   la falla de ahora
 *   intentosPrevios                   los intentos ANTES de esta falla (más viejo a más nuevo)
 *   estrategia                        la que se va a usar ("opus" | "nube" | "partir" | "sesion_nueva" | null)
 */
export function queCambiaFrenteAlAnterior(diagnostico, intentosPrevios, estrategia = null) {
  if (estrategia && QUE_CAMBIA_POR_ESTRATEGIA[estrategia]) return QUE_CAMBIA_POR_ESTRATEGIA[estrategia];
  const anterior = intentoAnterior(intentosPrevios);
  if (!anterior) return "es el primer arreglo: se corrige solo esta causa, sin rehacer lo demás";
  if (esLaMismaCausa(diagnostico, anterior)) return "nada: es la misma causa que el intento anterior";
  const antes = enUnaLinea(sinMarcaDeEstrategia(anterior.causa) || anterior.categoria || "otra", 120);
  return enUnaLinea(`la falla es distinta a la del intento anterior (${anterior.categoria ?? "otra"}: ${antes}): se corrige esta, sin repetir lo de antes`);
}

/**
 * Los choques con main seguidos que ya se reconstruyeron sin contar: los intentos con choca_con_main entre los que NO
 * cuentan después del último que sí cuenta (las mismas filas que esperasSeguidas en reglas-trabajador.ts del CRM).
 */
export function choquesSeguidos(intentos) {
  let n = 0;
  for (const intento of [...(intentos ?? [])].reverse()) {
    const cuenta = intento?.cuentaComoIntento ?? intento?.accion !== "esperar";
    if (cuenta) break;
    if (intento.categoria === "choca_con_main") n += 1;
  }
  return n;
}

/*
  TOPE DE INTENTOS REALES (28-nov-2026, parte 1 de «máximo 2 intentos por tarjeta»). Una tarjeta tiene como máximo 2 intentos
  reales: a la segunda falla queda en ERROR con su explicación y solo el dueño la mueve (Reintentar). Extiende las reglas de
  T-996, T-997 y T-1014; no es un sistema aparte.
*/

/** Cuántos intentos reales aguanta una tarjeta: con la falla que lo completa se escala. `config.topeDeIntentosReales` lo cambia (pruebas viejas). */
export const TOPE_DE_INTENTOS_REALES = 2;

/** Lo que dejan las esperas por causa externa en la causa del intento: no son falla de la tarea y no se cuentan. */
export const MARCA_DE_CAUSA_EXTERNA = "[causa externa]";

/** Categorías que NO son falla de la tarea: no cuentan como intento real. */
const NO_CUENTAN_COMO_INTENTO = new Set(["limite_claude", "choca_con_main", "esperar_dependencia", "pc_sobrecargado", "carpeta_trabada", "sin_sesion"]);

/** ¿Este intento guardado cuenta como intento real? (sin mirar dónde empezó la cuenta; ver intentosRealesDe) */
function cuentaComoIntentoReal(intento) {
  if (!intento) return false;
  const categoria = String(intento.categoria ?? "");
  if (NO_CUENTAN_COMO_INTENTO.has(categoria)) return false;
  // La reversión "falsa" (se soltó sin la categoría subida_revertida) no es falla del código; las esperas por causa externa
  // (causa-externa, depender) llevan su marca o su acción propia.
  if (categoria === "reversion_falsa" || /reversi[oó]n falsa|no suma al tope de subidas/i.test(String(intento.causa ?? ""))) return false;
  if (intento.accion === "depender" || intento.accion === "causa_externa" || String(intento.causa ?? "").includes(MARCA_DE_CAUSA_EXTERNA)) return false;
  // Cada construcción o reparación que falló.
  if (intento.accion === "reparar" || intento.accion === "escalar") return true;
  // Cada subida revertida (la reversión falsa se suelta sin esa categoría) y cada cambio por repo equivocado.
  if (categoria === "subida_revertida" || categoria === "repo_equivocado") return true;
  // Cada vuelta soltada sin error pero con categoría (nube_sin_acceso_repo, coordinador_cortado…).
  return intento.accion === "esperar" && categoria !== "";
}

/**
 * Los intentos desde la última escalada. El CRM no borra los intentos viejos al pulsar Reintentar (solo pone las reparaciones en
 * 0): lo que dejó la tarjeta en ERROR es la fila `escalar`, y de ahí se cuenta. Si en los intentos que llegan (los últimos 6)
 * no hay ninguna escalada, se cuentan todos.
 */
function intentosDesdeLaUltimaEscalada(intentos) {
  const lista = Array.isArray(intentos) ? intentos.filter(Boolean) : [];
  const indice = lista.map((intento) => intento.accion).lastIndexOf("escalar");
  return indice >= 0 ? lista.slice(indice + 1) : lista;
}

/**
 * Cuántos intentos reales lleva la tarjeta (`tarjeta.ultimosIntentos`, del más viejo al más nuevo). Cuentan: cada construcción o
 * reparación, cada subida revertida (menos la reversión "falsa"), cada repo equivocado y cada vuelta soltada sin error con
 * categoría (nube_sin_acceso_repo, coordinador_cortado). No cuentan limite_claude, choca_con_main, esperar_dependencia ni las
 * esperas por causa externa. Puro.
 */
export function intentosReales(intentos) {
  return intentosDesdeLaUltimaEscalada(intentos).filter(cuentaComoIntentoReal).length;
}

/**
 * Los intentos reales de una tarjeta que YA está en ERROR (la recogida diaria): su última fila es la `escalar` que la dejó ahí, y esa
 * fila es el último intento real. Se cuentan los de antes de esa fila (desde la escalada anterior) más ella misma.
 */
export function intentosRealesDeUnaTarjetaEnError(intentos) {
  const lista = Array.isArray(intentos) ? intentos.filter(Boolean) : [];
  return lista.at(-1)?.accion === "escalar" ? intentosReales(lista.slice(0, -1)) + 1 : intentosReales(lista);
}

/** El último intento real (el que se compara con la falla de ahora), o null. */
export function ultimoIntentoReal(intentos) {
  return intentosDesdeLaUltimaEscalada(intentos).filter(cuentaComoIntentoReal).at(-1) ?? null;
}

/** Un plan para comparar: sin espacios de más ni mayúsculas. */
const planNormalizado = (plan) => String(plan ?? "").replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Regla 3, nunca repetir el mismo plan: ¿la falla de ahora es igual al intento real anterior? Es igual si tiene la misma categoría
 * o si el plan de la tarjeta es el mismo que el guardado en ese intento (cuando viene).
 */
export function esLaMismaFallaRealQueLaAnterior(diagnostico, tarjeta = {}) {
  const anterior = ultimoIntentoReal(tarjeta.ultimosIntentos);
  if (!anterior) return false;
  if (diagnostico?.categoria && anterior.categoria && anterior.categoria === diagnostico.categoria) return true;
  const planAntes = planNormalizado(anterior.plan);
  return Boolean(planAntes) && planAntes === planNormalizado(tarjeta.plan);
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
 * Qué hacer con la falla. Devuelve { accion, cuenta, estrategia?, motivo, causa?, queCambia?, mismaCausa? }.
 *   accion      "reparar" | "partir" | "esperar" | "escalar" | "arreglo_de_subida" (solo con una subida deshecha; no va al historial)
 *   cuenta      si cuenta como una de las 3 reparaciones (reparar y escalar sí; esperar y partir no)
 *   estrategia  "opus" cuando la 2ª reparación seguida con la misma categoría prueba otra forma (modelo de reparar); "nube" si se verifica otra vez en la nube;
 *               "sesion_nueva" cuando la nube no dio señal (el intento siguiente abre una sesión nueva de la nube);
 *               "plan_nuevo" cuando Claude no cambió nada y no está en main (se vuelve a planear con el main de hoy);
 *               "arreglo" cuando fallaron las pruebas (el intento siguiente lee el log completo). Las fallas repetidas
 *               (ESTRATEGIAS_DE_LAS_FALLAS) prueban una estrategia distinta en cada reparación
 *   agotado     true cuando una falla repetida (o una subida deshecha) llegó a su tope: una sola alerta, solo en la página
 *   arreglo     "sin_claude": el Coordinador lo arregla solo (cierra procesos, limpia la carpeta, espera al PC);
 *               "reconstruir": choca con main, se construye otra vez desde el main más nuevo sin gastar reparación
 *   motivo      por qué, para el log
 *   causa, queCambia  (al reparar) la causa en una frase y qué cambia frente al intento anterior
 *   mismaCausa  true cuando escala porque la falla es igual a la anterior y no hay nada distinto que probar
 *
 * Entradas: { diagnostico, tarjeta, etapa, config, archivosCambiados, reversion, modeloConstruir, verificarEnNube }
 *   tarjeta: reparaciones, topeReparaciones, esperasSeguidas, esParte, ultimosIntentos (como llegan de /tomar)
 *   archivosCambiados: cuántos archivos llevaba cambiados el intento que falló (o undefined)
 *   reversion: la etapa subió a main y tuvo que revertir -> URGENTE (ok false), una tarjeta de causa o la 3.ª subida deshecha
 *              escalan; si no, "arreglo_de_subida" (código o arranque) o "esperar" (pasajera), y las dos cuentan como intento de subida
 *   verificarEnNube: lo que verificó la nube cambió al subir (la reparación se verifica otra vez en la nube)
 */
export function decidir(entrada = {}) {
  const decision = decidirSinCausa(entrada);
  const { diagnostico, tarjeta = {}, etapa } = entrada;
  // 27-nov-2026: esperar a la dependencia y escalar por la misma causa también dicen qué cambia y por qué es distinto.
  if (decision.accion === "esperar_dependencia" || (decision.accion === "escalar" && decision.mismaCausa)) {
    return { ...decision, ...queCambiaYPorQue(decision, diagnostico, tarjeta.ultimosIntentos) };
  }
  if (decision.accion !== "reparar") return decision;
  // Lo que verificó la nube ya no es lo que se subiría: la reparación va a la NUBE (nunca a compilar en aizen1).
  if (entrada.verificarEnNube) decision.estrategia = "nube";
  // Antes de reparar: la causa en una frase y qué cambia frente al intento anterior (va al prompt del siguiente intento).
  const causa = enUnaLinea(diagnostico?.causa) || sinCausa(etapa, tarjeta.intentos);
  return { ...decision, causa, ...queCambiaYPorQue(decision, diagnostico, tarjeta.ultimosIntentos) };
}

/** ¿La causa de un no_cambio_nada trae el motivo que Claude escribió en "NO_CAMBIE: <motivo>"? */
function conMotivoDeNoCambie(causa) {
  const texto = sinMarcaDeEstrategia(causa);
  return texto.startsWith(`${CAUSA_BASE.no_cambio_nada}:`) && texto.slice(CAUSA_BASE.no_cambio_nada.length + 1).trim().length > 0;
}

/**
 * Por qué el intento siguiente es distinto del anterior, en una frase (27-nov-2026). Va al historial de la tarjeta y a la
 * bitácora junto con la causa y qué cambia.
 *   decision     la de decidir (accion, estrategia, mismaCausa)
 *   diagnostico  la falla de ahora; intentosPrevios: los intentos ANTES de esta falla
 */
export function porQueEsDistinto(decision, diagnostico, intentosPrevios) {
  const anterior = intentoAnterior(intentosPrevios);
  const antes = anterior ? causaEnUnaFrase(anterior) : "";
  if (decision?.accion === "esperar_dependencia") return enUnaLinea(`no se repara igual: la causa es la misma que la del intento anterior (${antes}) y no es del código; se espera a la otra tarjeta`);
  if (decision?.accion === "escalar" && decision.mismaCausa) return enUnaLinea(`no hay nada distinto que probar: la causa es la misma que la del intento anterior (${antes}); se corta sin otra reparación igual`);
  if (decision?.accion === "escalar" && decision.topeReal) return `llegó al tope de ${TOPE_DE_INTENTOS_REALES} intentos reales: no se prueba otra vez, pasa al dueño`;
  if (decision?.accion === "escalar") return "no queda una reparación que probar: pasa al dueño";
  if (decision?.estrategia) {
    const usadas = (intentosPrevios ?? []).map((intento) => estrategiaDeLaCausa(intento?.causa)).filter(Boolean);
    const antesUso = usadas.at(-1);
    return enUnaLinea(`se prueba la estrategia ${decision.estrategia}${antesUso && antesUso !== decision.estrategia ? `, distinta de la de antes (${antesUso})` : ", que no se había usado con esta causa"}`);
  }
  if (!anterior) return "es el primer intento que falla: no hay uno anterior con qué compararlo";
  if (esLaMismaCausa(diagnostico, anterior)) return enUnaLinea(`la causa es la misma que la del intento anterior (${antes}), pero todavía queda una reparación`);
  return enUnaLinea(`la causa es nueva: la del intento anterior fue ${antes}`);
}

/** { queCambia, porQueEsDistinto } de una decisión. */
function queCambiaYPorQue(decision, diagnostico, intentosPrevios) {
  const queCambia =
    decision.accion === "esperar_dependencia"
      ? "no se repara: se espera a la tarjeta de la que depende (o queda en ERROR si no hay a quién esperar)"
      : decision.accion === "escalar"
        ? "no se repara otra vez: pasa al dueño con el motivo (ERROR)"
        : queCambiaFrenteAlAnterior(diagnostico, intentosPrevios, decision.estrategia);
  return { queCambia, porQueEsDistinto: porQueEsDistinto(decision, diagnostico, intentosPrevios) };
}

/**
 * Los tres datos de una reparación, espera o escalada para el CRM y la bitácora (27-nov-2026): { causa, queCambia,
 * porQueEsDistinto }. `causa` es causaEnUnaFrase. Lo que la decisión ya trae se usa; lo que falta se calcula.
 */
export function porQueDeLaDecision(decision, diagnostico, intentosPrevios) {
  const calculado = decision?.queCambia && decision?.porQueEsDistinto ? decision : queCambiaYPorQue(decision ?? {}, diagnostico, intentosPrevios);
  return { causa: causaEnUnaFrase(diagnostico), queCambia: enUnaLinea(calculado.queCambia, 300), porQueEsDistinto: enUnaLinea(calculado.porQueEsDistinto, 300) };
}

function decidirSinCausa({ diagnostico, tarjeta = {}, etapa, config = {}, archivosCambiados, reversion = null, verificarEnNube = false } = {}) {
  const categoria = diagnostico?.categoria ?? "otra";
  const reparaciones = Number(tarjeta.reparaciones) || 0;
  const tope = Number(tarjeta.topeReparaciones) || TOPE_DE_REPARACIONES;
  const esperasSeguidas = Number(tarjeta.esperasSeguidas) || 0;
  const intentos = tarjeta.ultimosIntentos ?? [];
  const esParte = tarjeta.esParte === true;
  const minimoDeArchivos = config.partir?.archivosMinimos ?? 8;
  // 28-nov-2026: el tope de intentos reales (2). Con el tope subido en config, las pruebas viejas conservan las estrategias de siempre.
  const topeReal = Number(config.topeDeIntentosReales) || TOPE_DE_INTENTOS_REALES;
  const reales = intentosReales(intentos);

  // 24-nov-2026 (parte 3): una subida que se deshizo ya no escala siempre. La que NO se pudo deshacer (URGENTE) escala como antes.
  if (reversion) {
    if (reversion.ok !== true) return { accion: "escalar", cuenta: true, motivo: "falló después de subir a main y no se pudo deshacer (URGENTE): lo ve el dueño" };
    // 25-nov-2026: la reversión falsa no es falla del código: espera, no cuenta y no suma al tope de subidas.
    if (reversion.clase === "falsa") return { accion: "esperar", cuenta: false, motivo: "se deshizo antes de que el servidor bajara la versión (reversión falsa): se sube el mismo commit en la vuelta siguiente, sin sumar al tope de subidas" };
    // Una tarjeta de causa (también «Arreglo de subida: …») no pide otra: no se forma una cadena.
    if (esTarjetaDeCausa(tarjeta)) return { accion: "escalar", cuenta: true, motivo: "se deshizo la subida de una tarjeta de causa: no se pide otra, lo ve el dueño" };
    const subidas = intentosDeSubida(intentos) + 1;
    // 28-nov-2026: la subida deshecha que completa el tope de intentos reales queda solo en Alertas, como la 3.ª subida.
    if (reales + 1 >= topeReal) return { accion: "escalar", cuenta: true, agotado: true, topeReal: true, motivo: `la subida se deshizo y ya son ${reales + 1} intentos reales (tope ${topeReal}): queda en Alertas, solo Reintentar del dueño` };
    if (subidas >= TOPE_INTENTOS_DE_SUBIDA) return { accion: "escalar", cuenta: true, agotado: true, motivo: `se deshizo la subida ${subidas} veces (tope ${TOPE_INTENTOS_DE_SUBIDA}): queda en Alertas` };
    if (queHacerConLaSubidaDeshecha(diagnostico, reversion) === "arreglo") {
      return { accion: "arreglo_de_subida", cuenta: true, motivo: `se deshizo la subida por un error del programa o del arranque: se pide el arreglo y después se reintenta (subida ${subidas} de ${TOPE_INTENTOS_DE_SUBIDA})` };
    }
    return { accion: "esperar", cuenta: true, motivo: `se deshizo la subida por una falla pasajera: se reintenta en la vuelta siguiente, sin arreglo (subida ${subidas} de ${TOPE_INTENTOS_DE_SUBIDA})` };
  }

  if (categoria === "limite_claude") return { accion: "esperar", cuenta: false, motivo: "límite de uso de Claude: se espera su reinicio" };

  // 28-nov-2026 (reglas 1 y 3): antes de reparar, partir o probar otra estrategia. Las fallas que no son de la tarea (choque con
  // main, PC cargado, carpeta trabada, esperar a la dependencia) no cuentan y siguen su camino.
  const esperaDeDependencia = !AJENAS_A_LA_TAREA.includes(categoria) && !ERROR_DE_CODIGO.includes(categoria) && esCausaDeDependencia(diagnostico?.causa) && esLaMismaCausa(diagnostico, intentoAnterior(intentos));
  if (!NO_CUENTAN_COMO_INTENTO.has(categoria) && !esperaDeDependencia) {
    // Regla 3: la misma falla que el intento real anterior (o el mismo plan) escala de una, sin opus, nube ni partir.
    if (topeReal <= TOPE_DE_INTENTOS_REALES && esLaMismaFallaRealQueLaAnterior(diagnostico, tarjeta)) {
      return { accion: "escalar", cuenta: true, mismaCausa: true, topeReal: reales + 1 >= topeReal, motivo: `${categoria}: ${MISMA_CAUSA}; no se repite el mismo plan` };
    }
    if (reales + 1 >= topeReal) {
      return { accion: "escalar", cuenta: true, topeReal: true, motivo: `${categoria}: ya son ${reales + 1} intentos reales (tope ${topeReal}): queda en ERROR, solo Reintentar del dueño` };
    }
  }
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

  // 31-oct-2026: un choque con main no es culpa de la tarea: se reconstruye desde el main más nuevo sin gastar una reparación
  // (cuenta: false), hasta TOPE_DE_CHOQUES_SEGUIDOS seguidos; el siguiente escala.
  if (categoria === "choca_con_main") {
    const choques = choquesSeguidos(intentos);
    if (choques < TOPE_DE_CHOQUES_SEGUIDOS) {
      return { accion: "esperar", cuenta: false, arreglo: "reconstruir", motivo: `choca con main: se reconstruye desde el main más nuevo sin gastar reparación (${choques + 1}º choque seguido de ${TOPE_DE_CHOQUES_SEGUIDOS})` };
    }
    return { accion: "escalar", cuenta: true, motivo: `choca con main ${choques + 1} veces seguidas: main sigue cambiando lo mismo, lo ve el dueño` };
  }

  // 29-oct-2026: la nube que no dejó resultado (o preguntó) y el plan con preguntas abiertas no se reparan solos.
  if (SIN_REPARACION_AUTOMATICA.includes(categoria)) {
    return { accion: "escalar", cuenta: true, motivo: `${categoria}: no se repara solo, lo ve el dueño (con el link)` };
  }
  // 27-nov-2026 (parte 3 de «si una reparación falla por el mismo motivo, no repetir igual»): la misma causa que el intento
  // anterior, de dependencia o de main ("la parte 1 no está en main", DEPENDE_DE): ni Opus ni partir lo arreglan. Se espera a la
  // otra tarjeta (esperar_dependencia, bucle.mjs), sin contar ni reparar. Las causas de código siguen su camino de siempre.
  const anteriorDeLaTarea = AJENAS_A_LA_TAREA.includes(categoria) ? null : intentoAnterior(intentos);
  const mismaQueLaAnterior = esLaMismaCausa(diagnostico, anteriorDeLaTarea);
  if (mismaQueLaAnterior && !ERROR_DE_CODIGO.includes(categoria) && esCausaDeDependencia(diagnostico?.causa)) {
    return { accion: "esperar_dependencia", cuenta: false, motivo: `${categoria} con la misma causa que el intento anterior, de dependencia o de main: se espera a la otra tarjeta, sin reparar` };
  }
  // Claude no cambió nada con el MISMO motivo (su NO_CAMBIE) dos veces seguidas: volver a planear, Opus o la nube no le dan nada
  // distinto. Se escala con mismaCausa, sin gastar otra reparación igual. Sin motivo, sigue con sus estrategias de siempre.
  if (mismaQueLaAnterior && categoria === "no_cambio_nada" && conMotivoDeNoCambie(diagnostico?.causa)) {
    return { accion: "escalar", cuenta: true, mismaCausa: true, reparaciones, motivo: `no cambió nada con el mismo motivo que el intento anterior: ${MISMA_CAUSA}` };
  }
  // 25-nov-2026 (parte 4): las fallas repetidas (nube sin señal, no cambió nada, pruebas) usan el tope de 3 reparaciones del
  // CRM y cambian de estrategia en cada una; la falla que llega tras 3 intentos distintos escala UNA vez, `agotado`.
  if (ESTRATEGIAS_DE_LAS_FALLAS[categoria]) return decidirLaFallaRepetida({ diagnostico, categoria, reparaciones, tope, intentos });

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

  // La MISMA falla que el intento anterior: solo se repara si queda una estrategia distinta que probar, en este orden:
  // verificar otra vez en la nube (si eso es lo que cambió), la estrategia opus (si no se usó), partir (si se puede).
  if (mismaQueLaAnterior) {
    const usadas = new Set(intentos.map((intento) => estrategiaDeLaCausa(intento?.causa)).filter(Boolean));
    // 27-nov-2026: "ya se usó la estrategia opus" (no "el modelo de construir es Opus"): con Sonnet también se llega a partir.
    const yaEsOpus = usadas.has("opus") || estrategiaDeLaCausa(diagnostico?.causa) === "opus";
    // Lo que hay que verificar en la nube se repara SOLO en la nube: si eso ya se probó, no queda nada distinto.
    if (verificarEnNube) {
      return usadas.has("nube")
        ? { accion: "escalar", cuenta: true, mismaCausa: true, motivo: MISMA_CAUSA }
        : { accion: "reparar", cuenta: true, estrategia: "nube", motivo: `${categoria} otra vez: se verifica otra vez en la nube` };
    }
    if (etapa === "construir" && !yaEsOpus) return { accion: "reparar", cuenta: true, estrategia: "opus", motivo: `${categoria} con la misma causa: se repara pensando otra forma de resolverlo (modelo de reparar)` };
    if (etapa === "construir" && !esParte) return { accion: "partir", cuenta: false, motivo: `${categoria} con la misma causa y ya se intentó otra forma de resolverlo: se parte` };
    return { accion: "escalar", cuenta: true, mismaCausa: true, motivo: MISMA_CAUSA };
  }

  // La 2ª reparación seguida con la misma categoría cambia de estrategia: la opus (otra forma, modelo de reparar) o partir. (Desde el 29-oct, con 2
  // fallas iguales se escala arriba: el cambio de estrategia llega en la 2ª, no en la 3ª.)
  if (reparacionesSeguidasCon(intentos, categoria) >= 1) {
    const yaEsOpus = intentos.some((intento) => estrategiaDeLaCausa(intento?.causa) === "opus") || estrategiaDeLaCausa(diagnostico?.causa) === "opus";
    if (etapa === "construir" && !esParte && yaEsOpus) return { accion: "partir", cuenta: false, motivo: `${categoria} otra vez y ya se intentó otra forma de resolverlo: se parte` };
    if (etapa === "construir" && !yaEsOpus) return { accion: "reparar", cuenta: true, estrategia: "opus", motivo: `${categoria} otra vez: se repara pensando otra forma de resolverlo (modelo de reparar)` };
  }
  return { accion: "reparar", cuenta: true, motivo: `${categoria}: se repara (${reparaciones + 1} de ${tope})` };
}

/** Lo que hace cada estrategia de una falla repetida, para el motivo del log. */
const QUE_HACE_LA_FALLA = {
  nube_sin_resultado: "la nube no dio señal",
  no_cambio_nada: "no cambió nada y no está en main",
  fallan_pruebas: "fallaron las pruebas",
};

/**
 * Una falla repetida (ESTRATEGIAS_DE_LAS_FALLAS): con reparaciones por delante, la estrategia distinta que toca; con el tope del
 * CRM gastado (o sin estrategia distinta que probar), escala UNA vez con `agotado` (una sola alerta, solo en la página).
 */
function decidirLaFallaRepetida({ diagnostico, categoria, reparaciones, tope, intentos }) {
  const que = QUE_HACE_LA_FALLA[categoria];
  if (reparaciones >= tope) {
    return { accion: "escalar", cuenta: true, agotado: true, motivo: `${que} tras ${reparaciones} intentos distintos (tope ${tope}): una sola alerta, solo en la página` };
  }
  const estrategia = estrategiaParaLaFalla(diagnostico, intentos);
  if (!estrategia) {
    return { accion: "escalar", cuenta: true, agotado: true, mismaCausa: true, motivo: `${que}: ya se probaron todas sus estrategias con la misma causa; una sola alerta, solo en la página` };
  }
  return { accion: "reparar", cuenta: true, estrategia, motivo: `${que}: se reintenta con la estrategia ${estrategia} (${reparaciones + 1} de ${tope})` };
}

/** La causa de una falla repetida agotada, en palabras sencillas (va a la alerta del dueño). */
export const FRASES_DE_LA_FALLA_AGOTADA = {
  nube_sin_resultado: "La sesión de la nube no terminó ni dio señal, ni siquiera abriendo sesiones nuevas.",
  no_cambio_nada: "Claude terminó sin cambiar nada, aunque se volvió a planear la tarea con lo último del sistema.",
  fallan_pruebas: "Las pruebas siguen fallando después de corregir con el registro completo, de pensar otra forma de resolverlo y de verificar en la nube.",
};

/**
 * El resumen de 3 líneas de una falla repetida agotada (tras 3 intentos distintos): qué se intentó, la causa en palabras
 * sencillas y la decisión que se necesita. Va en /error con `agotado: true`.
 */
export function resumenDeFallaAgotada({ tarjeta = {}, intentos, diagnostico } = {}) {
  const categoria = diagnostico?.categoria ?? "otra";
  const lista = intentos ?? tarjeta.ultimosIntentos ?? [];
  const probadas = estrategiasProbadas(lista, categoria);
  const veces = Math.max(probadas.length, Number(tarjeta.reparaciones) || 0);
  const frase = FRASES_DE_LA_FALLA_AGOTADA[categoria] ?? CAUSA_BASE[categoria] ?? CAUSA_BASE.otra;
  return [
    enUnaLinea(`Qué se intentó: «${enUnaLinea(tarjeta.titulo ?? "la tarea", 80)}» se reintentó ${veces} ${veces === 1 ? "vez" : "veces"} de formas distintas${probadas.length ? ` (${probadas.join(", ")})` : ""} y volvió a fallar.`, 240),
    enUnaLinea(`Causa: ${frase}`, 240),
    enUnaLinea(`Qué decisión se necesita: ${NECESITA[categoria] ?? NECESITA.otra}`, 240),
  ].join("\n");
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
  choque_de_logica: "Mirar qué cambió en main y qué pide la tarea (Detalles técnicos) y decidir cómo juntarlos; después tocar Reintentar.",
  zona: "Leer el motivo (No sube: …): si el envío a clientes no se pidió, aclarar el plan y aprobar de nuevo; si sí se pidió, subirlo a mano.",
  otra: "Que alguien mire los Detalles técnicos y diga qué hacer.",
};

/**
 * El resumen para el dueño, de MÁXIMO 3 líneas sencillas (qué falló / qué se probó / qué necesita).
 *   { tarjeta, intentos, diagnostico }  `intentos`: los de la tarjeta (más viejo a más nuevo), si se tienen.
 */
export function resumenDeEscalada({ tarjeta = {}, intentos, diagnostico, decision = null } = {}) {
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
  const probado = hecho.length ? `${hecho.join(", ")}${causas.length ? ` (causas: ${causas.join(", ")})` : ""}` : "nada todavía, no había forma segura de repararlo solo";
  // 30-oct-2026: si escala porque la falla se repitió igual, se dice (no se gastó otro intento a ciegas).
  // 28-nov-2026: si escala por el tope de intentos reales, se dice (solo el Reintentar del dueño la vuelve a mover).
  const queSeProbo = `Qué se probó: ${decision?.mismaCausa ? `${probado}; ${MISMA_CAUSA}` : decision?.topeReal ? `${probado}; llegó al tope de ${TOPE_DE_INTENTOS_REALES} intentos` : probado}.`;
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

/* ─────────────── la causa de una subida que se deshizo, en palabras sencillas (parte 1 de 3) ── */

/** El arranque del servidor: falta una variable de entorno, la migración de Prisma, entrypoint.sh con error, puerto ocupado. */
const ARRANQUE_VARIABLE = /Environment variable not found|variable de entorno|missing (?:required )?(?:env|environment)|env(?:ironment)? var(?:iable)?[^\n]{0,40}(?:missing|not set|required|undefined)|is not set in the environment/i;
const ARRANQUE_MIGRACION = /\bP30(?:0[0-9]|1[0-9])\b|migrate deploy[^\n]*(?:fail|error)|migration[^\n]*(?:failed|fall[oó])|(?:fall[oó]|error)[^\n]*migraci[oó]n/i;
const ARRANQUE_ENTRYPOINT = /entrypoint\.sh[^\n]*(?:error|fail|fall|exit|code [1-9]|status [1-9])|(?:error|fail|exit)[^\n]*entrypoint\.sh/i;
const ARRANQUE_PUERTO = /EADDRINUSE|address already in use|port[^\n]{0,30}(?:already|in use)|puerto[^\n]{0,30}ocupado/i;
/** Un error del programa: los de JavaScript, módulos que faltan y los de Next o del build. */
const CODIGO_BUILD = /Type error:|Failed to compile|Build error|Module not found|next build[^\n]*(?:fail|error)|build fall[oó]|ERROR: build/i;
const CODIGO_PROGRAMA = /\b(?:TypeError|ReferenceError|SyntaxError|RangeError)\b|Cannot find module|Unhandled(?: promise)? rejection|PrismaClient\w*Error|⨯ /i;
/** Falla pasajera: la red, el servidor ocupado, el registro de imágenes o GitHub sin respuesta (más SERVIDOR_CAIDO). */
const PASAJERA = new RegExp(
  [
    SERVIDOR_CAIDO.source,
    "ETIMEDOUT|ECONNRESET|EAI_AGAIN|ENOTFOUND|socket hang up|network (?:error|timeout)|corte de red",
    "\\b(?:HTTP|status|c[oó]digo|contest[oó]|error)\\D{0,12}50[234]\\b|\\b50[234] (?:Bad Gateway|Service Unavailable|Gateway Time-?out)|Bad Gateway|Service Unavailable|Gateway Time-?out",
    "servidor ocupado|server (?:is )?(?:busy|overloaded)|too many requests|rate limit",
    "(?:registry|ghcr\\.io|docker\\.io|registro de im[aá]genes)[^\\n]{0,80}(?:timeout|timed out|unavailable|no respond|refused|50[234])",
    "(?:github|api\\.github\\.com)[^\\n]{0,80}(?:timeout|timed out|unavailable|no respond|50[234])",
  ].join("|"),
  "i",
);
/** El despliegue venció (la versión nueva no apareció a tiempo, el CI se pasó del tiempo): sin error del código es pasajera. */
const VENCIO = /se pas[oó] del tiempo|la versi[oó]n nueva no arranc[oó]/i;
/** Una línea que habla de una falla (para la vigilancia y para mostrar algo cuando no se sabe la causa). */
const LINEA_DE_FALLA = /error|fail|fall[oó]|\[minuto \d+\]/i;

/** Las frases sencillas: una o dos frases sin palabras técnicas (van a la tarjeta y al WhatsApp del dueño). */
export const FRASES_DE_LA_CAUSA = {
  variable: "Faltó una configuración del servidor al arrancar.",
  migracion: "Falló la actualización de la base de datos al arrancar la versión nueva.",
  entrypoint: "La versión nueva no pudo arrancar en el servidor: el arranque terminó con error.",
  puerto: "La versión nueva no pudo arrancar porque otro programa ya ocupaba su lugar en el servidor.",
  armado: "El cambio tiene un error en el programa y la versión nueva no se pudo armar.",
  programa: "El cambio tiene un error en el programa y la versión nueva falló al usarse.",
  vigilancia: "Después de subir aparecieron fallas nuevas del programa, así que el cambio tiene un error que hay que corregir.",
  pasajera: "Fue una falla pasajera: la red, el servidor o GitHub no respondieron a tiempo. El cambio en sí puede estar bien.",
  vencio: "El servidor tardó demasiado en tomar la versión nueva, sin ningún error del programa: parece una falla pasajera.",
  desconocida: "No se pudo saber la causa: los registros no muestran por qué falló.",
  falsa: "El servidor todavía no había terminado de bajar la versión nueva cuando se deshizo: no es una falla del cambio. Se vuelve a subir el mismo cambio.",
};

/** Las líneas del texto que calzan con `regla` (sin repetir), máximo 8 y de 300 caracteres cada una. */
function lineasQueMuestran(texto, regla) {
  const vistas = [];
  for (const linea of String(texto ?? "").split(/\r?\n/)) {
    const limpia = linea.trim();
    if (limpia && regla.test(limpia) && !vistas.includes(limpia)) vistas.push(limpia);
    if (vistas.length >= 8) break;
  }
  return vistas.map((linea) => recortar(linea, 300));
}

/**
 * Por qué falló una subida que se deshizo, en palabras sencillas. Pura: no toca disco, red ni procesos.
 *   motivo      el texto con que falló la subida (el de la etapa)
 *   logs        lo que se leyó del servidor o de GitHub después de deshacer ("" si no se pudo)
 *   vigilancia  true si la deshizo la vigilancia de 30 min (no el despliegue)
 * -> { clase: "codigo" | "arranque" | "pasajera" | "desconocida", sencilla, lineas } (lineas: hasta 8 del texto que lo muestran).
 * Orden: arranque, código, pasajera; un error del programa le gana a un 503 (el 503 puede ser porque el programa se cayó).
 */
export function causaDeLaSubidaFallida({ motivo = "", logs = "", vigilancia = false } = {}) {
  const texto = sinRuido(`${motivo ?? ""}\n${logs ?? ""}`);
  const con = (clase, frase, regla) => ({ clase, sencilla: FRASES_DE_LA_CAUSA[frase], lineas: lineasQueMuestran(texto, regla) });
  if (ARRANQUE_VARIABLE.test(texto)) return con("arranque", "variable", ARRANQUE_VARIABLE);
  if (ARRANQUE_MIGRACION.test(texto)) return con("arranque", "migracion", new RegExp(`${ARRANQUE_MIGRACION.source}|${ARRANQUE_ENTRYPOINT.source}`, "i"));
  if (ARRANQUE_ENTRYPOINT.test(texto)) return con("arranque", "entrypoint", ARRANQUE_ENTRYPOINT);
  if (ARRANQUE_PUERTO.test(texto)) return con("arranque", "puerto", ARRANQUE_PUERTO);
  if (CODIGO_BUILD.test(texto)) return con("codigo", "armado", CODIGO_BUILD);
  if (CODIGO_PROGRAMA.test(texto)) return con("codigo", vigilancia ? "vigilancia" : "programa", CODIGO_PROGRAMA);
  if (PASAJERA.test(texto)) return con("pasajera", "pasajera", PASAJERA);
  if (VENCIO.test(texto)) return con("pasajera", "vencio", VENCIO);
  // La vigilancia vio fallas nuevas que no son de arranque ni de la red: son del programa.
  if (vigilancia && /l[ií]nea\(s\) de falla nueva|\[minuto \d+\]/i.test(texto)) return con("codigo", "vigilancia", LINEA_DE_FALLA);
  return con("desconocida", "desconocida", LINEA_DE_FALLA);
}

/** La causa de una reversión en una línea: el "Detalle técnico" si lo hay (es lo que de verdad falló), si no la primera línea. */
function causaDeLaReversion(motivo, reversion = null) {
  // La frase sencilla (causaDeLaSubidaFallida) le gana al detalle técnico: es la que entiende el dueño. Con la clase
  // "desconocida" la frase no dice nada, así que queda el detalle técnico de siempre (es lo único que se sabe).
  const sencilla = typeof reversion?.sencilla === "string" && reversion.clase !== "desconocida" ? reversion.sencilla.trim() : "";
  if (sencilla) return sencilla;
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
  const causa = enUnaLinea(causaDeLaReversion(motivo, reversion), Math.max(40, espacio));
  return recortarAviso([primera, `Motivo: ${causa}`, ultima].join("\n"));
}
