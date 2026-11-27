// TARJETAS REPETIDAS (27-nov-2026, parte 2 de 3). Antes de planear, el Coordinador compara la tarjeta con las parecidas que le da
// el CRM (crm.parecidas) y decide, sin IA y con reglas fijas, si es repetida:
//   - compararTarjetas: "igual", "posible" o "distinta" (palabras del título y archivos que nombran el detalle y el plan);
//   - decidirRepetida: qué hacer (cerrar como ya hecha, cerrar como repetida, esperar, dejarla al dueño o seguir);
//   - revisarRepetidas: hace la llamada al CRM que corresponde. Si algo falla, la tarjeta se planea igual.
// Solo se cierra una tarjeta con un parecido "igual" y, si la otra ya está HECHO, con un commit que de verdad está en main.
// Ante la duda va al dueño como "posible". Todavía no la llama bucle.mjs (parte 3).
import { archivosDeTexto, archivosDelPlan } from "./choques.mjs";
import { REPETIDAS_POR_DEFECTO } from "./config.mjs";
import { commitEstaEnMain } from "./etapas.mjs";
import { palabrasDelTitulo } from "./git.mjs";

const PENDIENTES = new Set(["IDEA", "POR_APROBAR", "APROBADO", "PLANEANDO", "PLAN_LISTO", "PLAN_APROBADO"]);
const TRABAJANDO = new Set(["EN_CURSO", "POR_REVISAR", "SUBIENDO"]);
const CON_FALLA = new Set(["ERROR", "FALLIDO"]);

/** El título para comparar: minúsculas, sin tildes, sin signos ni "Parte N" / "parte N de M" / "T-123". */
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

/** Los archivos que nombra una tarjeta: los de su detalle y los de su plan. */
function archivosDeLaTarjeta(tarjeta) {
  return new Set([...archivosDeTexto(String(tarjeta?.detalle ?? "")), ...archivosDelPlan(tarjeta?.plan)]);
}

const porciento = (fraccion) => `${Math.round(fraccion * 100)} %`;

/**
 * ¿Se parecen dos tarjetas? { nivel: "igual" | "posible" | "distinta", porque }.
 * El parecido de palabras se mide en las dos direcciones y vale el menor.
 */
export function compararTarjetas(a, b, umbrales = REPETIDAS_POR_DEFECTO) {
  const u = { ...REPETIDAS_POR_DEFECTO, ...(umbrales ?? {}) };
  const tituloA = normalizarTitulo(a?.titulo);
  const tituloB = normalizarTitulo(b?.titulo);
  if (tituloA && tituloA === tituloB) return { nivel: "igual", porque: "tienen el mismo título" };

  const palabrasA = palabrasDelTitulo(tituloA);
  const palabrasB = new Set(palabrasDelTitulo(tituloB));
  const comunes = palabrasA.filter((palabra) => palabrasB.has(palabra)).length;
  const fraccion = palabrasA.length && palabrasB.size ? Math.min(comunes / palabrasA.length, comunes / palabrasB.size) : 0;

  const delB = archivosDeLaTarjeta(b);
  const archivos = [...archivosDeLaTarjeta(a)].filter((archivo) => delB.has(archivo));
  const palabras = `comparten el ${porciento(fraccion)} de las palabras del título`;
  const conArchivo = `${palabras} y nombran ${archivos[0]}`;

  if (fraccion >= u.igualPalabras) return { nivel: "igual", porque: palabras };
  if (archivos.length && fraccion >= u.igualConArchivo) return { nivel: "igual", porque: conArchivo };
  if (fraccion >= u.posibleSinArchivo) return { nivel: "posible", porque: palabras };
  if (archivos.length && fraccion >= u.posibleConArchivo) return { nivel: "posible", porque: conArchivo };
  return { nivel: "distinta", porque: "no se parecen" };
}

const codigoDe = (tarjeta) => tarjeta?.codigo || (Number.isInteger(tarjeta?.numero) ? `T-${tarjeta.numero}` : "otra tarjeta");

/** Los números de parejas que el dueño ya revisó: los que trae la respuesta del CRM y los de la propia tarjeta. */
function numerosRevisados(tarjeta, parecidas) {
  const crudos = [...(Array.isArray(parecidas?.repetidasRevisadas) ? parecidas.repetidasRevisadas : []), ...(Array.isArray(tarjeta?.resultado?.repetidasRevisadas) ? tarjeta.resultado.repetidasRevisadas : [])];
  return new Set(crudos.map(Number).filter(Number.isInteger));
}

