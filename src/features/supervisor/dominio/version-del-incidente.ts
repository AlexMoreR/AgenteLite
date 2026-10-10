/**
 * UN INCIDENTE DEL LIBRO VIVE MIENTRAS VIVE SU DEFECTO (código puro).
 *
 * Caso real (10-oct-2026): la alerta CRÍTICA "Después del cambio del libro V3 a la versión 182…"
 * (incidente del 7-oct, arreglado en la v191 a las 23:35 del 9-oct) seguía sumando como "ejemplos"
 * leads que entraron el 10-oct con el libro ya corregido (cv16c1a0, 10:21) y seguía en CRÍTICO.
 *
 * Reglas:
 *  1. Un incidente "INC:libro-vN:<producto>" solo muestra como ejemplos leads cuya ENTRADA fue
 *     mientras estaba activa la versión N o una posterior con el MISMO defecto, es decir, antes de
 *     la versión que lo arregló.
 *  2. La versión que lo arregló la dice el Change Guardian: la primera versión posterior en la que
 *     vuelven a pasar los escenarios dorados que fallaban con la N (los críticos, si hay). También
 *     vale el `arregladoPor` que deja `hallazgosDeArreglo` cuando el Guardian lo vio en vivo.
 *  3. Arreglado y SIN datos suficientes después del arreglo → "arreglado, esperando confirmación":
 *     sin ejemplos nuevos y como OBSERVACIÓN (no avisa, no es CRÍTICO).
 *  4. Arreglado y CON datos suficientes que muestran la métrica recuperada (mismos tamaños mínimos
 *     y umbrales de los detectores) → se CIERRA solo: "resuelto, confirmado con datos".
 *  5. Arreglado pero los datos de después siguen mal → IMPORTANTE (no CRÍTICO): el libro ya no es
 *     el problema conocido; hay que mirar otra cosa.
 */

import type { LibroDeReglas } from "../../agente-v3/domain/reglas";
import { comparar, pct, SIGNIFICANCIA_POR_DEFECTO, type Proporcion, type ReglaDeSignificancia } from "./estadistica";
import { evaluarEscenario, type Escenario, type FlujoConocido } from "./guardian";
import { MALO_SI_SUBE, NOMBRE_DEL_INDICADOR, disponible, valorDelIndicador, type FichaDelLead } from "./lead";
import type { FiltroDeLeads, IndicadorDeTasa } from "./linea-base";
import type { CambioDelLibro, Hallazgo, Severidad } from "./tipos";

const HORA = 3_600_000;
const DIA = 24 * HORA;

export type ArregloDelIncidente = {
  /** La versión del libro que lo arregló. */
  version: number;
  /** Desde cuándo rige esa versión. */
  en: Date;
  /** Escenarios dorados que volvieron a pasar (vacío si vino de `arregladoPor`). */
  escenarios: string[];
};

export type EstadoDeConfirmacion = "recuperada" | "sin_datos" | "sigue_mal";

export type Confirmacion = {
  estado: EstadoDeConfirmacion;
  /** Una línea por métrica: "Clientes que responden en 2 h: 58 % (21/36) vs 61 % antes del defecto". */
  detalle: string[];
  /** Leads maduros que entraron después del arreglo (el mínimo de las métricas mirada). */
  leadsDespues: number;
};

/** La contexto con el que `consolidar` acota los incidentes del libro. */
export type ContextoDeVersiones = {
  /** Clave del incidente → arreglo (solo los que ya se arreglaron). */
  arreglos: Map<string, ArregloDelIncidente>;
  /** Clave del incidente → desde cuándo rige la versión del incidente (si se conoce). */
  inicios?: Map<string, Date>;
  /** Clave del incidente → confirmación con datos (solo en la vuelta de cada hora). */
  confirmaciones?: Map<string, Confirmacion>;
  /** Hora de ENTRADA de un lead (primer mensaje del cliente), o null si no se conoce. */
  entradaDe?: (conversationId: string) => Date | null;
};

const PREFIJO_ARREGLO = "CAMBIO:arreglo:";

/** "INC:libro-v182:combo-camilla" → 182. */
export function versionDelIncidente(clave: string): number | null {
  const m = /^INC:libro-v(\d+):/.exec(clave);
  return m ? Number(m[1]) : null;
}

