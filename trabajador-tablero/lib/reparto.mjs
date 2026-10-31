// CÓMO ESCOGE Y PARTE las tareas el Coordinador (25-oct-2026, meta del dueño: 20 tareas HECHO por día). Puro: sin
// disco, red ni procesos.
//
// ESCOGER (ordenarCandidatas). De las que se pueden tomar ahora (las que no chocan con lo que corre, choques.mjs),
// primero la que está más cerca de HECHO y la que menos se puede caer:
//   1. subir antes que todo lo demás (una tarea construida que no sube no cuenta);
//   2. la prioridad que da el CRM (31-oct-2026, `prioridad` de /candidatas, prioridadDeLaFila del CRM: 0 = URGENTE o dice
//      PRIORIDAD, 1 = ventas y chats de las asesoras, 2 = dinero de Gestión, 3 = lo demás; sin el dato cuenta como 3),
//      el mismo orden con que /tomar las toma;
//   3. construir antes que planear;
//   4. la que desbloquea a otras (la parte 1 de una tarea partida, una tarjeta de la que dependen otras);
//   5. la más chica (menos archivos en el plan: tarda menos y choca menos); un plan que no dice archivos va al final;
//   6. el orden del CRM (la que más espera).
//
// PARTIR ANTES (debePartirAntes). Una tarea muy grande que se va a construir en aizen1 se parte ANTES de gastar
// 90 min en ella: con más de `partir.archivosAntes` archivos (sin contar documentos) o con migración y pantalla
// juntas por encima de `partir.archivosConMigracion`. Las partes las escribe una sesión de solo lectura (etapas.mjs:
// partirTarea), se hacen EN ORDEN (la 2 parte de main con la 1 ya subida: no chocan entre ellas) y el CRM las crea
// con /partir. REGLA DE LA APROBACIÓN: cada parte hereda la aprobación de la madre SOLO porque la madre ya está
// aprobada (el Coordinador solo parte tarjetas en EN_CURSO, que llegaron ahí con el plan aprobado) y SOLO si las
// partes no agregan alcance (partesSinAlcanceNuevo: no tocan módulos que el plan aprobado no nombra). Si agregan,
// no se parte: se construye la tarea entera como siempre.
import { CARPETAS_COMUNES, SIN_CHOQUE_POR_DEFECTO, archivosDelPlan, noChoca } from "./choques.mjs";

const ORDEN_DE_ETAPA = { subir: 0, construir: 1, planear: 2 };

/** La prioridad que da el CRM (0 a 3); si falta o no es uno de esos, 3 (lo demás): con un CRM viejo el orden queda igual. */
const SIN_PRIORIDAD = 3;
const prioridadDe = (candidata) => {
  const prioridad = candidata?.prioridad;
  return Number.isInteger(prioridad) && prioridad >= 0 && prioridad < SIN_PRIORIDAD ? prioridad : SIN_PRIORIDAD;
};

/** Cuántos archivos de código (sin los "sin choque": documentos .md) nombra el plan; null si no nombra ninguno. */
export function tamanoDelPlan(plan, sinChoque = SIN_CHOQUE_POR_DEFECTO) {
  const archivos = archivosDelPlan(plan);
  if (!archivos.length) return null;
  return archivos.filter((archivo) => !noChoca(archivo, sinChoque)).length;
}

/**
 * Las candidatas en el orden en que conviene tomarlas (ver arriba). No cambia la lista que recibe.
 * Cada candidata: { id, hacer, plan?, desbloquea?, prioridad? } (como las da /candidatas del CRM).
 */
