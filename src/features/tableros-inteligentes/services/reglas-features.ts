/*
  REGLA FEATURES (23-nov-2026, decisión de Alexander): lo que cuelga del área Features se aprueba, se construye y sube solo,
  en todas las zonas (dinero de Gestión, libro V3, bot de ventas, chats y Meta Ads), con UNA excepción: lo que suba presupuesto,
  prenda campañas o cree gasto nuevo en Meta Ads sigue esperando el sí de Alexander.

  Funciones puras, sin base ni Next (prueba: npm run test:features-auto-aprobar). Se mantienen: la bitácora (HistorialTarjeta),
  el riesgo escrito en cada tarjeta y la vigilancia de 30 minutos tras subir (con reversión sola si algo falla).

  PARA APAGARLO: poner FEATURES_AUTO_APROBAR en false (un solo lugar). Fuera de Features todo sigue igual.
*/

import { gastoDeclaradoEnElPlan, normalizar, preguntasAbiertasDelPlan, rutasDelTexto, seccionFinalDelPlan } from "./reglas-riesgo";

/** El interruptor de TODA la regla. false = todo como antes de esta regla. */
export const FEATURES_AUTO_APROBAR = true;

/** El tablero (Empresa Magilus) donde vive el área Features. Se usan ids, nunca nombres. */
export const TABLERO_DE_FEATURES_ID = "cmvg35cqq001i2io6q1hfwvio";
/** La tarjeta "Features" (T-736): todo lo que cuelga de ella, a cualquier profundidad, entra en la regla. */
export const TARJETA_AREA_FEATURES_ID = "cmwbcu28700b732qmru2nd890";

/** Lo que queda escrito en `despues.como` y `despues.regla` de la aprobación de la regla. */
export const COMO_REGLA_FEATURES = "regla-features";
/** "Vía" interna (solo en memoria) de una aprobación de la regla: deja arrancar en todas las zonas. */
export const VIA_REGLA_FEATURES = "automatica-features";

export const TEXTO_REGLA_FEATURES = "aprobado solo: la tarjeta cuelga de Features (regla del dueño 23-nov)";

/**
 * ¿Esta tarjeta cae en la regla? Debe ser del tablero de Features, tener un repo de código y colgar (a cualquier profundidad)
 * de la tarjeta Área Features. `ancestros` = sus madres de la más cercana a la más lejana (SQL_ANCESTROS).
 * Una tarjeta fuera de Features, o sin repo (no es de código, como T-266), nunca entra.
 */
export function esDeFeatures(
  datos: { tableroId: string; repo: string | null | undefined; ancestros: readonly string[] },
  activa: boolean = FEATURES_AUTO_APROBAR,
): boolean {
  if (!activa) return false;
  if (!datos.repo) return false;
  return datos.tableroId === TABLERO_DE_FEATURES_ID && datos.ancestros.includes(TARJETA_AREA_FEATURES_ID);
}

/* ──────────────────────────────────────────── gasto de VERDAD en Meta Ads (excepción) ── */

/*
  El chequeo viejo marcaba "gasto en Meta Ads" por palabras sueltas del plan. T-845 y T-855 solo MENCIONABAN la regla
  ("sigue esperando si sube presupuesto...") y quedaron frenadas. Acá se mira lo que la tarjeta de verdad hace:
  1. una línea "GASTO EN META ADS: <algo>" que afirma un gasto (no "ninguno" ni una mención de la regla);
  2. una frase que ORDENA subir presupuesto / prender o crear campañas o anuncios / crear gasto (no una que la niega o habla de la regla);
  3. archivos de Meta Ads (pauta) que ESCRIBEN en Meta: presupuesto, campañas, anuncios, publicar, activar, crear.
*/