/**
 * La versión que arregló el defecto de la versión `version`: la primera posterior en la que pasan
 * TODOS los escenarios que fallaban con ella (solo los críticos, si alguno lo es). Null si el libro de
 * esa versión ya no está en el historial, si no fallaba ningún escenario o si ninguno lo arregla.
 */
export function buscarArreglo(input: {
  version: number;
  libros: Map<number, LibroDeReglas>;
  /** Los cambios SIN agrupar (con la hora exacta de cada versión). */
  cambios: CambioDelLibro[];
  escenarios: Escenario[];
  flujos?: Record<string, FlujoConocido>;
  /** Lo que dejó el Guardian en vivo (hallazgosDeArreglo), si hay. */
  arregladoPor?: number | null;
}): ArregloDelIncidente | null {
  const horaDe = (version: number) => input.cambios.find((c) => c.version === version)?.en ?? null;
  if (input.arregladoPor && input.arregladoPor > input.version) {
    const en = horaDe(input.arregladoPor);
    if (en) return { version: input.arregladoPor, en, escenarios: [] };
  }
  const libro = input.libros.get(input.version);
  if (!libro || input.escenarios.length === 0) return null;
  const flujos = input.flujos ?? {};
  const fallan = input.escenarios.filter((e) => !evaluarEscenario({ ...libro, version: input.version }, e, flujos).pasa);
  const criticos = fallan.filter((e) => e.critico);
  /*
    El defecto del incidente = lo que ROMPIÓ esa versión (críticos que pasaban con la anterior). Si la
    anterior ya no está en el historial, o la versión no rompió nada nuevo (heredó el defecto, como la
    v187 del de la v182), son todos los críticos que fallan. Así un problema viejo que nadie arregló
    no deja el incidente sin "arreglo" para siempre.
  */
  const anteriorVersion = input.cambios.find((c) => c.version === input.version)?.anterior ?? input.version - 1;
  const libroAnterior = input.libros.get(anteriorVersion);
  const rotos = libroAnterior ? criticos.filter((e) => evaluarEscenario({ ...libroAnterior, version: anteriorVersion }, e, flujos).pasa) : [];
  const objetivo = rotos.length ? rotos : criticos.length ? criticos : fallan;
  if (objetivo.length === 0) return null;
  const posteriores = [...input.libros.keys()].filter((v) => v > input.version).sort((a, b) => a - b);
  for (const version of posteriores) {
    const candidato = input.libros.get(version) as LibroDeReglas;
    if (!objetivo.every((e) => evaluarEscenario({ ...candidato, version }, e, flujos).pasa)) continue;
    const en = horaDe(version);
    if (!en) return null;
    return { version, en, escenarios: objetivo.map((e) => e.id) };
  }
  return null;
}

/** Los arreglos (y desde cuándo rige cada versión con defecto) de los incidentes del libro abiertos. */
export function arreglosDeLosIncidentes(input: {
  abiertos: Array<{ clave: string; estado: string; desde: Date; hallazgos: Hallazgo[] }>;
  libros: Map<number, LibroDeReglas>;
  cambios: CambioDelLibro[];
  escenarios: Escenario[];
  flujos?: Record<string, FlujoConocido>;
}): { arreglos: Map<string, ArregloDelIncidente>; inicios: Map<string, Date> } {
  const arreglos = new Map<string, ArregloDelIncidente>();
  const inicios = new Map<string, Date>();
  const cache = new Map<number, ArregloDelIncidente | null>();
  for (const inc of input.abiertos) {
    if (inc.estado !== "ABIERTA") continue;
    const version = versionDelIncidente(inc.clave);
    if (version === null) continue;
    inicios.set(inc.clave, input.cambios.find((c) => c.version === version)?.en ?? inc.desde);
    const arregladoPor = inc.hallazgos
      .map((h) => Number(h.valores?.arregladoPor))
      .filter((v) => Number.isFinite(v) && v > version)
      .sort((a, b) => a - b)[0];
    if (!cache.has(version) || arregladoPor) {
      cache.set(version, buscarArreglo({ version, libros: input.libros, cambios: input.cambios, escenarios: input.escenarios, flujos: input.flujos, arregladoPor }));
    }
    const arreglo = cache.get(version);
    if (arreglo) arreglos.set(inc.clave, arreglo);
  }
  return { arreglos, inicios };
}