export function ordenarCandidatas(candidatas) {
  return (candidatas ?? [])
    .map((candidata, indice) => {
      const tamano = candidata?.hacer === "planear" ? 0 : tamanoDelPlan(candidata?.plan);
      const etapa = ORDEN_DE_ETAPA[candidata?.hacer] ?? 3;
      return { candidata, indice, sube: etapa === 0 ? 0 : 1, prioridad: prioridadDe(candidata), etapa, desbloquea: Number(candidata?.desbloquea) || 0, tamano: tamano ?? Number.MAX_SAFE_INTEGER };
    })
    .sort((a, b) => a.sube - b.sube || a.prioridad - b.prioridad || a.etapa - b.etapa || b.desbloquea - a.desbloquea || a.tamano - b.tamano || a.indice - b.indice)
    .map(({ candidata }) => candidata);
}

/** Lo que viene por defecto en config.partir. */
export const PARTIR_ANTES_POR_DEFECTO = { archivosAntes: 25, archivosConMigracion: 15 };

const tocaPantalla = (archivo) => /^(?:src\/)?(?:app\/(?!api\/)|components\/|features\/[^/]+\/components\/)/.test(archivo) || /\.tsx$/.test(archivo);

/* ───────────────────────────────────────────── las PARTES DEL SISTEMA (29-oct-2026) ── */

/*
  La tarjeta ykpl83z3 tocaba 3 partes del sistema (una ruta nueva en Gestión, un script con cron en aizen1 y el envío por
  el CRM), se midió "chica" por número de archivos y se construyó 4 veces en la nube sin resultado. Una PARTE DEL SISTEMA
  es un módulo de primer nivel (src/modules/X, src/features/X, src/app/<área>, scripts/X…). Las carpetas de pegamento
  (lib, prisma, components, hooks, types, app/actions, las rutas MCP y cron) no cuentan: casi toda tarea las toca. Dos
  partes con el mismo nombre (src/app/api/alertas y src/modules/alertas-cuentas) son la misma.
*/

/** Carpetas que no son una parte por sí solas (pegamento que casi toda tarea toca). */
const PEGAMENTO = new Set(["lib", "prisma", "components", "hooks", "types", "styles", "public", "docs", "tests", "pruebas", "__tests__", "generated", "i18n", "config", "utils"]);
/** Palabras que no nombran nada propio (no sirven para juntar dos partes). */
const PALABRAS_VACIAS = new Set(["api", "app", "cliente", "admin", "src", "page", "route", "index", "domain", "application", "infrastructure", "services", "components", "actions"]);

/** Las palabras propias de un segmento ("alertas-cuentas" -> "alertas", "cuentas"), sin plural. */
const palabrasDe = (segmento) =>
  String(segmento)
    .toLowerCase()
    .replace(/\.[^.]+$/, "")
    .split(/[-_.]+/)
    .map((palabra) => palabra.replace(/s$/, ""))
    .filter((palabra) => palabra.length >= 3 && !PALABRAS_VACIAS.has(palabra) && !PALABRAS_VACIAS.has(`${palabra}s`));

/**
 * La parte del sistema de una ruta: { clave, nombre } (nombre = la palabra principal, para juntar partes del mismo tema),
 * o null si es pegamento, documento, prueba o un archivo suelto de la raíz.
 */
