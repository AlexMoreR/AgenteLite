/*
  RESUMEN CORTO de la ficha del Tablero IA (23-oct-2026, pedido de Alexander): arriba de la ficha solo 2
  o 3 líneas en lenguaje sencillo de qué hace el cambio; todo lo técnico va en "Ver detalles".

  Función pura, sin base ni Next (pruebas: npm run test:tableros). Sale de las primeras líneas útiles de
  resultado.resumen, o del plan (sección "Qué se cambia"), o del detalle de la tarjeta, sin markdown y
  sin frases de relleno del trabajador ("Espero a que terminen los subagentes"). Máximo ~300 caracteres.
*/

export const MAXIMO_DEL_RESUMEN_CORTO = 300;

/** Frases de relleno del trabajador que no dicen qué hace el cambio. */
const RELLENO = [
  /\b(espero|esperando|esperé)\b.*\b(subagentes?|agentes?|terminen|termine)\b/i,
  /\b(ahora|voy a|vamos a|procedo a|a continuaci[oó]n)\b.*\b(revisar|verificar|correr|ejecutar|lanzar|esperar)\b/i,
  /^(listo|hecho|perfecto|claro|entendido|ok)[.!:, ]*$/i,
  /^(resumen|plan|resultado)[.:]?$/i,
  /^aqu[ií] (est[aá]|va|tienes)\b/i,
  /^(me|te) (cuento|explico)\b/i,
];

/** Texto sin markdown: encabezados, negritas, código, links, viñetas y numeración. */
export function sinMarkdown(linea: string): string {
  return linea
    .replace(/^\s{0,3}#{1,6}\s*/, "")
    .replace(/^\s*(?:[-*+•]|\d+[.)])\s+/, "")
    .replace(/^\s*>\s?/, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(^|[\s(])[*_]([^*_]+)[*_](?=[\s).,;:]|$)/g, "$1$2")
    .replace(/`+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** ¿La línea es solo adorno o relleno (separadores, tablas, frases sin contenido)? */
function esRelleno(limpia: string, original: string): boolean {
  if (limpia.length < 12) return true;
  if (/^[-=_*|:\s]+$/.test(original)) return true;
  if (/^```/.test(original.trim())) return true;
  return RELLENO.some((patron) => patron.test(limpia));
}

/** Las líneas útiles (sin markdown ni relleno) de un texto. */
function lineasUtiles(texto: string): string[] {
  const lineas: string[] = [];
  let enBloqueDeCodigo = false;
  for (const original of texto.replace(/\r\n/g, "\n").split("\n")) {
    if (/^\s*```/.test(original)) {
      enBloqueDeCodigo = !enBloqueDeCodigo;
      continue;
    }
    if (enBloqueDeCodigo) continue;
    const limpia = sinMarkdown(original);
    if (!esRelleno(limpia, original)) lineas.push(limpia);
  }
  return lineas;
}

/** La sección "Qué se cambia" del plan (hasta el siguiente encabezado), o null si no la tiene. */
export function seccionQueSeCambia(plan: string): string | null {
  const lineas = plan.replace(/\r\n/g, "\n").split("\n");
  const inicio = lineas.findIndex((linea) => /^\s{0,3}(?:#{1,6}\s*)?(?:\*\*)?\s*qu[eé] se cambia\b/i.test(linea));
  if (inicio < 0) return null;
  const cuerpo: string[] = [];
  // Si el título trae texto en la misma línea ("Qué se cambia: ..."), cuenta.
  const mismaLinea = lineas[inicio].replace(/^\s{0,3}(?:#{1,6}\s*)?(?:\*\*)?\s*qu[eé] se cambia\s*(?:\*\*)?\s*:?\s*(?:\*\*)?/i, "");
  if (mismaLinea.trim()) cuerpo.push(mismaLinea);
  for (const linea of lineas.slice(inicio + 1)) {
    if (/^\s{0,3}#{1,6}\s/.test(linea)) break;
    cuerpo.push(linea);
  }
  const texto = cuerpo.join("\n").trim();
  return texto || null;
}

/** Junta líneas hasta ~maximo caracteres; corta en palabra y pone "…" si quedó algo afuera. */
function juntar(lineas: string[], maximo: number): { texto: string; cortado: boolean } {
  let texto = "";
  for (let i = 0; i < lineas.length; i += 1) {
    const siguiente = texto ? `${texto} ${lineas[i]}` : lineas[i];
    if (siguiente.length <= maximo) {
      texto = siguiente;
      continue;
    }
    if (!texto) {
      const corte = siguiente.slice(0, maximo);
      const espacio = corte.lastIndexOf(" ");
      texto = `${(espacio > maximo * 0.6 ? corte.slice(0, espacio) : corte).replace(/[\s,;:.]+$/, "")}…`;
    }
    return { texto, cortado: true };
  }
  return { texto, cortado: false };
}

export type ResumenCorto = {
  texto: string;
  /** De dónde salió: lo que hizo el trabajador, el plan, o el detalle de la tarjeta. */
  fuente: "resultado" | "plan" | "detalle";
  /** Quedó texto afuera (el completo está en "Ver detalles"). */
  cortado: boolean;
};

/**
 * El resumen corto de una tarjeta: primero lo que hizo el trabajador (resultado.resumen), si no, la
 * sección "Qué se cambia" del plan (o sus primeras líneas), si no, el detalle de la tarjeta. null si no
 * hay nada útil que decir.
 */
export function resumenCorto(
  datos: { resultadoResumen?: string | null; plan?: string | null; detalle?: string | null },
  maximo = MAXIMO_DEL_RESUMEN_CORTO,
): ResumenCorto | null {
  const candidatos: { fuente: ResumenCorto["fuente"]; texto: string | null | undefined }[] = [
    { fuente: "resultado", texto: datos.resultadoResumen },
    { fuente: "plan", texto: datos.plan ? (seccionQueSeCambia(datos.plan) ?? datos.plan) : null },
    { fuente: "detalle", texto: datos.detalle },
  ];
  for (const { fuente, texto } of candidatos) {
    if (!texto?.trim()) continue;
    const lineas = lineasUtiles(texto);
    if (!lineas.length) continue;
    const { texto: corto, cortado } = juntar(lineas, maximo);
    if (corto) return { texto: corto, fuente, cortado };
  }
  return null;
}