/** La métrica que vigila cada hallazgo del incidente (para confirmar con datos). */
export function indicadorDelHallazgo(clave: string): IndicadorDeTasa | null {
  const [familia, nombre] = clave.split(":");
  if (familia === "CAMBIO" && nombre === "post-cambio") return "respondio_2h";
  if (familia === "BOT" && (nombre === "rafaga_inicial" || nombre === "precio_o_fotos_antes_de_identificar")) return nombre;
  if (familia === "EMBUDO") {
    if (nombre === "respondio_2h_cusum") return "respondio_2h";
    const conocidos: IndicadorDeTasa[] = ["respondio_2h", "conversa_3_24h", "senal_24h", "a_asesora_24h", "asesora_sin_senal_24h", "senal_sin_asesora_1h", "insistencia_72h"];
    return conocidos.includes(nombre as IndicadorDeTasa) ? (nombre as IndicadorDeTasa) : null;
  }
  return null;
}

/** Los mismos tamaños y umbrales que usan los detectores para esa métrica. */
export function reglaDelIndicador(indicador: IndicadorDeTasa): ReglaDeSignificancia {
  if (indicador === "rafaga_inicial" || indicador === "precio_o_fotos_antes_de_identificar") {
    return { minimoObservado: 10, minimoBase: 50, zMinimo: 3, puntosMinimos: 20 };
  }
  if (indicador === "respondio_2h") return { minimoObservado: 30, minimoBase: 50, zMinimo: 3, puntosMinimos: 15 };
  return SIGNIFICANCIA_POR_DEFECTO;
}

function contar(fichas: FichaDelLead[], indicador: IndicadorDeTasa): Proporcion {
  let exitos = 0;
  let total = 0;
  for (const f of fichas) {
    const v = valorDelIndicador(f, indicador);
    if (v === null) continue;
    total += 1;
    if (v) exitos += 1;
  }
  return { exitos, total };
}

/**
 * ¿Los datos de DESPUÉS del arreglo confirman que el problema pasó? Cada métrica del incidente se
 * compara contra los 14 días ANTES del defecto (no contra los días malos):
 *  - sin la muestra mínima (o base corta) → sin_datos;
 *  - peor y significativo (mismo umbral que el detector) → sigue_mal;
 *  - peor con z ≥ 2 aunque no llegue al umbral → sin_datos (dudoso: se espera más);
 *  - si no → recuperada.
 */
export function confirmarArreglo(input: {
  hallazgos: Hallazgo[];
  arreglo: ArregloDelIncidente;
  /** Desde cuándo rige la versión con el defecto. */
  inicioDelDefecto: Date;
  fichas: FichaDelLead[];
  ahora: Date;
  filtro: FiltroDeLeads;
}): Confirmacion {
  const indicadores = [...new Set(input.hallazgos.map((h) => indicadorDelHallazgo(h.clave)).filter((x): x is IndicadorDeTasa => Boolean(x)))];
  // La respuesta del cliente en 2 h se mira SIEMPRE (es la que dice si el arreglo sirvió para vender):
  // así un incidente del bot no se cierra con los 10 leads que piden la ráfaga o el precio.
  if (!indicadores.includes("respondio_2h")) indicadores.push("respondio_2h");
  const delFiltro = input.fichas.filter(input.filtro);
  const inicio = input.inicioDelDefecto.getTime();
  const arreglo = input.arreglo.en.getTime();
  const detalle: string[] = [];
  let estado: EstadoDeConfirmacion = "recuperada";
  let leadsDespues = Infinity;
  for (const indicador of indicadores) {
    const maduras = delFiltro.filter((f) => disponible(f, indicador, input.ahora));
    const despues = contar(maduras.filter((f) => f.entradaEn.getTime() >= arreglo), indicador);
    const antes = contar(maduras.filter((f) => f.entradaEn.getTime() < inicio && f.entradaEn.getTime() >= inicio - 14 * DIA), indicador);
    const regla = reglaDelIndicador(indicador);
    const c = comparar(despues, antes, regla);
    leadsDespues = Math.min(leadsDespues, despues.total);
    const malo = MALO_SI_SUBE.has(indicador) ? c.puntos > 0 : c.puntos < 0;
    let veredicto: EstadoDeConfirmacion;
    if (!c.conMuestra) veredicto = "sin_datos";
    else if (c.significativo && malo) veredicto = "sigue_mal";
    else if (malo && Math.abs(c.z) >= 2 && Math.abs(c.puntos) >= regla.puntosMinimos) veredicto = "sin_datos";
    else veredicto = "recuperada";
    if (veredicto === "sigue_mal") estado = "sigue_mal";
    else if (veredicto === "sin_datos" && estado !== "sigue_mal") estado = "sin_datos";
    const falta = c.conMuestra ? "" : ` (faltan datos: mínimo ${regla.minimoObservado} leads después y ${regla.minimoBase} antes)`;
    detalle.push(
      `${NOMBRE_DEL_INDICADOR[indicador]}: ${pct(c.tasaObservada)} (${despues.exitos}/${despues.total}) desde la versión ${input.arreglo.version} vs ${pct(c.tasaEsperada)} (${antes.exitos}/${antes.total}) en los 14 días antes del defecto${falta} → ${veredicto === "recuperada" ? "recuperada" : veredicto === "sigue_mal" ? "sigue mal" : "sin confirmar"}.`,
    );
  }
  return { estado, detalle, leadsDespues: Number.isFinite(leadsDespues) ? leadsDespues : 0 };
}