/**
 * Qué hacer con la tarjeta según las parecidas. `parecidas` es la respuesta de crm.parecidas ({ tarjetas, repetidasRevisadas }) o
 * solo su lista. -> { accion: "ya-hecha" | "repetida" | "posible" | "esperar" | "seguir", otra?, linea?, motivo?, commit?, detalleParaLaOtra? }
 * Orden: (1) la otra ya está HECHO y su commit está en main; (2) las dos pendientes y la otra tiene el número menor;
 * esperar si la otra está trabajándose; (3) un "posible", o un "igual" con la otra en ERROR o FALLIDO; si no, seguir.
 */
export async function decidirRepetida({ tarjeta, parecidas, repo, config }) {
  const lista = Array.isArray(parecidas) ? parecidas : Array.isArray(parecidas?.tarjetas) ? parecidas.tarjetas : [];
  const revisadas = numerosRevisados(tarjeta, parecidas);
  const umbrales = config?.repetidas ?? REPETIDAS_POR_DEFECTO;
  const comparadas = [];
  for (const otra of lista) {
    if (!otra || otra.id === tarjeta?.id || revisadas.has(Number(otra.numero))) continue;
    const parecido = compararTarjetas(tarjeta, otra, umbrales);
    if (parecido.nivel !== "distinta") comparadas.push({ otra, ...parecido });
  }
  const iguales = comparadas.filter((c) => c.nivel === "igual");

  // (1) La otra ya está HECHO y su commit está en main. Si el commit no está en main, esa otra no cuenta.
  for (const { otra, porque } of iguales) {
    if (otra.estado !== "HECHO" || !otra.commit) continue;
    if (await commitEstaEnMain(repo, otra.commit)) {
      const corto = String(otra.commit).slice(0, 7);
      return { accion: "ya-hecha", otra, commit: otra.commit, linea: `Ya lo hizo ${codigoDe(otra)} (commit ${corto})`, motivo: porque };
    }
  }

  // (2) Las dos están pendientes y la otra es la más vieja (número T- menor): esta es la repetida.
  const numero = Number(tarjeta?.numero);
  for (const { otra, porque } of iguales) {
    if (!PENDIENTES.has(otra.estado) || !Number.isInteger(numero) || !Number.isInteger(otra.numero)) continue;
    if (otra.numero < numero) {
      return { accion: "repetida", otra, linea: `Repetida de ${codigoDe(otra)}`, motivo: porque, detalleParaLaOtra: String(tarjeta?.detalle ?? "") };
    }
  }

  // La otra se está construyendo, revisando o subiendo: se espera a que termine (la flecha de dependencia la pone la parte 3).
  const trabajando = iguales.find(({ otra }) => TRABAJANDO.has(otra.estado));
  if (trabajando) return { accion: "esperar", otra: trabajando.otra, motivo: trabajando.porque };

  // (3) Un parecido "posible", un "igual" con la otra en ERROR o FALLIDO, o un "igual" que no se puede ordenar: lo decide el dueño.
  const sinOrden = (c) => PENDIENTES.has(c.otra.estado) && !(Number.isInteger(numero) && Number.isInteger(c.otra.numero));
  const duda = comparadas.find((c) => c.nivel === "posible" || CON_FALLA.has(c.otra.estado) || sinOrden(c));
  if (duda) return { accion: "posible", otra: duda.otra, linea: `Posible repetida de ${codigoDe(duda.otra)}: ${duda.porque}`, motivo: duda.porque };

  return { accion: "seguir" };
}

/**
 * Pide las parecidas, decide y hace la llamada al CRM que corresponde. -> { cerrada: boolean, esperar?: otraId }.
 * Si algo falla (un CRM viejo sin la ruta, la red cortada, git), deja un aviso y devuelve { cerrada: false }: se planea igual.
 */
export async function revisarRepetidas({ crm, config, registro, repo }, tarjeta) {
  try {
    const parecidas = await crm.parecidas(tarjeta.id);
    const decision = await decidirRepetida({ tarjeta, parecidas, repo, config });
    if (decision.accion === "ya-hecha") {
      await crm.yaHecha(tarjeta.id, { commit: decision.commit, motivo: decision.linea, nota: decision.linea, etapa: "planear", repetidaDe: decision.otra.id });
      registro?.info?.(`${tarjeta.id}: ${decision.linea}`);
      return { cerrada: true };
    }
    if (decision.accion === "repetida" || decision.accion === "posible") {
      await crm.repetida(tarjeta.id, {
        tipo: decision.accion,
        otraId: decision.otra.id,
        linea: decision.linea,
        motivo: decision.motivo,
        detalleParaLaOtra: decision.detalleParaLaOtra,
      });
      registro?.info?.(`${tarjeta.id}: ${decision.linea}`);
      return { cerrada: true };
    }
    if (decision.accion === "esperar") return { cerrada: false, esperar: decision.otra.id };
    return { cerrada: false };
  } catch (error) {
    registro?.aviso?.(`repetidas de ${tarjeta?.id}: no se pudo revisar, se planea igual (${error?.message ?? error})`);
    return { cerrada: false };
  }
}
