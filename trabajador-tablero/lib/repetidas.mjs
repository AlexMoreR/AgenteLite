// TARJETAS REPETIDAS (27-nov-2026, parte 2 de 3 de «detectar tarjetas repetidas antes de planear»). Antes de planear, el
// Coordinador pide al CRM las tarjetas parecidas del mismo tablero y repo (/parecidas) y decide, con reglas fijas y sin IA:
//   - "ya-hecha": otra HECHO pedía lo mismo y su commit está en main -> esta pasa a HECHO ("Ya lo hizo T-X (commit …)");
//   - "repetida": otra pendiente más vieja (número T- menor) pide lo mismo -> esta pasa a FALLIDO ("Repetida de T-X");
//   - "esperar": otra igual está construyendo o subiendo -> la parte 3 pone la flecha de dependencia;
//   - "posible": se parecen pero no es seguro (o la igual quedó en ERROR o FALLIDO) -> ERROR posible_repetida, decide el dueño;
//   - "seguir": nada que se repita: se planea como siempre.
// En esta parte el bucle todavía NO llama a revisarRepetidas (eso es la parte 3). Si algo falla (un CRM viejo sin la ruta, la
// red, git), nunca frena: se anota un aviso y se planea igual.
import { REPETIDAS_POR_DEFECTO } from "./config.mjs";
import { archivosDeTexto, archivosDelPlan, noChoca } from "./choques.mjs";
import { enUnaLinea } from "./diagnostico.mjs";
import { commitEstaEnMain } from "./etapas.mjs";
import { palabrasDelTitulo } from "./git.mjs";

/** Los estados en los que la otra tarjeta está trabajando: no se cierra ninguna, se espera a que termine. */
const TRABAJANDO = new Set(["EN_CURSO", "SUBIENDO"]);
/** Los estados que ya terminaron mal: un "igual" con una de estas no cierra nada, lo decide el dueño. */
const TERMINADAS_MAL = new Set(["ERROR", "FALLIDO"]);

/** El código de una tarjeta para las líneas: el que manda el CRM, o "T-<número>". */
const codigoDe = (tarjeta) => (typeof tarjeta?.codigo === "string" && tarjeta.codigo.trim() ? tarjeta.codigo.trim() : `T-${tarjeta?.numero ?? "?"}`);

/** Un número de tarjeta válido, o null. */
const numeroDe = (valor) => (Number.isInteger(Number(valor)) && Number(valor) > 0 && valor !== null && valor !== "" ? Number(valor) : null);

/**
 * El título para comparar: minúsculas, sin tildes, sin signos y sin los prefijos "Parte N (de M)" ni "T-123".
 * "Parte 2 de 3: Cambiar el Menú — T-45" -> "cambiar el menu".
 */
