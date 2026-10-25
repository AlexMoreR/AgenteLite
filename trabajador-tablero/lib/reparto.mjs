// CÓMO ESCOGE Y PARTE las tareas el Coordinador (25-oct-2026, meta del dueño: 20 tareas HECHO por día). Puro: sin
// disco, red ni procesos.
//
// ESCOGER (ordenarCandidatas). De las que se pueden tomar ahora (las que no chocan con lo que corre, choques.mjs),
// primero la que está más cerca de HECHO y la que menos se puede caer:
//   1. subir antes que construir, y construir antes que planear (una tarea construida que no sube no cuenta);
//   2. la que desbloquea a otras (la parte 1 de una tarea partida, una tarjeta de la que dependen otras);
//   3. la más chica (menos archivos en el plan: tarda menos y choca menos); un plan que no dice archivos va al final;
//   4. el orden del CRM (la que más espera).
//
// PARTIR ANTES (debePartirAntes). Una tarea muy grande que se va a construir en aizen1 se parte ANTES de gastar
// 90 min en ella: con más de `partir.archivosAntes` archivos (sin contar documentos) o con migración y pantalla
// juntas por encima de `partir.archivosConMigracion`. Las partes las escribe una sesión de solo lectura (etapas.mjs:
// partirTarea), se hacen EN ORDEN (la 2 parte de main con la 1 ya subida: no chocan entre ellas) y el CRM las crea
// con /partir. REGLA DE LA APROBACIÓN: cada parte hereda la aprobación de la madre SOLO porque la madre ya está
// aprobada (el Coordinador solo parte tarjetas en EN_CURSO, que llegaron ahí con el plan aprobado) y SOLO si las
// partes no agregan alcance (partesSinAlcanceNuevo: no tocan módulos que el plan aprobado no nombra). Si agregan,
// no se parte: se construye la tarea entera como siempre.
import { CARPETAS_COMUNES, SIN_CHOQUE_POR_DEFECTO, archivosDelPlan, moduloDe, noChoca } from "./choques.mjs";

const ORDEN_DE_ETAPA = { subir: 0, construir: 1, planear: 2 };

/** Cuántos archivos de código (sin los "sin choque": documentos .md) nombra el plan; null si no nombra ninguno. */
export function tamanoDelPlan(plan, sinChoque = SIN_CHOQUE_POR_DEFECTO) {
  const archivos = archivosDelPlan(plan);
  if (!archivos.length) return null;
  return archivos.filter((archivo) => !noChoca(archivo, sinChoque)).length;
}

/**
 * Las candidatas en el orden en que conviene tomarlas (ver arriba). No cambia la lista que recibe.
 * Cada candidata: { id, hacer, plan?, desbloquea? } (como las da /candidatas del CRM).
 */
export function ordenarCandidatas(candidatas) {
  return (candidatas ?? [])
    .map((candidata, indice) => {
      const tamano = candidata?.hacer === "planear" ? 0 : tamanoDelPlan(candidata?.plan);
      return { candidata, indice, etapa: ORDEN_DE_ETAPA[candidata?.hacer] ?? 3, desbloquea: Number(candidata?.desbloquea) || 0, tamano: tamano ?? Number.MAX_SAFE_INTEGER };
    })
    .sort((a, b) => a.etapa - b.etapa || b.desbloquea - a.desbloquea || a.tamano - b.tamano || a.indice - b.indice)
    .map(({ candidata }) => candidata);
}

/** Lo que viene por defecto en config.partir. */
export const PARTIR_ANTES_POR_DEFECTO = { archivosAntes: 25, archivosConMigracion: 15 };

const tocaPantalla = (archivo) => /^(?:src\/)?(?:app\/(?!api\/)|components\/|features\/[^/]+\/components\/)/.test(archivo) || /\.tsx$/.test(archivo);

/**
 * ¿Partir esta tarea ANTES de construirla? -> { partir: boolean, motivo }.
 * No se parte una que ya es una parte, una ya partida, una que viene de una reparación (ya tiene trabajo a medias)
 * ni una cuyo plan no dice archivos.
 */
export function debePartirAntes(tarjeta, { partir = {}, carpetaMigraciones = "prisma/migrations", sinChoque = SIN_CHOQUE_POR_DEFECTO } = {}) {
  const topes = { ...PARTIR_ANTES_POR_DEFECTO, ...partir };
  if (!topes.archivosAntes) return { partir: false, motivo: "apagado" };
  if (tarjeta?.esParte) return { partir: false, motivo: "ya es una parte" };
  if (tarjeta?.resultado?.partida) return { partir: false, motivo: "ya está partida" };
  if (Number(tarjeta?.reparaciones) > 0 || tarjeta?.reparacion) return { partir: false, motivo: "viene de una reparación" };
  const archivos = archivosDelPlan(tarjeta?.plan).filter((archivo) => !noChoca(archivo, sinChoque));
  if (!archivos.length) return { partir: false, motivo: "el plan no dice archivos" };
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

/** El módulo "ancho": en una carpeta común (src/app/actions…) cuenta la carpeta, no el archivo. */
function moduloAncho(archivo) {
  const ruta = String(archivo).replace(/\\/g, "/").replace(/^src\//, "");
  return CARPETAS_COMUNES.find((carpeta) => ruta === carpeta || ruta.startsWith(`${carpeta}/`)) ?? moduloDe(archivo);
}

/**
 * ¿Las partes se quedan dentro del plan aprobado? -> { ok, fuera: [módulos que el plan no nombra] }.
 * Se compara por módulo (choques.mjs: moduloDe): una parte puede tocar otro archivo del MISMO módulo, no otro módulo.
 */
export function partesSinAlcanceNuevo(planDeLaMadre, partes, { sinChoque = SIN_CHOQUE_POR_DEFECTO } = {}) {
  const permitidos = new Set(archivosDelPlan(planDeLaMadre).map(moduloAncho).filter(Boolean));
  const fuera = new Set();
  for (const parte of partes ?? []) {
    for (const archivo of archivosDelPlan(parte?.detalle)) {
      if (SIN_ALCANCE(archivo, sinChoque)) continue;
      const modulo = moduloAncho(archivo);
      if (modulo && !permitidos.has(modulo)) fuera.add(modulo);
    }
  }
  return { ok: fuera.size === 0, fuera: [...fuera] };
}