/** La frase habla de la regla o la niega: no es una orden de gastar. */
const MENCION_DE_LA_REGLA =
  /\b(regla\w*|excepcion\w*|chequeo\w*|revision de gasto|falso positivo\w*|detect\w*|menciona\w*|sigue(n)? (esperando|pidiendo)|queda(n)? (como hoy|esperando)|se mantiene\w*|espera(n)? (el |tu )?si|pide(n)? (el |tu )?si|no (se )?(sub\w*|tocar?\w*|prend\w*|cre\w*|activ\w*|gast\w*|cambi\w*|modific\w*|escrib\w*|publica\w*|aument\w*|mueve\w*|incluye\w*)|sin (sub\w*|toc\w*|prend\w*|cre\w*|activ\w*|gast\w*|cambi\w*|modific\w*|escrib\w*|publica\w*|presupuesto)|nunca|ni (sub\w*|prend\w*|cre\w*|activ\w*|gast\w*)|ningun\w*|evit\w*)\b/;

/**
 * Una ORDEN de gastar: un verbo que sube o crea (subir, aumentar, crear, activar, prender, lanzar, publicar) sobre el presupuesto,
 * el gasto, las campañas o los anuncios. Más estricta que las palabras sueltas de reglas-riesgo.ts: "el gasto en Meta Ads de ayer"
 * (leer) o "presupuesto" a secas (mencionar) no cuentan.
 */
const ORDEN_DE_GASTO =
  /\b((sub\w*|aument\w*|increment\w*|elev\w*|duplic\w*|ampli\w*|cambi\w*|modific\w*|ajust\w*|edit\w*|actualiz\w*|fij\w*|defin\w*|cre[ao]\w*|gener\w*|configur\w*) (el |los |la |las |un |una |nuevo |nueva |nuevos |nuevas |mas )*(presupuesto\w*|budget\w*|gasto\w*)|(activ\w*|encend\w*|prend\w*|lanz\w*|reanud\w*|publica\w*|cre[ao]\w*|duplic\w*) (las |los |la |el |una |un |nuevas? |nuevos? |todas? las |todos los )*(campan\w*|anuncio\w*|ads|conjunto\w*))\b/;