export function normalizarTitulo(titulo) {
  let texto = String(titulo ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
  texto = texto.replace(/\bt-\d+\b/g, " ").replace(/\bparte\s+\d+(\s+de\s+\d+)?\b/g, " ");
  return texto
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Los archivos que nombra una tarjeta, en su detalle y en su plan, sin el manual ni las notas de cambios pendientes. */
function archivosDeLaTarjeta(tarjeta) {
  const rutas = [...archivosDeTexto(String(tarjeta?.detalle ?? "")), ...archivosDelPlan(tarjeta?.plan ?? "")];
  const limpias = rutas.map((ruta) => String(ruta).replace(/\\/g, "/").replace(/\/\*\*?$/, "").replace(/\/+$/, "")).filter(Boolean);
  return [...new Set(limpias)].filter((ruta) => !noChoca(ruta, []));
}

/** ¿Las dos rutas nombran el mismo archivo (o una está dentro de la otra)? */
const mismaRuta = (a, b) => a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);

/** Un número de 0 a 1 como porcentaje entero: 0.857 -> "86 %". */
const porciento = (parte) => `${Math.round(parte * 100)} %`;

/**
 * ¿Las tarjetas `a` y `b` piden lo mismo? Cada una es { titulo, detalle, plan }. `umbrales` = config.repetidas.
 *  - "igual": el título normalizado es idéntico; o comparten igualPalabras (80 %) o más de las palabras del título en las dos
 *    direcciones; o comparten igualConArchivo (50 %) o más y al menos un archivo nombrado en las dos (detalle y plan).
 *  - "posible": comparten entre posibleSinArchivo (50 %) y igualPalabras (80 %) sin archivo en común; o comparten un archivo y
 *    posibleConArchivo (30 %) o más de las palabras.
 *  - "distinta": todo lo demás.
 * "En las dos direcciones": la parte que se cuenta es la menor de las dos (comunes / palabras de a, comunes / palabras de b).
 * -> { nivel, porque }
 */
export function compararTarjetas(a, b, umbrales = REPETIDAS_POR_DEFECTO) {
  const u = { ...REPETIDAS_POR_DEFECTO, ...(umbrales ?? {}) };
  const tituloA = normalizarTitulo(a?.titulo);
  const tituloB = normalizarTitulo(b?.titulo);
  if (tituloA && tituloA === tituloB) return { nivel: "igual", porque: "tienen el mismo título" };

  const palabrasA = palabrasDelTitulo(tituloA);
  const palabrasB = new Set(palabrasDelTitulo(tituloB));
  const comunes = palabrasA.filter((palabra) => palabrasB.has(palabra)).length;
  const parte = palabrasA.length && palabrasB.size ? Math.min(comunes / palabrasA.length, comunes / palabrasB.size) : 0;

  const archivosB = archivosDeLaTarjeta(b);
  const archivo = archivosDeLaTarjeta(a).find((ruta) => archivosB.some((otra) => mismaRuta(ruta, otra))) ?? null;

  if (parte >= u.igualPalabras) return { nivel: "igual", porque: `comparten ${porciento(parte)} de las palabras del título` };
  if (archivo && parte >= u.igualConArchivo) return { nivel: "igual", porque: `comparten ${porciento(parte)} de las palabras del título y el archivo ${archivo}` };
  if (!archivo && parte >= u.posibleSinArchivo) return { nivel: "posible", porque: `comparten ${porciento(parte)} de las palabras del título` };
  if (archivo && parte >= u.posibleConArchivo) return { nivel: "posible", porque: `comparten el archivo ${archivo} y ${porciento(parte)} de las palabras del título` };
  return { nivel: "distinta", porque: archivo ? `solo comparten el archivo ${archivo}` : `comparten ${porciento(parte)} de las palabras del título` };
}

/** Las parecidas que manda el CRM: la lista sola, o la respuesta entera de /parecidas ({ tarjetas, repetidasRevisadas }). */
function listaDeParecidas(parecidas) {
  if (Array.isArray(parecidas)) return parecidas;
  return Array.isArray(parecidas?.tarjetas) ? parecidas.tarjetas : [];
}

/** Los números de las parejas que el dueño ya revisó: los de la respuesta de /parecidas y los de resultado.repetidasRevisadas de esta. */
function revisadasDe(tarjeta, parecidas) {
  const numeros = [...(Array.isArray(parecidas?.repetidasRevisadas) ? parecidas.repetidasRevisadas : []), ...(Array.isArray(tarjeta?.resultado?.repetidasRevisadas) ? tarjeta.resultado.repetidasRevisadas : [])];
  return new Set(numeros.map(numeroDe).filter((numero) => numero !== null));
}

/**
 * Qué hacer con `tarjeta` frente a sus `parecidas` (de /parecidas). `repo`: { ruta, remoto, ramaBase } para commitEstaEnMain.
 * `config`: la del Coordinador (usa config.repetidas). En este orden, y la primera regla que encaja gana:
 *  (1) la otra está HECHO, es "igual" y su commit está en main -> "ya-hecha" (si el commit no está en main, esa otra no cuenta);
 *  (2) las dos pendientes, "igual" y la otra tiene el número T- menor -> "repetida" (si la nueva es la otra, se sigue);
 *      la otra "igual" está EN_CURSO o SUBIENDO -> "esperar";
 *  (3) un parecido "posible", o un "igual" con la otra en ERROR o FALLIDO -> "posible";
 *  si no, "seguir". Las parejas ya revisadas por el dueño (resultado.repetidasRevisadas) se saltan.
 * -> { accion, otra, linea, motivo, commit?, detalleParaLaOtra? }
 */
export async function decidirRepetida({ tarjeta, parecidas, repo, config }) {
  const umbrales = config?.repetidas ?? REPETIDAS_POR_DEFECTO;
  const revisadas = revisadasDe(tarjeta, parecidas);
  const miNumero = numeroDe(tarjeta?.numero);
  const comparadas = listaDeParecidas(parecidas)
    .filter((otra) => otra?.id && otra.id !== tarjeta?.id && !revisadas.has(numeroDe(otra.numero)))
    .map((otra) => ({ otra, ...compararTarjetas(tarjeta, otra, umbrales) }))
    .filter(({ nivel }) => nivel !== "distinta")
    // La de número más bajo primero (la más vieja): si hay varias, se cierra contra la original.
    .sort((x, y) => (numeroDe(x.otra.numero) ?? Infinity) - (numeroDe(y.otra.numero) ?? Infinity));

  // (1) Ya la hizo otra: HECHO, igual y el commit de verdad en main.
  const repoDeMain = { remoto: "origin", ramaBase: "main", ...(repo ?? {}) };
  for (const { otra, nivel, porque } of comparadas) {
    if (otra.estado !== "HECHO" || nivel !== "igual" || !otra.commit) continue;
    if (!(await commitEstaEnMain(repoDeMain, String(otra.commit)))) continue;
    const corto = String(otra.commit).slice(0, 7);
    return { accion: "ya-hecha", otra, linea: `Ya lo hizo ${codigoDe(otra)} (commit ${corto})`, motivo: enUnaLinea(porque, 300), commit: String(otra.commit) };
  }

  // (2) Las dos pendientes e iguales: se cierra la más nueva. Si la nueva es la otra, esta sigue (la otra se cerrará al planearse).
  const pendiente = (estado) => !TRABAJANDO.has(estado) && !TERMINADAS_MAL.has(estado) && estado !== "HECHO";
  for (const { otra, nivel, porque } of comparadas) {
    if (nivel !== "igual" || !pendiente(otra.estado)) continue;
    const suNumero = numeroDe(otra.numero);
    if (miNumero === null || suNumero === null || suNumero >= miNumero) continue;
    return { accion: "repetida", otra, linea: `Repetida de ${codigoDe(otra)}`, motivo: enUnaLinea(porque, 300), detalleParaLaOtra: String(tarjeta?.detalle ?? "").trim() || undefined };
  }
  const trabajando = comparadas.find(({ otra, nivel }) => nivel === "igual" && TRABAJANDO.has(otra.estado));
  if (trabajando) {
    return { accion: "esperar", otra: trabajando.otra, linea: `Espera a ${codigoDe(trabajando.otra)}, que pide lo mismo y está ${trabajando.otra.estado === "SUBIENDO" ? "subiendo" : "en curso"}`, motivo: enUnaLinea(trabajando.porque, 300) };
  }

  // (3) Posible: un parecido no seguro, o una igual que terminó mal. Decide el dueño.
  const posible = comparadas.find(({ otra, nivel }) => nivel === "posible" || (nivel === "igual" && TERMINADAS_MAL.has(otra.estado)));
  if (posible) {
    const porque = posible.nivel === "igual" ? `${posible.porque}, y esa quedó en ${posible.otra.estado}` : posible.porque;
    return { accion: "posible", otra: posible.otra, linea: enUnaLinea(`Posible repetida de ${codigoDe(posible.otra)}: ${porque}`, 300), motivo: enUnaLinea(porque, 300) };
  }
  return { accion: "seguir", otra: null, linea: null, motivo: "ninguna tarjeta parecida pide lo mismo" };
}

/**
 * Revisa si `tarjeta` repite a otra y hace la llamada al CRM que corresponde: crm.yaHecha con repetidaDe, o crm.repetida con tipo
 * "repetida" o "posible". -> { cerrada, esperar?, accion }. `cerrada: true` = la tarjeta ya no se planea. Nunca lanza: si la
 * consulta, git o el CRM fallan, deja un aviso y devuelve { cerrada: false } para que se planee igual.
 */
export async function revisarRepetidas({ crm, config, registro, repo }, tarjeta) {
  try {
    const parecidas = await crm.parecidas(tarjeta.id);
    const decision = await decidirRepetida({ tarjeta, parecidas, repo, config });
    if (decision.accion === "ya-hecha") {
      await crm.yaHecha(tarjeta.id, { commit: decision.commit, motivo: decision.motivo, nota: decision.linea, etapa: "planear", repetidaDe: decision.otra.id });
      registro?.info?.(`"${tarjeta.titulo}": ${decision.linea}; pasó a HECHO`);
      return { cerrada: true, accion: decision.accion };
    }
    if (decision.accion === "repetida" || decision.accion === "posible") {
      await crm.repetida(tarjeta.id, {
        tipo: decision.accion,
        otraId: decision.otra.id,
        linea: decision.linea,
        motivo: decision.motivo,
        detalleParaLaOtra: decision.accion === "repetida" ? decision.detalleParaLaOtra : undefined,
      });
      registro?.info?.(`"${tarjeta.titulo}": ${decision.linea}${decision.accion === "posible" ? " (decide el dueño)" : ""}`);
      return { cerrada: true, accion: decision.accion };
    }
    if (decision.accion === "esperar") {
      registro?.info?.(`"${tarjeta.titulo}": ${decision.linea}`);
      return { cerrada: false, esperar: decision.otra.id, accion: decision.accion };
    }
    return { cerrada: false, accion: decision.accion };
  } catch (error) {
    registro?.aviso?.(`no se pudo revisar si "${tarjeta?.titulo}" repite a otra (${String(error?.message ?? error).split("\n")[0]}): se planea igual`);
    return { cerrada: false };
  }
}
