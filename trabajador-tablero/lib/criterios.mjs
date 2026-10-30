// CRITERIOS DE ACEPTACIÓN, FUERA DE ALCANCE Y SUPUESTOS DEL PLAN (29-oct-2026). Puro: sin disco, red ni procesos.
//
// Como el spec-writer y el builder de la Software Factory (zazencodes): el plan termina con
//   CRITERIOS DE ACEPTACIÓN:  comportamientos observables, cada uno con cómo se comprueba (un comando, una página y qué
//                             muestra, o un archivo que contiene algo), comprobables por alguien que solo tiene el repo;
//   FUERA DE ALCANCE:         lo que el que construye podría querer hacer y no debe;
//   SUPUESTOS:                las decisiones del planificador donde el pedido era ambiguo, cada una con su razón.
// Quien construye comprueba cada criterio y deja la evidencia ("CRITERIO <n>: OK|FALLA — <cómo y qué mostró>"); los
// revisores la leen (el de código pide CAMBIOS si un criterio no se cumple o no tiene evidencia).
//
// El CRM decide si un plan NUEVO se aprueba solo (sin criterios o con un supuesto de negocio espera el sí del dueño):
// ESPEJO en src/features/tableros-inteligentes/services/reglas-riesgo.ts (seccionFinalDelPlan, porQueFaltanCriterios,
// porQueUnSupuestoEsDeNegocio). Si cambia una regla acá, cambiarla allá igual. Los planes viejos ya aprobados sin estas
// secciones se siguen construyendo como antes (sin criterios no se pide evidencia).

/** El texto en minúsculas, sin tildes ni espacios de más. */
const normal = (texto) =>
  String(texto ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const ENCABEZADO = /^[\s>#*_-]*(criterios de aceptacion|fuera de alcance|supuestos|preguntas abiertas)\**\s*:?\**\s*(.*)$/;
const VACIA = /^[\s*_.:\-—–]*(ningun[oa]?s?|no hay( ningun[oa]?)?|n\/a|-|—)[\s*_.!]*$/;

/** Una línea sin viñetas, numeración ni negritas. */
const limpia = (linea) =>
  String(linea ?? "")
    .replace(/^[\s>*_#-]*(?:\d+[.)]\s*)?/, "")
    .replace(/\*+/g, "")
    .trim();

/** Las líneas de una sección final ("criterios de aceptacion" | "fuera de alcance" | "supuestos"); [] si no está o dice "ninguno". */
export function seccionFinalDelPlan(plan, seccion) {
  const lineas = String(plan ?? "").replace(/\r\n/g, "\n").split("\n");
  const items = [];
  const agregar = (texto) => {
    const una = limpia(texto).replace(/\s+/g, " ");
    if (una && !VACIA.test(normal(una)) && !items.includes(una)) items.push(una);
  };
  for (let i = 0; i < lineas.length; i += 1) {
    const calce = ENCABEZADO.exec(normal(lineas[i]));
    if (!calce || calce[1] !== seccion) continue;
    if (calce[2].trim()) agregar(lineas[i].replace(/^[^:]*:\**\s*/, ""));
    for (let j = i + 1; j < lineas.length; j += 1) {
      if (!lineas[j].trim()) continue;
      if (ENCABEZADO.test(normal(lineas[j])) || /^\s*#{1,6}\s/.test(lineas[j]) || /^\s*Plan escrito con:/i.test(lineas[j])) break;
      agregar(lineas[j]);
    }
  }
  return items;
}

export const criteriosDelPlan = (plan) => seccionFinalDelPlan(plan, "criterios de aceptacion");

/** Las mismas palabras que reglas-riesgo.ts: dinero de Gestión, gasto en Meta Ads y decisiones de negocio. */
const DINERO_DE_GESTION = /\b(abono\w*|saldo\w*|nomina\w*|comision\w*|factura\w*|pago\w*|pagar\w*)\b/;
const GASTO_EN_META =
  /\b(presupuesto\w*|budget\w*|(activ\w*|encend\w*|prend\w*|lanz\w*|reanud\w*|publica\w*|cre[ao]\w*) (las |los |la |el |una |un |nuevas? |nuevos? )?(campan\w*|anuncio\w*|ads)|(subir|aumentar|subid\w*|aument\w*|crear|cree|crea) (el |un |nuevo )?gasto\w*|gasto\w* (en|de|con) (meta|anuncio\w*|publicidad|ads)|gastar en (meta|anuncio\w*|publicidad|ads))\b/;
const DECISION_DE_NEGOCIO =
  /\b(precio\w*|tarifa\w*|descuento\w*|promocion\w*|gratis|gratuit\w*|pagad[oa]s?|de pago|cobr\w*|dinero|plata|texto publico|textos publicos|publico del negocio|lo que ven los clientes|mensaje a (los )?clientes)\b/;

/** El motivo para no aprobar solo un plan NUEVO sin criterios de aceptación, o null si los trae. */
export function porQueFaltanCriterios(plan) {
  return criteriosDelPlan(plan).length ? null : "el plan no trae CRITERIOS DE ACEPTACIÓN (cómo se comprueba que quedó bien)";
}

/** El primer supuesto que es una decisión de negocio, como motivo, o null. */
export function porQueUnSupuestoEsDeNegocio(plan) {
  const supuesto = seccionFinalDelPlan(plan, "supuestos").find((linea) => {
    const texto = normal(linea);
    return DINERO_DE_GESTION.test(texto) || GASTO_EN_META.test(texto) || DECISION_DE_NEGOCIO.test(texto);
  });
  return supuesto ? `el plan supone una decisión de negocio: ${supuesto}`.slice(0, 300) : null;
}

/**
 * Lo que se le pide a quien construye cuando el plan trae criterios: comprobar cada uno y dejar la evidencia. `donde`: dónde
 * la deja ("en tu RESUMEN" en aizen1, "en el CUERPO del commit \"resultado:\"" en la nube). "" si el plan no trae criterios
 * (un plan viejo): se construye como antes.
 */
export function instruccionDeEvidencia(plan, donde) {
  const criterios = criteriosDelPlan(plan);
  if (!criterios.length) return "";
  return `CRITERIOS DE ACEPTACIÓN (${criterios.length}, están en el plan): antes de terminar comprueba CADA uno tú mismo (corre el comando, mira la página o el archivo) y deja la evidencia ${donde}, una línea por criterio: "CRITERIO <n>: OK|FALLA — <qué corriste o miraste y qué mostró>". Si uno falla, arréglalo antes de entregar.`;
}

/** Las líneas de evidencia "CRITERIO <n>: …" de un texto (el resumen o el cuerpo del commit), para los revisores. */
export function evidenciaDeCriterios(texto) {
  return String(texto ?? "")
    .split(/\r?\n/)
    .map((linea) => linea.trim())
    .filter((linea) => /^CRITERIO\s+\d+\s*:/i.test(linea));
}