/** Deja en la evidencia solo los leads que entraron con la versión del defecto (antes del arreglo). */
export function acotarChats(input: {
  chats: string[];
  previos?: string[];
  desde: Date | null;
  arreglo: ArregloDelIncidente | null;
  entradaDe?: (conversationId: string) => Date | null;
}): string[] {
  const dentro = (id: string, desconocido: boolean) => {
    const entrada = input.entradaDe?.(id) ?? null;
    if (!entrada) return desconocido;
    if (input.desde && entrada.getTime() < input.desde.getTime()) return false;
    if (input.arreglo && entrada.getTime() >= input.arreglo.en.getTime()) return false;
    return true;
  };
  // Un chat ya guardado cuya entrada no se conoce se queda; uno nuevo sin entrada conocida, con el
  // arreglo hecho, no entra (no se agregan ejemplos nuevos a un incidente arreglado).
  const previos = (input.previos ?? []).filter((id) => dentro(id, true));
  const nuevos = input.chats.filter((id) => dentro(id, !input.arreglo));
  return [...new Set([...previos, ...nuevos])].slice(0, 8);
}

export function esHallazgoDeArreglo(h: Pick<Hallazgo, "clave">): boolean {
  return h.clave.startsWith(PREFIJO_ARREGLO);
}

/** El hallazgo que cuenta en qué va el arreglo (se reemplaza en cada vuelta). */
export function hallazgoDelArreglo(input: {
  version: number;
  producto: string | null;
  arreglo: ArregloDelIncidente;
  confirmacion: Confirmacion | null;
}): Hallazgo {
  const { arreglo, confirmacion } = input;
  const estado = confirmacion?.estado ?? "sin_datos";
  const severidad: Severidad = estado === "sigue_mal" ? "IMPORTANTE" : "OBSERVACION";
  const titulo =
    estado === "recuperada"
      ? `Resuelto, confirmado con datos: la versión ${arreglo.version} arregló el defecto de la ${input.version}`
      : estado === "sigue_mal"
        ? `Arreglado en el libro por la versión ${arreglo.version}, pero los datos de después siguen mal`
        : `Arreglado en el libro por la versión ${arreglo.version}, esperando confirmación con datos`;
  const hechos = [
    `La versión ${arreglo.version} rige desde ${new Date(arreglo.en.getTime() - 5 * HORA).toISOString().slice(0, 16).replace("T", " ")} (Bogotá).`,
    ...(arreglo.escenarios.length ? [`Change Guardian: con la versión ${arreglo.version} vuelven a pasar ${arreglo.escenarios.join(", ")}, que fallaban con la ${input.version}.`] : []),
    ...(confirmacion?.detalle ?? ["Todavía no hay datos de después del arreglo."]),
    `Los ejemplos de este incidente son solo leads que entraron entre la versión ${input.version} y la ${arreglo.version}.`,
  ];
  return {
    clave: `${PREFIJO_ARREGLO}v${input.version}`,
    familia: "CAMBIO",
    severidad,
    titulo,
    que:
      estado === "recuperada"
        ? `Los leads que entraron desde la versión ${arreglo.version} volvieron a la línea base: el incidente se cierra.`
        : estado === "sigue_mal"
          ? `El libro ya pasa los escenarios, pero los leads de después de la versión ${arreglo.version} siguen por debajo de la línea base: la causa puede ser otra (anuncio, horario, atención).`
          : `El libro ya pasa los escenarios. Falta la muestra mínima de leads después de la versión ${arreglo.version} para confirmarlo con datos.`,
    desde: arreglo.en,
    producto: input.producto,
    leadsAfectados: 0,
    evidencia: { chats: [], reglas: [], versiones: [input.version, arreglo.version] },
    metrica: "Métricas del incidente después del arreglo",
    esperado: "Igual a los 14 días antes del defecto",
    observado: confirmacion ? `${confirmacion.leadsDespues} leads maduros después del arreglo` : "sin datos",
    hechos,
    hipotesis: [],
    causaPosible: `Defecto del libro V3 en la versión ${input.version}, arreglado en la ${arreglo.version}.`,
    impacto: "—",
    recomendacion:
      estado === "sigue_mal"
        ? "Revisar qué más cambió (anuncio, público, horario, atención) con los chats de después del arreglo."
        : "Nada en el libro. Se confirma solo con los datos.",
    queCambiar: "Nada.",
    riesgo: "—",
    comoMedir: "Las métricas del incidente vuelven a la línea base de antes del defecto.",
    tocaProduccion: false,
    valores: { arregladoPor: arreglo.version, confirmacion: estado },
  };
}

