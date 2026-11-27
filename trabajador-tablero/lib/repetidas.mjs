// TARJETAS REPETIDAS ANTES DE PLANEAR (27-nov-2026, parte 2 de «Coordinador: detectar tarjetas repetidas antes de planear»).
// Antes de planear una tarjeta, el Coordinador le pide al CRM sus parecidas (mismo tablero y repo, últimos 30 días; sin su familia,
// sin las unidas por una flecha ni las parejas que el dueño ya revisó) y decide con reglas fijas, sin Claude:
//   - ya-hecha: otra igual ya está HECHO y su commit está en main -> esta pasa a HECHO ("Ya lo hizo T-X (commit abc1234)");
//   - repetida: otra igual sigue pendiente y es más vieja (número T- menor) -> esta se cierra ("Repetida de T-X") y su detalle va a la otra;
//   - esperar: otra igual está en curso o subiendo -> la parte 3 pone la flecha de dependencia;
//   - posible: se parecen pero no es seguro (o la igual quedó en ERROR / FALLIDO) -> ERROR posible_repetida, decide el dueño;
//   - seguir: nada que hacer, se planea como siempre.
// Si algo falla (un CRM viejo sin la ruta, la red, git), se avisa y se planea igual: esta revisión nunca frena una tarjeta.
// En esta parte el bucle todavía no la llama (eso es la parte 3).
import { archivosDeTexto, archivosDelPlan, noChoca } from "./choques.mjs";
import { enUnaLinea } from "./diagnostico.mjs";
import { commitEstaEnMain } from "./etapas.mjs";
import { git, palabrasDelTitulo } from "./git.mjs";

/** Los mismos valores que config.mjs (bloque `repetidas`), por si llega una config sin él (las pruebas). */
export const REPETIDAS_POR_DEFECTO = { igualPalabras: 0.8, igualConArchivo: 0.5, posibleSinArchivo: 0.5, posibleConArchivo: 0.3, dias: 30 };

/** Las que todavía no se empezaron a construir. */
const PENDIENTES = new Set(["IDEA", "POR_APROBAR", "APROBADO", "PLANEANDO", "PLAN_LISTO", "PLAN_APROBADO"]);
/** Las que se están construyendo o ya van camino a main: se espera a que terminen. */
const EN_CAMINO = new Set(["EN_CURSO", "POR_REVISAR", "SUBIENDO"]);
const CON_FALLA = new Set(["ERROR", "FALLIDO"]);

/** El orden de las acciones: si varias otras dan algo, gana la de más arriba. */
const PRIORIDAD = ["ya-hecha", "repetida", "esperar", "posible"];

const PREFIJO = /^(?:t-\d+|parte\s+\d+(?:\s+de\s+\d+)?)\b[\s:.,;—–-]*/;

