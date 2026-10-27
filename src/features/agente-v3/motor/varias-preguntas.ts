import { normalizar, type Accion, type ReglaV3 } from "../domain/reglas";

/**
 * VARIAS PREGUNTAS EN UN MENSAJE: se contestan todas, en un solo mensaje corto.
 *
 * Caso real (26-oct-2026, combo de camillas): la clienta escribió "Materiales garantía y envío los
 * costos es gratis??". Las tres reglas de tema encajaban, ganó solo "Pregunta por la garantía" y
 * nunca se le contestó materiales ni envío; dejó de escribir.
 *
 * Esto NO cambia el desempate. Solo: cuando la regla que gana es de tema y hay otras de tema (o una
 * que pasa a una asesora) que también encajaron, sus textos se juntan. No se inventa nada: cada
 * línea sale de lo que ya dice la regla.
 */

/** Tope de líneas en el mensaje: más que eso ya no es corto. */
const MAX_LINEAS = 5;
/** Largo máximo de la línea de un tema. */
const MAX_LARGO_DE_LINEA = 140;

/** Política temporal (9-oct-2026): ninguna línea ni cierre puede ofrecer contraentrega. */
const MENCIONA_CONTRAENTREGA = /contra\s*entrega|contraentrega|pago al recibir|paga al recibir/;

const SOLO_MENSAJES = new Set<Accion["tipo"]>(["mensaje", "responder_con_ia"]);
const SOLO_ASESORA = new Set<Accion["tipo"]>(["mensaje", "avisar_asesor", "pausar_ia"]);

/** Reglas que no son una pregunta informativa aunque solo manden texto (saludos, gracias...). */
const NOMBRE_QUE_NO_ES_DE_TEMA = /saludo|hola|gracias|despedid|cerr|compr|dato/;

/**
 * ¿Es una regla de pregunta informativa (envío, garantía, materiales, peso, colores, entrega...)?
 *
 * Es de frase (no exacta) o de intención, y solo contesta: texto fijo o "responder con IA". Nada que
 * mueva el producto, el paso, la etapa ni avise a nadie: esas no se mezclan.
 */
export function esReglaDeTema(regla: ReglaV3): boolean {
  if (!regla.activa) return false;
  if (regla.cuando.tipo === "frase" ? regla.cuando.exacta === true : regla.cuando.tipo !== "intencion") return false;
  if (regla.entonces.length === 0 || !regla.entonces.every((accion) => SOLO_MENSAJES.has(accion.tipo))) return false;
  return !NOMBRE_QUE_NO_ES_DE_TEMA.test(normalizar(regla.nombre));
}

/**
 * ¿Es una regla que contesta y pasa a una asesora (precio de otro producto, foto)? Se junta con las
 * de tema: ellas se contestan y solo esta parte pasa a la asesora.
 */
export function esReglaQuePasaALaAsesora(regla: ReglaV3): boolean {
  if (!regla.activa) return false;
  if (regla.cuando.tipo === "frase" ? regla.cuando.exacta === true : regla.cuando.tipo !== "intencion") return false;
  if (!regla.entonces.some((accion) => accion.tipo === "avisar_asesor")) return false;
  return regla.entonces.every((accion) => SOLO_ASESORA.has(accion.tipo));
}

function textosDe(regla: ReglaV3): string[] {
  return regla.entonces.flatMap((accion) => (accion.tipo === "mensaje" && accion.texto?.trim() ? [accion.texto] : []));
}

/** Las frases de un texto, sin la pregunta final ni los saludos sueltos. */
function frasesInformativas(texto: string): string[] {
  const lineas = texto.split(/\n+/).map((linea) => linea.trim()).filter(Boolean);
  const salida: string[] = [];
  for (const linea of lineas) {
    const sinPregunta = linea.replace(/¿[^?]*\?/g, "").replace(/[^.!?\n]*\?/g, "").trim();
    const frases = sinPregunta.match(/[^.!?]+[.!?]*/g) ?? [];
    for (const frase of frases) {
      const limpia = frase.trim().replace(/^[,;\s]+/, "");
      if (limpia.length < 4) continue;
      // "Hola", "Claro que sí" y cosas así no son información.
      if (/^(hola|claro|listo|perfecto|con gusto|mientras tanto)\b/.test(normalizar(limpia)) && limpia.length < 25) continue;
      if (MENCIONA_CONTRAENTREGA.test(normalizar(limpia))) continue;
      salida.push(limpia);
    }
    if (salida.length > 0) break; // la primera línea con algo útil
  }
  return salida;
}

/** La línea corta de un tema: la primera frase útil (y la siguiente si cabe). */
export function lineaDeLaRegla(regla: ReglaV3): string | null {
  for (const texto of textosDe(regla)) {
    const frases = frasesInformativas(texto);
    if (frases.length === 0) continue;
    let linea = frases[0];
    if (frases[1] && linea.length + frases[1].length < MAX_LARGO_DE_LINEA - 20) linea = `${linea} ${frases[1]}`;
    return linea.trim();
  }
  return null;
}

