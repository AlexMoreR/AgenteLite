// TARJETAS REPETIDAS ANTES DE PLANEAR (27-nov-2026, parte 2 de «Coordinador: detectar tarjetas repetidas antes de planear»).
// Antes de gastar una sesión en planear, el Coordinador mira si otra tarjeta del mismo tablero y repo ya pide lo mismo:
//   - compararTarjetas: "igual", "posible" o "distinta", por las palabras del título (palabrasDelTitulo, git.mjs) y los archivos
//     que nombran el detalle y el plan (archivosDeTexto / archivosDelPlan, choques.mjs);
//   - decidirRepetida: qué hacer con la lista de /parecidas del CRM (ya-hecha, repetida, posible, esperar o seguir);
//   - revisarRepetidas: pide /parecidas, decide y hace la llamada al CRM que toca. Nunca frena el trabajo: si algo falla, se planea igual.
// En esta parte el bucle todavía no la llama (eso es la parte 3).
import { archivosDeTexto, archivosDelPlan, noChoca } from "./choques.mjs";
import { REPETIDAS_POR_DEFECTO } from "./config.mjs";
import { enUnaLinea } from "./diagnostico.mjs";
import { commitEstaEnMain } from "./etapas.mjs";
import { palabrasDelTitulo } from "./git.mjs";

/** Las que todavía no se empezaron a construir: entre dos de estas, se cierra la más nueva. */
const PENDIENTES = new Set(["IDEA", "POR_APROBAR", "APROBADO", "PLANEANDO", "PLAN_LISTO", "PLAN_APROBADO"]);
/** Las que ya se están construyendo o subiendo (POR_REVISAR ya está construida y espera para subir): esta espera a la otra. */
const EN_MARCHA = new Set(["EN_CURSO", "POR_REVISAR", "SUBIENDO"]);
/** Las que terminaron mal: un "igual" con una de estas no se cierra solo, decide el dueño. */
const TERMINADAS_MAL = new Set(["ERROR", "FALLIDO"]);

