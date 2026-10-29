// PREGUNTAS ABIERTAS DEL PLAN (29-oct-2026). Puro: sin disco, red ni procesos.
//
// La tarjeta ykpl83z3 tenía un plan que decía "hay que confirmarlo", "Antes de construir hay que revisar con el CRM…" y
// "Lo que no revisé y queda pendiente: …". Se aprobó solo y se construyó 4 veces en la nube (8 horas): la sesión se quedó
// parada en esa misma duda. Un plan con preguntas abiertas no se construye: espera al dueño.
//
// La instrucción de planear (etapas.mjs: promptDelPlan) pide una sección final "PREGUNTAS ABIERTAS:" (o "ninguna").
// Esta función la lee y además busca las frases que delatan una duda sin resolver aunque la sección no esté.
// ESPEJO: src/features/tableros-inteligentes/services/reglas-riesgo.ts (preguntasAbiertasDelPlan). Si cambia una regla
// acá, cambiarla allá igual.

/** El texto en minúsculas, sin tildes (para comparar frases). */
const normal = (texto) =>
  String(texto ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/** El encabezado de la sección: "PREGUNTAS ABIERTAS:", "## Preguntas abiertas", "**PREGUNTAS ABIERTAS:** …". */
const ENCABEZADO = /^[\s>#*_-]*preguntas abiertas\**\s*:?\**\s*(.*)$/;

/** Lo que dice que la sección está vacía. */
const NINGUNA = /^[\s*_.:\-—–]*(ninguna?s?|no hay( ninguna?)?|sin preguntas( abiertas)?|n\/a|-|—)[\s*_.!]*$/;

/** Las frases que delatan una duda sin resolver (sobre el texto normalizado, sin tildes). */
export const FRASES_DE_DUDA = [
  /hay que confirmar/,
  // "queda pendiente" solo al final de la línea o antes de ":" (una venta "queda pendiente de pago" no es una duda).
  /quedan? pendientes?\s*(?::|$)/,
  /pendientes? de (?:confirmar|revisar|decidir|comprobar|definir)/,
  /no pude (?:comprobar|confirmar|verificar|revisar)/,
  /lo que no revise/,
  /antes de construir hay que/,
  /falta (?:decidir|confirmar|definir)/,
];

/** Una línea sin viñetas, numeración ni negritas. */
const limpia = (linea) =>
  String(linea ?? "")
    .replace(/^[\s>*_#-]*(?:\d+[.)]\s*)?/, "")
    .replace(/\*+/g, "")
    .trim();

/** ¿Es el encabezado de otra sección (markdown, o "6. Cómo se va a probar")? */
const esOtroEncabezado = (linea) => /^\s*#{1,6}\s/.test(linea) || /^\s*\**\s*\d+[.)]\s+\**[A-ZÁÉÍÓÚ]/.test(linea) || /^\s*Plan escrito con:/i.test(linea);

/**
 * Las preguntas abiertas del plan, en orden (vacío si no tiene ninguna). Cada una en una línea:
 *   1. lo que trae la sección "PREGUNTAS ABIERTAS:" (salvo "ninguna");
 *   2. las líneas con una frase de duda ("hay que confirmar", "queda pendiente"…). Si la línea termina en ":" (una
 *      lista sigue abajo), se le junta la primera línea de la lista.
 */
export function preguntasAbiertasDelPlan(plan) {
  const lineas = String(plan ?? "").replace(/\r\n/g, "\n").split("\n");
  const preguntas = [];
  const agregar = (texto) => {
    const una = limpia(texto).replace(/\s+/g, " ");
    if (una && !preguntas.includes(una)) preguntas.push(una);
  };
  for (let i = 0; i < lineas.length; i += 1) {
    const calce = ENCABEZADO.exec(normal(lineas[i]));
    if (!calce) continue;
    // Lo que va en la misma línea del encabezado ("PREGUNTAS ABIERTAS: ninguna" o la pregunta misma).
    const enLaLinea = lineas[i].replace(/^[\s>#*_-]*preguntas abiertas\**\s*:?\**\s*/i, "");
    if (calce[1].trim() && !NINGUNA.test(calce[1])) agregar(enLaLinea);
    for (let j = i + 1; j < lineas.length; j += 1) {
      if (!lineas[j].trim()) continue;
      // Dentro de la sección una lista numerada ("1. ¿…?") son preguntas: solo corta un encabezado markdown o la firma.
      if (/^\s*#{1,6}\s/.test(lineas[j]) || /^\s*Plan escrito con:/i.test(lineas[j])) break;
      if (!NINGUNA.test(normal(lineas[j]))) agregar(lineas[j]);
    }
  }
  for (let i = 0; i < lineas.length; i += 1) {
    const texto = normal(lineas[i]);
    if (ENCABEZADO.test(texto) || !FRASES_DE_DUDA.some((frase) => frase.test(texto))) continue;
    let pregunta = limpia(lineas[i]);
    if (/:\s*$/.test(pregunta)) {
      const siguiente = lineas.slice(i + 1).find((linea) => linea.trim());
      if (siguiente && !esOtroEncabezado(siguiente)) pregunta = `${pregunta} ${limpia(siguiente)}`;
    }
    agregar(pregunta);
  }
  return preguntas;
}

/** La primera pregunta abierta, en una línea de máximo `n` caracteres; null si el plan no tiene. */
export function primeraPreguntaAbierta(plan, n = 300) {
  const [primera] = preguntasAbiertasDelPlan(plan);
  if (!primera) return null;
  return primera.length > n ? `${primera.slice(0, n - 1)}…` : primera;
}