export function parteDelSistema(archivo, sinChoque = SIN_CHOQUE_POR_DEFECTO) {
  const limpia = String(archivo ?? "").replace(/\\/g, "/");
  if (!limpia || SIN_ALCANCE(limpia, sinChoque)) return null;
  const partes = limpia.replace(/^src\//, "").split("/").filter(Boolean);
  if (partes.length < 2 || PEGAMENTO.has(partes[0])) return null;
  const carpeta = (i) => (partes[i] && !/\.[a-z0-9]+$/i.test(partes[i]) ? partes[i] : null);
  let clave;
  let nombre;
  if (partes[0] === "app") {
    const ruta = partes.slice(0, -1).join("/");
    if (CARPETAS_COMUNES.some((comun) => ruta === comun || ruta.startsWith(`${comun}/`) || `${ruta}/`.startsWith(`${comun}/`))) return null;
    // app/api/<x>, o app/<área> saltando los (grupos) y [ids] de Next y las palabras vacías (cliente, admin).
    const utiles = partes.slice(1, -1).filter((segmento) => !/^\(.*\)$|^\[.*\]$/.test(segmento));
    const area = utiles.find((segmento) => palabrasDe(segmento).length) ?? utiles[0];
    if (!area) return null;
    clave = `app/${utiles[0] === "api" ? "api/" : ""}${utiles[0] === "api" ? (utiles[1] ?? area) : area}`;
    nombre = palabrasDe(utiles[0] === "api" ? (utiles[1] ?? area) : area)[0] ?? area;
  } else {
    const segunda = carpeta(1) ?? partes[1].replace(/\.[^.]+$/, "");
    clave = `${partes[0]}/${segunda}`;
    nombre = palabrasDe(segunda)[0] ?? segunda;
  }
  return { clave, nombre };
}

/** El plan dice que el trabajo sale de este repo: un cron en aizen1, otro repositorio u "otro sistema". */
const OTRO_SISTEMA = /\bcrontab\b|\bcron\b[^\n]{0,80}\baizen1\b|\baizen1\b[^\n]{0,80}\bcron\b|\botro (?:repo|repositorio|sistema)\b|\bfuera de (?:este repo|la imagen)\b/i;

/**
 * Las partes del sistema que toca el plan: { partes: [claves agrupadas por tema], otroSistema: motivo | null }.
 * `otrosRepos`: las claves de los demás repos (si el plan dice "en el repo agentelite…", es otro sistema).
 */
export function partesDelSistemaDelPlan(plan, { sinChoque = SIN_CHOQUE_POR_DEFECTO, otrosRepos = [] } = {}) {
  const grupos = new Map();
  for (const archivo of archivosDelPlan(plan)) {
    const parte = parteDelSistema(archivo, sinChoque);
    if (!parte) continue;
    const grupo = grupos.get(parte.nombre) ?? new Set();
    grupo.add(parte.clave);
    grupos.set(parte.nombre, grupo);
  }
  const texto = String(plan ?? "");
  let otroSistema = texto.match(OTRO_SISTEMA)?.[0] ?? null;
  for (const repo of otrosRepos) {
    const nombre = String(repo).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const calce = texto.match(new RegExp(`\\b(?:repo|repositorio)\\s+(?:de\\s+)?["\`]?${nombre}\\b`, "i"));
    if (calce && !otroSistema) otroSistema = calce[0];
  }
  return { partes: [...grupos.values()].map((claves) => [...claves].join(" + ")), otroSistema };
}

/**
 * ¿Partir esta tarea ANTES de construirla? -> { partir: boolean, motivo }.
 * No se parte una que ya es una parte, una ya partida, una que viene de una reparación (ya tiene trabajo a medias)
 * ni una cuyo plan no dice archivos.
 * `soloPorPartes`: solo la regla de las partes del sistema (la nube: el número de archivos ya lo decide esTareaGrande).
 */
export function debePartirAntes(tarjeta, { partir = {}, carpetaMigraciones = "prisma/migrations", sinChoque = SIN_CHOQUE_POR_DEFECTO, otrosRepos = [], soloPorPartes = false } = {}) {
  const topes = { ...PARTIR_ANTES_POR_DEFECTO, ...partir };
  if (!topes.archivosAntes) return { partir: false, motivo: "apagado" };
  if (tarjeta?.esParte) return { partir: false, motivo: "ya es una parte" };
  if (tarjeta?.resultado?.partida) return { partir: false, motivo: "ya está partida" };
  if (Number(tarjeta?.reparaciones) > 0 || tarjeta?.reparacion) return { partir: false, motivo: "viene de una reparación" };
  const archivos = archivosDelPlan(tarjeta?.plan).filter((archivo) => !noChoca(archivo, sinChoque));
  if (!archivos.length) return { partir: false, motivo: "el plan no dice archivos" };
  // 29-oct-2026: más de una parte del sistema (o una parte + otro sistema) -> se parte antes de construir.
  if (topes.partesDelSistema !== false) {
    const { partes, otroSistema } = partesDelSistemaDelPlan(tarjeta?.plan, { sinChoque, otrosRepos });
    const cuantas = partes.length + (otroSistema ? 1 : 0);
    if (cuantas > 1) {
      return { partir: true, motivo: `el plan toca ${cuantas} partes del sistema (${[...partes, ...(otroSistema ? [`otro sistema: «${otroSistema}»`] : [])].join("; ")})` };
    }
  }
  if (soloPorPartes) return { partir: false, motivo: "toca una sola parte del sistema" };
  if (archivos.length > topes.archivosAntes) return { partir: true, motivo: `el plan nombra ${archivos.length} archivos de código (más de ${topes.archivosAntes})` };
  const carpeta = String(carpetaMigraciones).replace(/\/+$/, "");
  const conMigracion = archivos.some((archivo) => archivo === carpeta || archivo.startsWith(`${carpeta}/`) || /(^|\/)schema\.prisma$/.test(archivo));
  if (conMigracion && archivos.some(tocaPantalla) && archivos.length > topes.archivosConMigracion) {
    return { partir: true, motivo: `migración y pantalla juntas con ${archivos.length} archivos de código (más de ${topes.archivosConMigracion})` };
  }
  return { partir: false, motivo: "es manejable de una vez" };
}

/** Lo que no es alcance nuevo aunque el plan no lo nombre: pruebas y documentos. */
const SIN_ALCANCE = (archivo, sinChoque) => noChoca(archivo, sinChoque) || /^scripts\/check-|(^|\/)pruebas\/|\.test\.[cm]?[jt]sx?$|(^|\/)__tests__\//.test(archivo);

/** Las palabras del texto (minúsculas, sin tildes ni plural): para saber si el plan "nombra" un tema aunque no dé la ruta. */
const palabrasDelTexto = (texto) =>
  new Set(
    String(texto ?? "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((palabra) => palabra.length >= 3)
      .map((palabra) => palabra.replace(/s$/, "")),
  );

/**
 * ¿Las partes se quedan dentro del plan aprobado? -> { ok, fuera: [partes del sistema que el plan no nombra] }.
 * 29-oct-2026: se compara por PARTE DEL SISTEMA (parteDelSistema), no por nombre exacto de módulo. Antes ykpl83z3 no se pudo
 * partir porque las partes nombraban "lib", "prisma", "scripts/respaldo" o "app/api/transporte" (que el plan usaba de
 * ejemplo sin dar la ruta). Ahora: el pegamento (lib, prisma, app/actions…), las pruebas y los documentos nunca son
 * alcance nuevo, y una parte vale si el plan de la madre la nombra (por su ruta o por su tema, en cualquier parte del texto).
 */
export function partesSinAlcanceNuevo(planDeLaMadre, partes, { sinChoque = SIN_CHOQUE_POR_DEFECTO } = {}) {
  const claves = new Set();
  const nombres = new Set();
  for (const archivo of archivosDelPlan(planDeLaMadre)) {
    const parte = parteDelSistema(archivo, sinChoque);
    if (parte) {
      claves.add(parte.clave);
      nombres.add(parte.nombre);
    }
  }
  const palabras = palabrasDelTexto(planDeLaMadre);
  const fuera = new Set();
  for (const parte of partes ?? []) {
    for (const archivo of archivosDelPlan(parte?.detalle)) {
      const suya = parteDelSistema(archivo, sinChoque);
      if (!suya || claves.has(suya.clave) || nombres.has(suya.nombre) || palabras.has(suya.nombre)) continue;
      fuera.add(suya.clave);
    }
  }
  return { ok: fuera.size === 0, fuera: [...fuera] };
}
