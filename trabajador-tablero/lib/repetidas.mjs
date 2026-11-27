/*
  TARJETAS REPETIDAS (27-nov-2026, parte 2 de 3 de «Coordinador: detectar tarjetas repetidas antes de planear").
  Antes de planear, el Coordinador pide al CRM las tarjetas parecidas (/parecidas: mismo tablero y repo, activas o terminadas en
  los últimos 30 días, sin su familia ni las unidas por una flecha) y decide, en este orden:
    1. ya-hecha: una otra HECHO, "igual", con su commit en main (commitEstaEnMain) -> "Ya lo hizo T-X (commit abc1234)".
       Si su commit no está en main, esa otra no cuenta.
    2. repetida: las dos pendientes, "igual", y la otra es la más vieja (número T- menor) -> FALLIDO "Repetida de T-X", y el
       detalle de esta pasa a la otra si no lo tiene. Si la nueva es la otra, esta sigue (la otra se cierra cuando se planee).
    3. esperar: la otra "igual" se está construyendo (EN_CURSO, POR_REVISAR o SUBIENDO): la parte 3 pone la flecha de dependencia.
    4. posible: un parecido "posible", o un "igual" con la otra en ERROR o FALLIDO -> ERROR "Posible repetida de T-X: <por qué>",
       y decide el dueño (recoger-errores.mjs nunca la reintenta ni la parte).
    5. seguir: se planea como siempre.
  Las parejas que el dueño ya revisó (resultado.repetidasRevisadas) no se vuelven a mirar. Todo es de solo lectura salvo la
  llamada final al CRM, y si algo falla (un CRM viejo sin la ruta, la red, git) se planea igual: nunca frena una tarjeta por error.
  En esta parte el bucle todavía NO llama a revisarRepetidas (eso es la parte 3).
*/
import { archivosDeTexto, archivosDelPlan, noChoca } from "./choques.mjs";
import { enUnaLinea } from "./diagnostico.mjs";
import { commitEstaEnMain } from "./etapas.mjs";
import { git, palabrasDelTitulo } from "./git.mjs";

/** Los mismos de config.mjs (bloque `repetidas`): partes de las palabras del título (0.8 = 80 %) y días hacia atrás. */
export const REPETIDAS_POR_DEFECTO = { igualPalabras: 0.8, igualConArchivo: 0.5, posibleSinArchivo: 0.5, posibleConArchivo: 0.3, dias: 30 };

/** Los estados de una tarjeta que todavía no se empezó a construir. */
const PENDIENTES = new Set(["IDEA", "POR_APROBAR", "APROBADO", "PLANEANDO", "PLAN_LISTO", "PLAN_APROBADO"]);
/** Los de una tarjeta que se está construyendo o subiendo: se espera a que termine. */
const CONSTRUYENDOSE = new Set(["EN_CURSO", "POR_REVISAR", "SUBIENDO"]);
/** Los de una que falló: un "igual" con ella no cierra nada, lo decide el dueño. */
const FALLADAS = new Set(["ERROR", "FALLIDO"]);

/** Archivos que nombran casi todos los planes y no dicen de qué trata la tarea (además del manual y las notas, ver noChoca). */
const ARCHIVOS_QUE_NO_CUENTAN = new Set(["package.json", "package-lock.json"]);

