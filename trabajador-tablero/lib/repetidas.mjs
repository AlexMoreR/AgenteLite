// TARJETAS REPETIDAS (27-nov-2026, parte 2 de 3 de «detectar tarjetas repetidas antes de planear»). Antes de planear, el Coordinador
// compara la tarjeta con las parecidas del mismo tablero y repo (crm.parecidas) y decide:
//   - ya-hecha: otra igual ya está HECHO y su commit está de verdad en main -> esta se cierra "Ya lo hizo T-X (commit abc1234)";
//   - repetida: las dos están pendientes, son iguales y la otra es la más vieja -> esta se cierra "Repetida de T-X";
//   - esperar: la otra, igual, está en curso o subiendo -> la parte 3 pone la flecha de dependencia;
//   - posible: se parecen pero no tanto (o la otra falló) -> ERROR "Posible repetida de T-X: <por qué>" y decide el dueño;
//   - seguir: nada que hacer, se planea normal.
// La llama el bucle (bucle.mjs, procesar) justo antes de medir y planear: cerrada:true -> no se abre la sesión del plan; esperar -> flecha de dependencia. Si algo falla, la tarjeta se planea igual.
import { archivosDeTexto, archivosDelPlan, noChoca } from "./choques.mjs";
import { REPETIDAS_POR_DEFECTO } from "./config.mjs";
import { palabrasDelTitulo } from "./git.mjs";
import { commitEstaEnMain } from "./etapas.mjs";

/** Los estados en que la otra ya está trabajándose: no se cierra nada, se espera. */
const ESTADOS_EN_MARCHA = new Set(["EN_CURSO", "POR_REVISAR", "SUBIENDO"]);
/** Los estados "pendientes" (esperan a hacerse): solo entre estos dos se cierra una como repetida de la otra. Los demás (p. ej. IDEA) van a "posible". */
const ESTADOS_PENDIENTES = new Set(["POR_APROBAR", "APROBADO", "PLANEANDO", "PLAN_LISTO", "PLAN_APROBADO"]);
/** Los estados terminados mal: un "igual" con la otra aquí no se cierra solo, lo decide el dueño. */
const ESTADOS_CON_FALLA = new Set(["ERROR", "FALLIDO"]);