/** El título para comparar: minúsculas, sin tildes, sin signos y sin los prefijos "T-123" ni "Parte N (de M)". */
export function normalizarTitulo(titulo) {
  let texto = String(titulo ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
  for (let antes = null; antes !== texto; ) {
    antes = texto;
    texto = texto.replace(PREFIJO, "").trim();
  }
  return texto.replace(/[^a-z0-9]+/g, " ").trim();
}

/** El código "T-123" de una tarjeta (el que manda el CRM o el que sale de su número). */
const codigoDe = (tarjeta) => tarjeta?.codigo || (Number.isFinite(Number(tarjeta?.numero)) && tarjeta?.numero !== null ? `T-${Math.trunc(Number(tarjeta.numero))}` : "otra tarjeta");

/** Los archivos que nombran el detalle y el plan, sin el manual ni las notas de cambios pendientes (los nombran casi todos). */
function archivosDe(tarjeta) {
  const todos = new Set([...archivosDeTexto(String(tarjeta?.detalle ?? "")), ...archivosDelPlan(tarjeta?.plan)]);
  return [...todos].filter((ruta) => !noChoca(ruta, []));
}

const porciento = (fraccion) => `${Math.round(fraccion * 100)} %`;

/**
 * ¿Son la misma tarea? `a` y `b`: { titulo, detalle?, plan? }. `umbrales`: el bloque `repetidas` de la config.
 * Las palabras se cuentan en las dos direcciones: vale la fracción más chica (las comunes sobre las de cada título).
 * -> { nivel: "igual" | "posible" | "distinta", porque }
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

  const archivosB = new Set(archivosDe(b));
  const archivoComun = archivosDe(a).find((ruta) => archivosB.has(ruta)) ?? null;

  if (fraccion >= u.igualPalabras) return { nivel: "igual", porque: `comparten ${porciento(fraccion)} de las palabras del título` };
  if (archivoComun && fraccion >= u.igualConArchivo) {
    return { nivel: "igual", porque: `comparten ${porciento(fraccion)} de las palabras del título y el archivo ${archivoComun}` };
  }
  if (!archivoComun && fraccion >= u.posibleSinArchivo) return { nivel: "posible", porque: `comparten ${porciento(fraccion)} de las palabras del título` };
  if (archivoComun && fraccion >= u.posibleConArchivo) {
    return { nivel: "posible", porque: `comparten el archivo ${archivoComun} y ${porciento(fraccion)} de las palabras del título` };
  }
  return { nivel: "distinta", porque: `comparten ${porciento(fraccion)} de las palabras del título${archivoComun ? ` y el archivo ${archivoComun}` : ""}` };
}

/** Los números de las otras que el dueño ya revisó con esta (el CRM los manda en repetidasRevisadas y quedan en resultado). */
function revisadasDe(tarjeta, repetidasRevisadas) {
  const numeros = [...(Array.isArray(repetidasRevisadas) ? repetidasRevisadas : []), ...(Array.isArray(tarjeta?.resultado?.repetidasRevisadas) ? tarjeta.resultado.repetidasRevisadas : [])];
  return new Set(numeros.map(Number).filter(Number.isFinite));
}

/** ¿La otra es más vieja que los `dias` de la config? Sin fecha, cuenta (el CRM ya filtra por 30 días). */
function demasiadoVieja(otra, dias, ahora) {
  const creada = Date.parse(otra?.creadaEn ?? "");
  return Number.isFinite(creada) && Number.isFinite(dias) && ahora - creada > dias * 24 * 60 * 60_000;
}

/**
 * Decide qué hacer con `tarjeta` (la que se va a planear) según sus `parecidas` (la respuesta de crm.parecidas: { tarjetas,
 * repetidasRevisadas }, o la lista de tarjetas). `repo`: { ruta, remoto, ramaBase } para comprobar el commit con git.
 * -> { accion: "ya-hecha" | "repetida" | "posible" | "esperar" | "seguir", otra, linea, motivo, commit?, detalleParaLaOtra? }
 */
export async function decidirRepetida({ tarjeta, parecidas, repo, config, ahora = Date.now() }) {
  const umbrales = { ...REPETIDAS_POR_DEFECTO, ...(config?.repetidas ?? {}) };
  const lista = Array.isArray(parecidas) ? parecidas : (parecidas?.tarjetas ?? []);
  const revisadas = revisadasDe(tarjeta, Array.isArray(parecidas) ? [] : parecidas?.repetidasRevisadas);
  const miNumero = Number(tarjeta?.numero);
  const repoGit = repo?.ruta ? { remoto: "origin", ramaBase: "main", ...repo } : null;

  const opciones = [];
  for (const otra of lista) {
    if (!otra?.id || otra.id === tarjeta?.id) continue;
    if (revisadas.has(Number(otra.numero))) continue;
    if (demasiadoVieja(otra, umbrales.dias, ahora)) continue;
    const { nivel, porque } = compararTarjetas(tarjeta, otra, umbrales);
    if (nivel === "distinta") continue;
    const codigo = codigoDe(otra);
    const posible = () => ({ accion: "posible", otra, linea: enUnaLinea(`Posible repetida de ${codigo}: ${porque}`, 300), motivo: porque });

    if (nivel === "posible") {
      opciones.push(posible());
      continue;
    }
    // (1) La otra ya está hecha: cuenta solo si su commit está de verdad en main.
    if (otra.estado === "HECHO") {
      if (repoGit && otra.commit && (await commitEstaEnMain(repoGit, otra.commit))) {
        const corto = String(otra.commit).slice(0, 7);
        opciones.push({ accion: "ya-hecha", otra, commit: otra.commit, linea: `Ya lo hizo ${codigo} (commit ${corto})`, motivo: porque });
      }
      continue;
    }
    // (2) Las dos pendientes: se queda la más vieja (número T- menor). Si la nueva es la otra, esta sigue y la otra se cierra al planearla.
    if (PENDIENTES.has(otra.estado)) {
      if (Number.isFinite(miNumero) && Number(otra.numero) < miNumero) {
        opciones.push({ accion: "repetida", otra, linea: `Repetida de ${codigo}`, motivo: porque, detalleParaLaOtra: tarjeta?.detalle || undefined });
      }
      continue;
    }
    if (EN_CAMINO.has(otra.estado)) {
      opciones.push({ accion: "esperar", otra, linea: enUnaLinea(`Espera a ${codigo}, que hace lo mismo y ya se está construyendo`, 300), motivo: porque });
      continue;
    }
    // (3) Una igual que quedó en ERROR o FALLIDO: no se sabe si se hizo; decide el dueño.
    if (CON_FALLA.has(otra.estado)) opciones.push(posible());
  }

  for (const accion of PRIORIDAD) {
    const elegida = opciones.find((opcion) => opcion.accion === accion);
    if (elegida) return elegida;
  }
  return { accion: "seguir", otra: null, linea: null, motivo: lista.length ? "ninguna parecida es la misma tarea" : "no hay tarjetas parecidas" };
}

/**
 * La revisión completa antes de planear: pide las parecidas, decide y hace la llamada al CRM que corresponde.
 * `repo`: la config del repo ({ ruta, remoto, ramaBase }). -> { cerrada: true | false, esperar?: otraId, decision? }
 * Nunca lanza: si algo falla, deja un aviso y devuelve { cerrada: false } para que se planee igual.
 */
export async function revisarRepetidas({ crm, config, registro, repo }, tarjeta) {
  try {
    const parecidas = await crm.parecidas(tarjeta.id);
    const lista = Array.isArray(parecidas) ? parecidas : (parecidas?.tarjetas ?? []);
    if (!lista.length) return { cerrada: false };
    // Para comprobar un commit de una HECHO hace falta el main más nuevo; si el fetch falla, se usa el que ya está.
    if (repo?.ruta && lista.some((otra) => otra?.estado === "HECHO")) {
      await git(repo.ruta, ["fetch", repo.remoto ?? "origin", repo.ramaBase ?? "main"], { permitirFallo: true, timeoutMs: 2 * 60_000 });
    }
    const decision = await decidirRepetida({ tarjeta, parecidas, repo, config });
    if (decision.accion === "ya-hecha") {
      await crm.yaHecha(tarjeta.id, { commit: decision.commit, motivo: decision.linea, nota: decision.linea, etapa: "planear", repetidaDe: decision.otra.id });
      registro?.info?.(`${decision.linea}: se cierra como ya hecha`, { tarjeta: tarjeta.id, otra: decision.otra.id });
      return { cerrada: true, decision };
    }
    if (decision.accion === "repetida" || decision.accion === "posible") {
      await crm.repetida(tarjeta.id, {
        tipo: decision.accion,
        otraId: decision.otra.id,
        linea: decision.linea,
        motivo: decision.motivo,
        detalleParaLaOtra: decision.accion === "repetida" ? decision.detalleParaLaOtra : undefined,
      });
      registro?.info?.(`${decision.linea}: se cierra sin planear`, { tarjeta: tarjeta.id, otra: decision.otra.id });
      return { cerrada: true, decision };
    }
    if (decision.accion === "esperar") return { cerrada: false, esperar: decision.otra.id, decision };
    return { cerrada: false, decision };
  } catch (error) {
    registro?.aviso?.(`no se pudo revisar si la tarjeta está repetida (${String(error?.message ?? error).split("\n")[0]}): se planea igual`, { tarjeta: tarjeta?.id });
    return { cerrada: false };
  }
}
