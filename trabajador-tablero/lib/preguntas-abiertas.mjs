// PREGUNTAS ABIERTAS DEL PLAN (29-oct-2026). Puro: sin disco, red ni procesos.
//
// La tarjeta ykpl83z3 tenía un plan que decía "hay que confirmarlo", "Antes de construir hay que revisar con el CRM…" y
// "Lo que no revisé y queda pendiente: …". Se aprobó solo y se construyó 4 veces en la nube (8 horas): la sesión se quedó
// parada en esa misma duda. Desde el 2-nov-2026 (un solo sí de verdad) ya no se espera al dueño: el Coordinador sigue con la
// opción recomendada de cada pregunta (seguirConLaRecomendada, abajo), lo anota en la tarjeta y le avisa en una línea.
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

// UN SOLO SÍ DE VERDAD (2-nov-2026, parte 4): las preguntas abiertas ya no frenan el plan. Cada pregunta trae su opción
// recomendada ("Recomendada: …", lo pide promptDelPlan); el Coordinador sigue con esa y lo deja anotado. Si no la trae,
// sigue con la primera opción escrita ("¿A o B?" -> A) y lo anota así. Si no hay opciones, sigue con lo que dice el plan.

/** "Recomendada: A", "(recomendado: A)", "Opción recomendada: A", "Recomiendo: A" (sobre el texto tal cual, con o sin tilde). */
const RECOMENDADA = /(?:opci[oó]n\s+)?(?:recomendad[ao]|recomiendo|sugerid[ao])\s*:\s*/i;

/** Lo que sobra alrededor de una opción: comillas, viñetas, paréntesis y puntos finales. */
const limpiaOpcion = (texto) =>
  String(texto ?? "")
    .replace(/\*+/g, "")
    .replace(/^[\s"'«“(\[:\-—–]+/, "")
    .replace(/[\s"'»”)\].;,]+$/, "")
    .trim();

/** La primera opción escrita de una pregunta: "a) X; b) Y" -> X, "¿A o B?" -> A. null si no tiene opciones. */
function primeraOpcion(pregunta) {
  const texto = String(pregunta ?? "");
  // Opciones con letra o número: "a) X, b) Y", "(1) X (2) Y", "Opción A: X / Opción B: Y".
  const conLetra = /(?:^|[\s(¿:])(?:\(?[a1]\)|opci[oó]n\s+(?:a|1)\s*[:.)-])\s*(.+?)(?=\s*(?:[,;/]|\bo\b)?\s*(?:\(?[b2]\)|opci[oó]n\s+(?:b|2)\s*[:.)-])|$)/i.exec(texto);
  if (conLetra) {
    const opcion = limpiaOpcion(conLetra[1]);
    if (opcion) return opcion;
  }
  // "¿A o B?": lo que va antes del primer " o " dentro de los signos de pregunta.
  const dentro = /¿([^?]+)\?/.exec(texto)?.[1] ?? (/\?/.test(texto) ? texto.split("?")[0] : null);
  if (dentro) {
    const partes = dentro.split(/\s+o\s+|\s*\/\s*/i);
    if (partes.length > 1) {
      const opcion = limpiaOpcion(partes[0]);
      if (opcion) return opcion;
    }
  }
  return null;
}

/**
 * La opción con que sigue el Coordinador para una pregunta abierta: { pregunta, opcion, origen }.
 *   origen "recomendada": la que trae "Recomendada: …" (la pregunta queda sin esa parte);
 *   origen "primera": no traía recomendada, es la primera opción escrita;
 *   origen "plan": no tiene opciones; opcion null (se sigue con lo que dice el plan).
 */
export function opcionDeLaPregunta(pregunta) {
  const original = String(pregunta ?? "").replace(/\s+/g, " ").trim();
  const calce = RECOMENDADA.exec(original);
  if (calce) {
    const opcion = limpiaOpcion(original.slice(calce.index + calce[0].length));
    const sinRecomendada = limpiaOpcion(original.slice(0, calce.index).replace(/[\s(\-—–]+$/, "")) || original;
    if (opcion) return { pregunta: /\?$/.test(sinRecomendada) || !/¿/.test(sinRecomendada) ? sinRecomendada : `${sinRecomendada}?`, opcion, origen: "recomendada" };
  }
  const opcion = primeraOpcion(original);
  return opcion ? { pregunta: original, opcion, origen: "primera" } : { pregunta: original, opcion: null, origen: "plan" };
}

/** Una línea de la nota del historial para una pregunta ya resuelta. */
export function lineaDeLaOpcion({ pregunta, opcion, origen }) {
  if (origen === "recomendada") return `Seguí con la opción recomendada: ${opcion} (pregunta: ${pregunta})`;
  if (origen === "primera") return `Seguí con la primera opción escrita, no traía recomendada: ${opcion} (pregunta: ${pregunta})`;
  return `Seguí con lo que dice el plan, la pregunta no traía opciones: ${pregunta}`;
}

/**
 * Las preguntas abiertas del plan resueltas con su opción recomendada (o la primera): { elegidas, nota, aviso } o null si el
 * plan no tiene preguntas. `nota`: una línea por pregunta, para el historial de la tarjeta (va arriba del plan). `aviso`: UNA
 * línea corta para el dueño, que solo informa (no espera respuesta).
 */
export function seguirConLaRecomendada(plan, titulo = "") {
  const preguntas = preguntasAbiertasDelPlan(plan);
  if (!preguntas.length) return null;
  const elegidas = preguntas.map(opcionDeLaPregunta);
  const nota = elegidas.map(lineaDeLaOpcion).join("\n");
  const [primera] = elegidas;
  const corta = (texto, n) => (texto.length > n ? `${texto.slice(0, n - 1)}…` : texto);
  const queSegui = primera.opcion ? `seguí con ${primera.origen === "recomendada" ? "la opción recomendada" : "la primera opción"}: ${corta(primera.opcion, 120)}` : "seguí con lo que dice el plan";
  const mas = elegidas.length > 1 ? ` (y ${elegidas.length - 1} pregunta(s) más, en la tarjeta)` : "";
  const aviso = `Solo para que sepas: el plan de "${corta(String(titulo ?? "").replace(/\s+/g, " ").trim(), 100)}" tenía una pregunta abierta y ${queSegui}${mas}. No tienes que responder.`;
  return { elegidas, nota, aviso };
}