/** El título para comparar: minúsculas, sin tildes, sin signos, sin "Parte N" al comienzo ni códigos T-123. */
export function normalizarTitulo(titulo) {
  return String(titulo ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\bt-\d+\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/^parte \d+(?: de \d+)?\b/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Los archivos que nombra una tarjeta (su detalle y su plan), sin el manual, las notas de cambios pendientes ni package.json. */
function archivosDeLaTarjeta(tarjeta) {
  const todos = new Set([...archivosDeTexto(String(tarjeta?.detalle ?? "")), ...(tarjeta?.plan ? archivosDelPlan(tarjeta.plan) : [])]);
  return [...todos].filter((ruta) => !noChoca(ruta, []) && !ARCHIVOS_QUE_NO_CUENTAN.has(ruta.split("/").at(-1)));
}

const porciento = (parte) => `${Math.round(parte * 100)} %`;

/**
 * ¿Qué tanto se parecen dos tarjetas? `umbrales`: el bloque `repetidas` de la config. La parte de palabras que comparten es la
 * menor de las dos direcciones (las comunes sobre las de a y sobre las de b), así una tarjeta corta no "se parece" a una larga.
 * -> { nivel: "igual" | "posible" | "distinta", porque }
 */
export function compararTarjetas(a, b, umbrales = REPETIDAS_POR_DEFECTO) {
  const u = { ...REPETIDAS_POR_DEFECTO, ...(umbrales ?? {}) };
  const tituloA = normalizarTitulo(a?.titulo);
  if (tituloA && tituloA === normalizarTitulo(b?.titulo)) return { nivel: "igual", porque: "tienen el mismo título" };

  const palabrasA = palabrasDelTitulo(normalizarTitulo(a?.titulo));
  const palabrasB = new Set(palabrasDelTitulo(normalizarTitulo(b?.titulo)));
  const comunes = palabrasA.filter((palabra) => palabrasB.has(palabra)).length;
  const parte = palabrasA.length && palabrasB.size ? Math.min(comunes / palabrasA.length, comunes / palabrasB.size) : 0;

  const archivosB = new Set(archivosDeLaTarjeta(b));
  const enComun = archivosDeLaTarjeta(a).filter((ruta) => archivosB.has(ruta));
  const conArchivo = enComun.length ? ` y las dos nombran ${enComun.slice(0, 3).join(", ")}` : "";
  const porque = `comparten el ${porciento(parte)} de las palabras del título${conArchivo}`;

  if (parte >= u.igualPalabras) return { nivel: "igual", porque };
  if (enComun.length && parte >= u.igualConArchivo) return { nivel: "igual", porque };
  if (!enComun.length && parte >= u.posibleSinArchivo) return { nivel: "posible", porque };
  if (enComun.length && parte >= u.posibleConArchivo) return { nivel: "posible", porque };
  return { nivel: "distinta", porque };
}

const codigoDe = (otra) => (typeof otra?.codigo === "string" && otra.codigo ? otra.codigo : Number.isInteger(otra?.numero) ? `T-${otra.numero}` : "otra tarjeta");
const numerosDe = (valor) => (Array.isArray(valor) ? valor.filter((numero) => Number.isInteger(numero) && numero > 0) : []);

/**
 * Qué hacer con la tarjeta según sus parecidas (la respuesta de crm.parecidas, o solo su lista). `repo`: { ruta, remoto, ramaBase }
 * para commitEstaEnMain. Solo lee (git fetch y git log incluidos): no llama al CRM.
 * -> { accion: "ya-hecha" | "repetida" | "posible" | "esperar" | "seguir", otra, linea, motivo, commit?, detalleParaLaOtra? }
 */
export async function decidirRepetida({ tarjeta, parecidas, repo, config }) {
  const umbrales = { ...REPETIDAS_POR_DEFECTO, ...(config?.repetidas ?? {}) };
  const lista = Array.isArray(parecidas) ? parecidas : (parecidas?.tarjetas ?? []);
  const revisadas = new Set([...numerosDe(parecidas?.repetidasRevisadas), ...numerosDe(tarjeta?.resultado?.repetidasRevisadas)]);
  const comparadas = lista
    .filter((otra) => otra?.id && otra.id !== tarjeta?.id && !revisadas.has(otra.numero))
    .map((otra) => ({ otra, ...compararTarjetas(tarjeta, otra, umbrales) }))
    .filter(({ nivel }) => nivel !== "distinta");
  const iguales = comparadas.filter(({ nivel }) => nivel === "igual");

  // 1. Ya la hizo otra: HECHO, "igual" y su commit está en main. Se trae main una vez, para que commitEstaEnMain vea el commit.
  const hechas = iguales.filter(({ otra }) => otra.estado === "HECHO" && /^[0-9a-f]{7,40}$/i.test(String(otra.commit ?? "")));
  if (hechas.length) {
    await git(repo.ruta, ["fetch", repo.remoto ?? "origin", repo.ramaBase ?? "main"], { permitirFallo: true, timeoutMs: 2 * 60_000 });
    for (const { otra, porque } of hechas) {
      if (!(await commitEstaEnMain({ remoto: "origin", ramaBase: "main", ...repo }, otra.commit))) continue;
      const corto = String(otra.commit).slice(0, 7);
      return { accion: "ya-hecha", otra, commit: otra.commit, linea: `Ya lo hizo ${codigoDe(otra)} (commit ${corto})`, motivo: enUnaLinea(`Igual a ${codigoDe(otra)}: ${porque}`, 300) };
    }
  }

  // 2. Las dos pendientes e "igual": se cierra la más nueva (número T- mayor), y su detalle pasa a la otra.
  const pendientes = PENDIENTES.has(tarjeta?.estado ?? "PLANEANDO") ? iguales.filter(({ otra }) => PENDIENTES.has(otra.estado)) : [];
  const numero = tarjeta?.numero;
  const masVieja = pendientes.filter(({ otra }) => Number.isInteger(numero) && Number.isInteger(otra.numero) && otra.numero < numero).sort((x, y) => x.otra.numero - y.otra.numero)[0];
  if (masVieja) {
    const { otra, porque } = masVieja;
    const detalle = String(tarjeta?.detalle ?? "").trim();
    return {
      accion: "repetida",
      otra,
      linea: `Repetida de ${codigoDe(otra)}`,
      motivo: enUnaLinea(`Igual a ${codigoDe(otra)}: ${porque}`, 300),
      ...(detalle ? { detalleParaLaOtra: detalle } : {}),
    };
  }

  // 3. La otra "igual" se está construyendo: se espera a que termine.
  const construyendose = iguales.find(({ otra }) => CONSTRUYENDOSE.has(otra.estado));
  if (construyendose) {
    const { otra, porque } = construyendose;
    return { accion: "esperar", otra, linea: `Esperando a ${codigoDe(otra)}, que hace lo mismo`, motivo: enUnaLinea(`Igual a ${codigoDe(otra)} (${otra.estado}): ${porque}`, 300) };
  }

  // 4. Un parecido "posible", o un "igual" que falló o que no se puede ordenar: decide el dueño.
  const dudosa =
    comparadas.find(({ nivel, otra }) => nivel === "igual" && FALLADAS.has(otra.estado)) ??
    comparadas.find(({ nivel, otra }) => nivel === "igual" && PENDIENTES.has(otra.estado) && !(Number.isInteger(numero) && Number.isInteger(otra.numero))) ??
    comparadas.find(({ nivel, otra }) => nivel === "posible" && otra.estado !== "HECHO") ??
    comparadas.find(({ nivel }) => nivel === "posible");
  if (dudosa) {
    const { otra, porque, nivel } = dudosa;
    const porQue = nivel === "igual" ? `${porque}, y ${codigoDe(otra)} quedó en ${otra.estado}` : porque;
    return { accion: "posible", otra, linea: enUnaLinea(`Posible repetida de ${codigoDe(otra)}: ${porQue}`, 300), motivo: enUnaLinea(porQue, 300) };
  }

  // 5. Nada se le parece (o la que se le parece es más nueva y se cerrará ella).
  const masNueva = pendientes[0];
  return {
    accion: "seguir",
    otra: masNueva?.otra ?? null,
    linea: null,
    motivo: masNueva ? `${codigoDe(masNueva.otra)} es igual pero más nueva: se cierra ella cuando se planee` : "ninguna tarjeta parecida",
  };
}

/**
 * Revisa si la tarjeta (en PLANEANDO) repite a otra y hace la llamada que toca al CRM: yaHecha con repetidaDe, o repetida con su
 * tipo ("repetida" o "posible"). Nunca lanza: si algo falla, deja un aviso y devuelve { cerrada: false } para que se planee igual.
 * -> { cerrada: true | false, esperar?: id de la otra, decision? }
 */
export async function revisarRepetidas({ crm, config, registro, repo }, tarjeta) {
  try {
    const repoDeLaTarjeta = repo ?? config?.repos?.[tarjeta?.repo];
    if (!repoDeLaTarjeta?.ruta) throw new Error(`el repo "${tarjeta?.repo}" no está configurado`);
    const parecidas = await crm.parecidas(tarjeta.id);
    const decision = await decidirRepetida({ tarjeta, parecidas, repo: repoDeLaTarjeta, config });
    if (decision.accion === "ya-hecha") {
      await crm.yaHecha(tarjeta.id, { commit: decision.commit, motivo: decision.motivo, nota: decision.linea, etapa: "planear", repetidaDe: decision.otra.id });
    } else if (decision.accion === "repetida" || decision.accion === "posible") {
      await crm.repetida(tarjeta.id, {
        tipo: decision.accion,
        otraId: decision.otra.id,
        linea: decision.linea,
        motivo: decision.motivo,
        detalleParaLaOtra: decision.detalleParaLaOtra,
      });
    } else if (decision.accion === "esperar") {
      registro?.info?.(`"${tarjeta.titulo}": ${decision.linea} (${decision.motivo})`);
      return { cerrada: false, esperar: decision.otra.id, decision };
    } else {
      return { cerrada: false, decision };
    }
    registro?.info?.(`"${tarjeta.titulo}": ${decision.linea} (${decision.accion})`);
    return { cerrada: true, decision };
  } catch (error) {
    registro?.aviso?.(`no se pudo revisar si "${tarjeta?.titulo}" está repetida (${String(error?.message ?? error).split("\n")[0]}): se planea igual`);
    return { cerrada: false };
  }
}