/** Un título para comparar tal cual: minúsculas, sin tildes, sin signos y sin los prefijos "Parte N" (o "parte N de M") ni "T-123". */
export function normalizarTitulo(titulo) {
  return String(titulo ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\bparte\s+\d+(\s+de\s+\d+)?\b/g, " ")
    .replace(/\bt-\d+\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Los archivos que nombran el detalle y el plan, sin el manual ni las notas de cambios pendientes (los nombran casi todas). */
function archivosDeLaTarjeta(tarjeta) {
  const todos = new Set([...archivosDeTexto(String(tarjeta?.detalle ?? "")), ...archivosDelPlan(tarjeta?.plan ?? "")]);
  return [...todos].filter((ruta) => !noChoca(ruta, []));
}

const porciento = (fraccion) => `${Math.round(fraccion * 100)} %`;

/**
 * ¿Las dos tarjetas piden lo mismo? `umbrales`: config.repetidas (fracciones de las palabras del título). La fracción que cuenta
 * es la menor de las dos direcciones (las comunes sobre las palabras de cada una), así un título corto no "cubre" a uno largo.
 *  - "igual": el título normalizado es idéntico; o comparten igualPalabras o más; o igualConArchivo o más y un archivo en común.
 *  - "posible": comparten posibleSinArchivo o más sin archivo en común; o posibleConArchivo o más con un archivo en común.
 *  - "distinta": todo lo demás.
 * -> { nivel, porque, fraccion, archivo? }
 */
export function compararTarjetas(a, b, umbrales = REPETIDAS_POR_DEFECTO) {
  const u = { ...REPETIDAS_POR_DEFECTO, ...(umbrales ?? {}) };
  const tituloA = normalizarTitulo(a?.titulo);
  if (tituloA && tituloA === normalizarTitulo(b?.titulo)) return { nivel: "igual", porque: "tienen el mismo título", fraccion: 1 };

  const palabrasA = palabrasDelTitulo(normalizarTitulo(a?.titulo));
  const palabrasB = new Set(palabrasDelTitulo(normalizarTitulo(b?.titulo)));
  // Con menos de 2 palabras que cuenten, la fracción no dice nada.
  if (palabrasA.length < 2 || palabrasB.size < 2) return { nivel: "distinta", porque: "el título tiene muy pocas palabras para comparar", fraccion: 0 };
  const comunes = palabrasA.filter((palabra) => palabrasB.has(palabra)).length;
  const fraccion = Math.min(comunes / palabrasA.length, comunes / palabrasB.size);

  const archivosB = new Set(archivosDeLaTarjeta(b));
  const archivo = archivosDeLaTarjeta(a).find((ruta) => archivosB.has(ruta));
  const palabras = `comparten ${porciento(fraccion)} de las palabras del título`;

  if (fraccion >= u.igualPalabras) return { nivel: "igual", porque: palabras, fraccion };
  if (archivo && fraccion >= u.igualConArchivo) return { nivel: "igual", porque: `${palabras} y nombran ${archivo}`, fraccion, archivo };
  if (!archivo && fraccion >= u.posibleSinArchivo) return { nivel: "posible", porque: palabras, fraccion };
  if (archivo && fraccion >= u.posibleConArchivo) return { nivel: "posible", porque: `${palabras} y nombran ${archivo}`, fraccion, archivo };
  return { nivel: "distinta", porque: palabras, fraccion };
}

/** El número T- de una tarjeta (numero, o el código "T-123"). null si no se sabe. */
function numeroDe(tarjeta) {
  if (Number.isInteger(tarjeta?.numero) && tarjeta.numero > 0) return tarjeta.numero;
  const delCodigo = String(tarjeta?.codigo ?? "").match(/^T-(\d+)$/i)?.[1];
  return delCodigo ? Number(delCodigo) : null;
}

const codigoDe = (tarjeta) => (numeroDe(tarjeta) ? `T-${numeroDe(tarjeta)}` : `«${enUnaLinea(String(tarjeta?.titulo ?? "otra tarjeta"), 80)}»`);

/**
 * Qué hacer con la tarjeta que se va a planear. `parecidas`: la respuesta de crm.parecidas ({ tarjetas, repetidasRevisadas }) o
 * solo la lista. `repo`: { ruta, remoto, ramaBase } (para commitEstaEnMain). En este orden:
 *  1. La otra está HECHO, es "igual" y su commit está en main -> "ya-hecha" ("Ya lo hizo T-X (commit abc1234)"). Si el commit no
 *     está en main, esa otra no cuenta.
 *  2. Las dos pendientes y "igual": si la otra tiene el número menor -> "repetida" ("Repetida de T-X", con el detalle para la otra);
 *     si la otra es la nueva -> "seguir" (la cierra su propia revisión). Si no se sabe el número de esta, decide el dueño ("posible").
 *     Si la otra se está construyendo o subiendo -> "esperar" (la parte 3 pone la flecha de dependencia).
 *  3. Un parecido "posible", o un "igual" con la otra en ERROR o FALLIDO -> "posible" ("Posible repetida de T-X: <por qué>").
 * Las parejas que el dueño ya revisó (repetidasRevisadas) se saltan.
 * -> { accion: "ya-hecha" | "repetida" | "posible" | "esperar" | "seguir", otra, linea, motivo, commit?, detalleParaLaOtra? }
 */
export async function decidirRepetida({ tarjeta, parecidas, repo, config }) {
  const umbrales = config?.repetidas ?? REPETIDAS_POR_DEFECTO;
  const lista = Array.isArray(parecidas) ? parecidas : (parecidas?.tarjetas ?? []);
  const revisadas = new Set(
    [...(Array.isArray(parecidas?.repetidasRevisadas) ? parecidas.repetidasRevisadas : []), ...(Array.isArray(tarjeta?.resultado?.repetidasRevisadas) ? tarjeta.resultado.repetidasRevisadas : [])].map(Number),
  );
  const miNumero = numeroDe(tarjeta);
  const comparadas = lista
    .filter((otra) => otra?.id && otra.id !== tarjeta?.id && !revisadas.has(numeroDe(otra)))
    .map((otra) => ({ otra, ...compararTarjetas(tarjeta, otra, umbrales) }))
    .filter(({ nivel }) => nivel !== "distinta");
  const iguales = comparadas.filter(({ nivel }) => nivel === "igual");

  // 1. Ya la hizo otra (y su commit está en main de verdad).
  for (const { otra, porque } of iguales.filter(({ otra }) => otra.estado === "HECHO" && otra.commit)) {
    if (!(await commitEstaEnMain(repo, otra.commit))) continue;
    const linea = `Ya lo hizo ${codigoDe(otra)} (commit ${String(otra.commit).slice(0, 7)})`;
    return { accion: "ya-hecha", otra, linea, motivo: enUnaLinea(`${linea}: ${porque}`, 300), commit: otra.commit };
  }

  // 2. Dos pendientes iguales: se cierra la más nueva (la otra con el número menor gana). Si la otra ya está en marcha, esta espera.
  const pendientes = PENDIENTES.has(tarjeta?.estado ?? "PLANEANDO") ? iguales.filter(({ otra }) => PENDIENTES.has(otra.estado)) : [];
  const masViejas = pendientes.filter(({ otra }) => miNumero && numeroDe(otra) && numeroDe(otra) < miNumero).sort((x, y) => numeroDe(x.otra) - numeroDe(y.otra));
  if (masViejas.length) {
    const { otra, porque } = masViejas[0];
    const linea = `Repetida de ${codigoDe(otra)}`;
    return { accion: "repetida", otra, linea, motivo: enUnaLinea(`${linea}: ${porque}`, 300), detalleParaLaOtra: String(tarjeta?.detalle ?? "").trim() || undefined };
  }
  const enMarcha = iguales.find(({ otra }) => EN_MARCHA.has(otra.estado));
  if (enMarcha) {
    const { otra, porque } = enMarcha;
    return { accion: "esperar", otra, linea: `Espera a ${codigoDe(otra)}, que pide lo mismo`, motivo: enUnaLinea(`${codigoDe(otra)} ya está en ${otra.estado}: ${porque}`, 300) };
  }
  // Sin el número de alguna de las dos no se sabe cuál es la más nueva: no se cierra sola, decide el dueño.
  const sinNumero = pendientes.find(({ otra }) => !miNumero || !numeroDe(otra));
  if (sinNumero) {
    const linea = enUnaLinea(`Posible repetida de ${codigoDe(sinNumero.otra)}: ${sinNumero.porque} (no sé cuál es la más nueva)`, 300);
    return { accion: "posible", otra: sinNumero.otra, linea, motivo: linea };
  }

  // 3. Lo decide el dueño.
  const posible = comparadas.find(({ nivel, otra }) => nivel === "posible" || TERMINADAS_MAL.has(otra.estado));
  if (posible) {
    const { otra, porque, nivel } = posible;
    const linea = enUnaLinea(`Posible repetida de ${codigoDe(otra)}: ${porque}${nivel === "igual" ? ` (${codigoDe(otra)} quedó en ${otra.estado})` : ""}`, 300);
    return { accion: "posible", otra, linea, motivo: linea };
  }
  // Las pendientes iguales que quedan son más nuevas que esta: las cierra su propia revisión.
  if (pendientes.length) return { accion: "seguir", otra: pendientes[0].otra, linea: null, motivo: `${codigoDe(pendientes[0].otra)} es la más nueva: la cierra su propia revisión` };
  return { accion: "seguir", otra: null, linea: null, motivo: lista.length ? "ninguna parecida pide lo mismo" : "no hay tarjetas parecidas" };
}

/**
 * La revisión entera antes de planear: pide crm.parecidas, decide (decidirRepetida) y hace la llamada que corresponde:
 * "ya-hecha" -> crm.yaHecha con repetidaDe; "repetida" / "posible" -> crm.repetida con su tipo. `repo`: el del repo de la tarjeta.
 * -> { cerrada: true } si la tarjeta salió de PLANEANDO; { cerrada: false, esperar?: otraId } si se planea (o espera a la otra).
 * Nunca lanza: si algo falla (un CRM viejo sin la ruta, la red cortada o git), deja un aviso y { cerrada: false }: se planea igual.
 */
export async function revisarRepetidas({ crm, config, registro, repo }, tarjeta) {
  try {
    const parecidas = await crm.parecidas(tarjeta.id);
    const decision = await decidirRepetida({ tarjeta, parecidas, repo, config });
    const { accion, otra, linea, motivo } = decision;
    if (accion === "ya-hecha") {
      await crm.yaHecha(tarjeta.id, { commit: decision.commit, motivo, nota: linea, etapa: "planear", repetidaDe: otra.id });
    } else if (accion === "repetida") {
      await crm.repetida(tarjeta.id, { tipo: "repetida", otraId: otra.id, linea, motivo, detalleParaLaOtra: decision.detalleParaLaOtra });
    } else if (accion === "posible") {
      await crm.repetida(tarjeta.id, { tipo: "posible", otraId: otra.id, linea, motivo });
    } else if (accion === "esperar") {
      registro?.info?.(`"${tarjeta.titulo}": ${motivo}`);
      return { cerrada: false, esperar: otra.id };
    } else {
      return { cerrada: false };
    }
    registro?.info?.(`"${tarjeta.titulo}": ${accion} (${motivo})`);
    return { cerrada: true };
  } catch (error) {
    registro?.aviso?.(`no se pudo revisar si "${tarjeta?.titulo}" es repetida (${String(error?.message ?? error).split("\n")[0]}): se planea igual`);
    return { cerrada: false };
  }
}