/** Una pregunta de avance escrita en la regla (la primera que no ofrezca contraentrega). */
export function preguntaDeCierre(regla: ReglaV3): string | null {
  for (const texto of [...textosDe(regla)].reverse()) {
    const preguntas = texto.match(/¿[^?]*\?/g) ?? [];
    for (const pregunta of [...preguntas].reverse()) {
      if (!MENCIONA_CONTRAENTREGA.test(normalizar(pregunta))) return pregunta.trim();
    }
  }
  return null;
}

const TIENE_EMOJI = /^\s*\p{Extended_Pictographic}/u;

function emojiDelTema(regla: ReglaV3, linea: string): string {
  const texto = normalizar(`${regla.nombre} ${linea}`);
  if (/envio|domicilio|despach|flete/.test(texto)) return "🚚";
  if (/garantia/.test(texto)) return "✅";
  if (/material|cuero|tela|tex|estructura|metal|espuma/.test(texto)) return "🪑";
  if (/peso|soporta|kilo|\bkg\b/.test(texto)) return "🏋️";
  if (/color|colores/.test(texto)) return "🎨";
  if (/entrega|tiempo|dias|demora/.test(texto)) return "⏱️";
  if (/asesor/.test(texto)) return "👨🏻‍💻";
  if (/precio|valor|vale|cuesta/.test(texto)) return "💰";
  return "👉";
}

export type MezclaDeTemas = {
  acciones: Accion[];
  /** Las reglas que quedaron dentro del mensaje, en el orden de las líneas. */
  juntas: ReglaV3[];
};

/**
 * Junta las reglas que contestan. `ordenadas` viene del desempate (la ganadora primero).
 * Devuelve null si no corresponde mezclar: entonces el motor sigue como siempre.
 */
export function mezclarTemas(ordenadas: ReglaV3[]): MezclaDeTemas | null {
  const ganadora = ordenadas[0];
  if (!ganadora) return null;
  const temas = ordenadas.filter(esReglaDeTema);
  const asesoras = ordenadas.filter(esReglaQuePasaALaAsesora);
  // La que manda tiene que ser de las que se juntan; si ganó otra cosa (mover de paso, catálogo...), todo sigue igual.
  if (!temas.includes(ganadora) && !asesoras.includes(ganadora)) return null;
  if (temas.length === 0 || temas.length + Math.min(asesoras.length, 1) < 2) return null;

  const asesora = asesoras[0];
  const lineas: Array<{ regla: ReglaV3; texto: string }> = [];
  const guiasIA: string[] = [];
  const juntas: ReglaV3[] = [];
  for (const regla of [...temas, ...(asesora ? [asesora] : [])]) {
    if (regla.entonces.some((accion) => accion.tipo === "responder_con_ia")) {
      for (const accion of regla.entonces) {
        if (accion.tipo === "responder_con_ia") guiasIA.push(accion.guia);
      }
      const dato = lineaDeLaRegla(regla);
      if (dato) lineas.push({ regla, texto: dato });
      juntas.push(regla);
      continue;
    }
    const linea = lineaDeLaRegla(regla);
    if (!linea) {
      // Sin línea propia, la que pasa a la asesora igual cuenta: su aviso se hace.
      if (regla === asesora) juntas.push(regla);
      continue;
    }
    if (lineas.some((otra) => normalizar(otra.texto) === normalizar(linea))) continue;
    lineas.push({ regla, texto: linea });
    juntas.push(regla);
  }
  if (juntas.length < 2 || lineas.length + guiasIA.length === 0) return null;

  const cierre = [ganadora, ...juntas].map(preguntaDeCierre).find((pregunta): pregunta is string => Boolean(pregunta));
  const cuerpo = lineas
    .slice(0, MAX_LINEAS)
    .map(({ regla, texto }) => (TIENE_EMOJI.test(texto) ? texto : `${emojiDelTema(regla, texto)} ${texto}`));

  const acciones: Accion[] = [];
  if (guiasIA.length > 0) {
    // Con "responder con IA" no se mezcla a ciegas un texto fijo con uno de IA: se le pasa todo junto.
    acciones.push({
      tipo: "responder_con_ia",
      guia: [
        "El cliente hizo varias preguntas juntas. Contéstalas TODAS en UN solo mensaje corto: una línea por pregunta, cada una con un emoji, sin párrafos largos y sin inventar datos.",
        cuerpo.length ? `Datos ya escritos en las reglas:\n${cuerpo.join("\n")}` : "",
        ...guiasIA.map((guia, indice) => `Guía de la regla ${indice + 1}: ${guia}`),
        cierre ? `Cierra con una sola pregunta: ${cierre}` : "Cierra con una sola pregunta que avance la venta.",
        "No ofrezcas pago contraentrega.",
      ]
        .filter(Boolean)
        .join("\n"),
    });
  } else {
    acciones.push({ tipo: "mensaje", texto: [...cuerpo, ...(cierre ? [cierre] : [])].join("\n") });
  }
  // Lo que necesita una asesora (aviso y pausa) se hace aparte, solo por esa regla.
  if (asesora && juntas.includes(asesora)) {
    for (const accion of asesora.entonces) {
      if (accion.tipo === "avisar_asesor" || accion.tipo === "pausar_ia") acciones.push(accion);
    }
  }
  return { acciones, juntas };
}