/** Las líneas que cuentan del texto: sin "FUERA DE ALCANCE" ni "CRITERIOS DE ACEPTACIÓN" (ahí se dice lo que NO se hace o cómo se prueba). */
function lineasQueCuentan(texto: string): string[] {
  const lineas = texto.replace(/\r\n/g, "\n").split("\n");
  const aparte = new Set<string>(
    [...seccionFinalDelPlan(texto, "fuera de alcance"), ...seccionFinalDelPlan(texto, "criterios de aceptacion"), ...seccionFinalDelPlan(texto, "preguntas abiertas")].map((l) => normalizar(l)),
  );
  // La nota que deja el CRM al aprobar sola (decisionDelCoordinador) repite las preguntas: tampoco cuenta.
  return lineas.filter((linea) => {
    const limpia = normalizar(linea.replace(/^[\s>*_#-]*(?:\d+[.)]\s*)?/, "").replace(/\*+/g, ""));
    return !aparte.has(limpia) && !limpia.startsWith("decision del coordinador");
  });
}

/** Archivo de Meta Ads (pauta) que ESCRIBE en Meta (presupuesto, campañas, anuncios): no los de lectura, pruebas ni documentos. */
const ARCHIVO_DE_META = /(^|\/)(pauta|meta-?ads|ads|anuncios)\//;
const NOMBRE_QUE_ESCRIBE = /(presupuesto|budget|campan|anuncio|adset|publicar|activar|prender|crear|escritur|escribir|mutacion|pausar|lanzar)/;
const NOMBRE_QUE_NO_ESCRIBE = /(lectura|leer|\.test\.|\.spec\.|check-|^readme|\.md$|\.mjs$|tipos?\b|types?\b)/;

/** Los archivos de la lista que escriben gasto en Meta Ads (cada uno tal cual). */
export function archivosQueGastanEnMeta(archivos: readonly string[]): string[] {
  return archivos.filter((ruta) => {
    const limpia = normalizar(String(ruta).replace(/\\/g, "/")).replace(/^\.\//, "");
    const nombre = limpia.split("/").pop() ?? "";
    return ARCHIVO_DE_META.test(limpia) && NOMBRE_QUE_ESCRIBE.test(nombre) && !NOMBRE_QUE_NO_ESCRIBE.test(nombre);
  });
}

/**
 * ¿Esto SUBE presupuesto, prende campañas o crea gasto nuevo en Meta Ads de verdad? Devuelve el motivo en una línea o null.
 * `plan`, `titulo`, `detalle` y `esperaPor` son texto libre (se ignoran las frases que mencionan o niegan la regla);
 * `archivos` son los que cambia la tarjeta (los del resultado y las rutas que nombra el plan).
 */
export function gastoDeVerdadEnMetaAds(datos: {
  plan?: string | null;
  titulo?: string | null;
  detalle?: string | null;
  esperaPor?: string | null;
  archivos?: readonly string[] | null;
}): string | null {
  const textos = [datos.titulo, datos.detalle, datos.plan, datos.esperaPor].filter((t): t is string => typeof t === "string" && t.trim() !== "");
  for (const texto of textos) {
    const declarado = gastoDeclaradoEnElPlan(texto);
    if (declarado && !MENCION_DE_LA_REGLA.test(normalizar(declarado))) return `el plan declara ${declarado}`.slice(0, 300);
    for (const linea of lineasQueCuentan(texto)) {
      // Cada frase por separado: una frase que niega no tapa a la que ordena.
      for (const frase of linea.split(/(?<=[.;!?])\s+/)) {
        const normal = normalizar(frase);
        // La línea "GASTO EN META ADS: ..." ya se juzgó arriba (gastoDeclaradoEnElPlan).
        if (/^[\s>*_#-]*gasto en meta ads/.test(normal)) continue;
        if (!ORDEN_DE_GASTO.test(normal) || MENCION_DE_LA_REGLA.test(normal)) continue;
        return `habla de subir presupuesto, prender campañas o crear gasto en Meta Ads (${frase.replace(/\s+/g, " ").trim().slice(0, 120)})`;
      }
    }
  }
  const archivos = [...(datos.archivos ?? []), ...(datos.plan ? rutasDelTexto(datos.plan) : [])];
  const escribe = archivosQueGastanEnMeta(archivos);
  if (escribe.length) return `cambia archivos que escriben gasto en Meta Ads (${escribe.slice(0, 3).join(", ")})`;
  return null;
}

/* ────────────────────────────────────────────────────────── lo que queda escrito ── */

/** Lo que queda en `HistorialTarjeta.despues` de la aprobación de la regla: vía automática, como 'regla-features'. */
export function registroDeAprobacionFeatures(datos: { estado: "APROBADO" | "PLAN_APROBADO"; momento: "tarea" | "plan"; motivo: string }) {
  return {
    estado: datos.estado,
    momento: datos.momento,
    via: "automatica",
    quienNombre: "Aprobación automática",
    userId: "sistema:aprobacion-automatica",
    textoConfirmacion: TEXTO_REGLA_FEATURES,
    como: COMO_REGLA_FEATURES,
    automatica: true,
    regla: COMO_REGLA_FEATURES,
    motivo: datos.motivo,
  };
}

/**
 * La nota que queda en la tarjeta cuando un plan con riesgo ALTO o preguntas abiertas pasa solo a construir: el Coordinador
 * sigue con la opción recomendada. Va al final del plan y al historial. null si el plan no trae nada que decidir.
 */
export function decisionDelCoordinador(plan: string, riesgo: string | null | undefined): string | null {
  const preguntas = preguntasAbiertasDelPlan(plan);
  const necesito = plan.replace(/\r\n/g, "\n").split("\n").find((linea) => /^[\s>*_#-]*\**necesito\**\s*:/i.test(linea));
  const alto = riesgo === "ALTO";
  if (!preguntas.length && !necesito && !alto) return null;
  const partes: string[] = [];
  if (preguntas.length) partes.push(`preguntas abiertas: ${preguntas.join(" | ")}`);
  if (necesito) partes.push(necesito.replace(/^[\s>*_#-]*\**/, "").replace(/\*+/g, "").trim());
  if (alto) partes.push("riesgo ALTO");
  return `DECISIÓN DEL COORDINADOR (regla Features, 23-nov): pasa a construir sin esperar a nadie. ${partes.join("; ")}. El Coordinador sigue con la opción recomendada de su plan.`.slice(0, 1500);
}