function mismoNombre(a: string, b: string): boolean {
  const x = a.trim().toLowerCase().replace(/…$/, "");
  const y = b.trim().toLowerCase().replace(/…$/, "");
  return Boolean(x && y) && (x.startsWith(y) || y.startsWith(x));
}

/**
 * El arreglo de un incidente casi siempre CAMBIA la regla que gana el primer mensaje (la v191 puso
 * "Llega del anuncio del combo (texto exacto del anuncio)…"). Contra los 14 días anteriores eso se ve
 * como "una regla nueva se quedó con el primer mensaje" (el 10-oct se pegó al incidente de la v182
 * como ejemplo con cv16c1a0). Si la regla nueva es una que agregó el arreglo, es el cambio ESPERADO:
 * queda como OBSERVACIÓN, sin pedir cambios en el libro.
 */
export function marcarCambiosDelArreglo(input: {
  hallazgos: Hallazgo[];
  arreglos: Array<{ version: number; arreglo: ArregloDelIncidente }>;
  libros: Map<number, LibroDeReglas>;
}): Hallazgo[] {
  return input.hallazgos.map((h) => {
    if (!h.clave.startsWith("BOT:regla-primer-mensaje:")) return h;
    const nueva = h.evidencia.reglas[0];
    if (!nueva) return h;
    for (const { version, arreglo } of input.arreglos) {
      const conDefecto = input.libros.get(version);
      const arreglado = input.libros.get(arreglo.version);
      if (!conDefecto || !arreglado) continue;
      const laPusoElArreglo = arreglado.reglas.some((r) => mismoNombre(r.nombre, nueva)) && !conDefecto.reglas.some((r) => mismoNombre(r.nombre, nueva));
      if (!laPusoElArreglo) continue;
      return {
        ...h,
        severidad: "OBSERVACION",
        titulo: `Cambio esperado: la regla que puso el arreglo (v${arreglo.version}) contesta el primer mensaje`,
        que: `${h.que} Es la regla que agregó la versión ${arreglo.version} para arreglar el defecto de la versión ${version}: es lo esperado.`,
        hipotesis: [],
        recomendacion: "Nada en el libro: es el arreglo funcionando. Se vigila con la respuesta en 2 h.",
        queCambiar: "Nada.",
        tocaProduccion: false,
        valores: { ...h.valores, cambioEsperadoPor: arreglo.version },
      };
    }
    return h;
  });
}

export const ETIQUETA_ESTADO_ARREGLO: Record<EstadoDeConfirmacion, string> = {
  recuperada: "Resuelto, confirmado con datos",
  sin_datos: "Arreglado, esperando confirmación",
  sigue_mal: "Arreglado en el libro, los datos siguen mal",
};