/** El título sin tildes, en minúscula, sin signos ni prefijos "Parte N", "parte N de M" ni "T-123". */
export function normalizarTitulo(titulo) {
  return String(titulo ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\bt-\d+\b/g, " ")
    .replace(/\bparte\s+\d+(\s+de\s+\d+)?\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Los archivos que nombra la tarjeta (en el detalle y en el plan), sin los que nunca cuentan (manual, notas de cambios). */
function archivosDeLaTarjeta(tarjeta) {
  const rutas = [...archivosDeTexto(String(tarjeta?.detalle ?? "")), ...archivosDelPlan(tarjeta?.plan)];
  return new Set(rutas.filter((ruta) => !noChoca(ruta, [])));
}

const porcentaje = (fraccion) => `${Math.round(fraccion * 100)} %`;

/**
 * Compara dos tarjetas ({ titulo, detalle, plan }). -> { nivel: "igual" | "posible" | "distinta", porque }
 * El % de palabras se mide en las dos direcciones y vale el menor (así un título corto dentro de uno largo no basta).
 */
export function compararTarjetas(a, b, umbrales = REPETIDAS_POR_DEFECTO) {
  const u = { ...REPETIDAS_POR_DEFECTO, ...(umbrales ?? {}) };
  const titulo = normalizarTitulo(a?.titulo);
  if (titulo && titulo === normalizarTitulo(b?.titulo)) return { nivel: "igual", porque: "el título es el mismo" };
  const palabrasA = new Set(palabrasDelTitulo(titulo));
  const palabrasB = new Set(palabrasDelTitulo(normalizarTitulo(b?.titulo)));
  if (!palabrasA.size || !palabrasB.size) return { nivel: "distinta", porque: "títulos sin palabras para comparar" };
  const comunes = [...palabrasA].filter((palabra) => palabrasB.has(palabra)).length;
  const fraccion = Math.min(comunes / palabrasA.size, comunes / palabrasB.size);
  const archivosA = archivosDeLaTarjeta(a);
  const enComun = [...archivosDeLaTarjeta(b)].filter((ruta) => archivosA.has(ruta));
  const conArchivo = enComun.length ? ` y los dos nombran ${enComun[0]}` : "";
  const detalle = `comparten ${porcentaje(fraccion)} de las palabras del título${conArchivo}`;
  if (fraccion >= u.igualPalabras) return { nivel: "igual", porque: detalle };
  if (enComun.length && fraccion >= u.igualConArchivo) return { nivel: "igual", porque: detalle };
  if (fraccion >= u.posibleSinArchivo) return { nivel: "posible", porque: detalle };
  if (enComun.length && fraccion >= u.posibleConArchivo) return { nivel: "posible", porque: detalle };
  return { nivel: "distinta", porque: "no se parecen" };
}

const codigo = (numero) => `T-${numero}`;
const numeroDe = (tarjeta) => (Number.isFinite(Number(tarjeta?.numero)) ? Number(tarjeta.numero) : null);

/** Cuánto pesa cada decisión cuando hay varias parecidas: gana la más fuerte. */
const PESO = { "ya-hecha": 5, repetida: 4, esperar: 3, posible: 2, seguir: 1 };

/**
 * Qué hacer con `tarjeta` según sus `parecidas` (las de crm.parecidas). Las reglas, en este orden:
 *   (1) la otra está HECHO, es igual y su commit está en main -> "ya-hecha" (sin commit en main, esa otra no cuenta);
 *   (2) las dos pendientes, iguales y la otra tiene el número menor -> "repetida" (si la otra es la nueva, "seguir");
 *   la otra EN_CURSO, POR_REVISAR o SUBIENDO y es igual -> "esperar";
 *   (3) un parecido "posible", o un "igual" con la otra en ERROR o FALLIDO -> "posible".
 * Se saltan las parejas de resultado.repetidasRevisadas. -> { accion, otra?, linea?, motivo, commit?, detalleParaLaOtra? }
 */
export async function decidirRepetida({ tarjeta, parecidas, repo, config }) {
  const umbrales = config?.repetidas ?? REPETIDAS_POR_DEFECTO;
  const revisadas = new Set((tarjeta?.resultado?.repetidasRevisadas ?? []).map(Number));
  const miNumero = numeroDe(tarjeta);
  let mejor = { accion: "seguir", motivo: "ninguna tarjeta parecida" };
  for (const otra of parecidas ?? []) {
    const suNumero = numeroDe(otra);
    if (suNumero !== null && revisadas.has(suNumero)) continue;
    const { nivel, porque } = compararTarjetas(tarjeta, otra, umbrales);
    if (nivel === "distinta") continue;
    const nombre = suNumero !== null ? codigo(suNumero) : `«${otra.titulo}»`;
    let decision = null;
    if (nivel === "igual") {
      if (otra.estado === "HECHO") {
        // Si git falla con esta pareja, ese commit no cuenta y se sigue con las demás.
        const enMain = otra.commit ? await commitEstaEnMain(repo, otra.commit).catch(() => false) : false;
        if (enMain) {
          decision = { accion: "ya-hecha", otra, commit: otra.commit, linea: `Ya lo hizo ${nombre} (commit ${String(otra.commit).slice(0, 7)})`, motivo: porque };
        }
      } else if (ESTADOS_EN_MARCHA.has(otra.estado)) {
        decision = { accion: "esperar", otra, motivo: `${nombre} ya lo está haciendo (${otra.estado}): ${porque}` };
      } else if (ESTADOS_CON_FALLA.has(otra.estado)) {
        decision = { accion: "posible", otra, linea: `Posible repetida de ${nombre}: ${porque}`, motivo: porque };
      } else if (ESTADOS_PENDIENTES.has(otra.estado) && suNumero !== null && miNumero !== null) {
        decision =
          suNumero < miNumero
            ? { accion: "repetida", otra, linea: `Repetida de ${nombre}`, motivo: porque, detalleParaLaOtra: String(tarjeta.detalle ?? "") }
            : { accion: "seguir", otra, motivo: `${nombre} es más nueva: esta sigue` };
      } else {
        // Sin los dos números no se sabe cuál es la vieja: nunca se cierra a ciegas.
        decision = { accion: "posible", otra, linea: `Posible repetida de ${nombre}: ${porque}`, motivo: porque };
      }
    } else {
      decision = { accion: "posible", otra, linea: `Posible repetida de ${nombre}: ${porque}`, motivo: porque };
    }
    if (decision && PESO[decision.accion] > PESO[mejor.accion]) mejor = decision;
  }
  return mejor;
}

/**
 * Revisa la tarjeta: pide las parecidas al CRM, decide y hace la llamada que corresponde. -> { cerrada, esperar?: otraId }
 * Todo va en try/catch: un CRM viejo sin la ruta, la red cortada o git que falla solo dejan un aviso y la tarjeta se planea igual.
 */
export async function revisarRepetidas({ crm, config, registro, repo }, tarjeta) {
  try {
    const respuesta = await crm.parecidas(tarjeta.id);
    const revisadas = Array.isArray(respuesta?.repetidasRevisadas) ? respuesta.repetidasRevisadas : [];
    const decision = await decidirRepetida({
      tarjeta: { ...tarjeta, resultado: { ...(tarjeta.resultado ?? {}), repetidasRevisadas: revisadas } },
      parecidas: Array.isArray(respuesta?.tarjetas) ? respuesta.tarjetas : [],
      repo,
      config,
    });
    if (decision.accion === "ya-hecha") {
      await crm.yaHecha(tarjeta.id, { commit: decision.commit, motivo: decision.linea, repetidaDe: decision.otra.id, etapa: "planear" });
      registro.info(`"${tarjeta.titulo}": ${decision.linea}; pasó a HECHO`);
      return { cerrada: true };
    }
    if (decision.accion === "repetida" || decision.accion === "posible") {
      await crm.repetida(tarjeta.id, {
        tipo: decision.accion,
        otraId: decision.otra.id,
        linea: decision.linea,
        motivo: decision.motivo,
        ...(decision.accion === "repetida" ? { detalleParaLaOtra: decision.detalleParaLaOtra } : {}),
      });
      registro.info(`"${tarjeta.titulo}": ${decision.linea}`);
      return { cerrada: true };
    }
    if (decision.accion === "esperar") {
      registro.info(`"${tarjeta.titulo}": ${decision.motivo}`);
      return { cerrada: false, esperar: decision.otra.id };
    }
    return { cerrada: false };
  } catch (error) {
    registro.aviso(`"${tarjeta?.titulo}": no se pudo revisar si está repetida (${String(error?.message ?? error).split("\n")[0]}); se planea igual`);
    return { cerrada: false };
  }
}
