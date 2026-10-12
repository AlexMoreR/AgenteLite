/**
 * REVALIDAR LOS INCIDENTES TÉCNICOS VIEJOS ANTES DE ESCALARLOS (código puro).
 *
 * Pedido de Alexander (11-oct-2026): "No quiero que el Supervisor mantenga como CRÍTICOS incidentes
 * históricos que ya no reproducen en la versión actual". Caso real: la alerta CRÍTICA de la v182
 * (combo-camilla, 7-oct) seguía abierta el 11-oct con el libro en la v222 porque (1) el historial del
 * libro guarda solo 30 versiones y ya no se podía saber qué versión la arregló, y (2) se le pegaba
 * cada hora el hallazgo "una regla nueva se quedó con el primer mensaje", que era justamente la regla
 * del ARREGLO, mientras la ráfaga y el precio de entrada (de los días malos) seguían guardados.
 *
 * Qué hace, en cada vuelta de cada hora, con cada incidente del libro ("INC:libro-vN:…") abierto que
 * ya es viejo (el defecto empezó hace ≥ 24 h), cuya versión N ya no es la actual y que es IMPORTANTE o
 * CRÍTICO (o ya estaba revalidándose):
 *
 *  1. Mira SOLO los leads que entraron con el comportamiento actual del libro: versión ≥ la del
 *     arreglo (si se conoce), ≥ el inicio del tramo en el que el libro pasa todos los escenarios
 *     críticos del Change Guardian hasta hoy, y ≥ la primera versión con hora conocida en el historial
 *     (antes de esa, la versión de entrada de un lead no es segura). Máximo los últimos 7 días.
 *  2. Por cada métrica del incidente (las mismas de los detectores) compara esos leads contra los 14
 *     días ANTES del defecto, con la misma prueba de dos proporciones y los mismos mínimos de muestra y
 *     de efecto de cada detector (reglaDelIndicador), y además las últimas 24 h solas (para no diluir
 *     un problema que volvió hace poco). También contra lo que medía el incidente al abrirse.
 *  3. Corre los escenarios dorados del Guardian con el libro ACTUAL (el mismo motor `decidir` que usa
 *     el simulador v3_probar_mensaje): qué regla gana el texto exacto del anuncio y si la regla que
 *     estaba en los ejemplos del incidente todavía lo gana.
 *
 * Decisión:
 *  - SIGUE: alguna métrica está peor de forma significativa con los datos NUEVOS (o el libro actual
 *    falla un escenario crítico): se escala con evidencia actual, leads afectados hoy, riesgo,
 *    solución y la decisión que necesita Alexander.
 *  - PENDIENTE: no hay muestra mínima (o el resultado es dudoso) en alguna métrica principal: no es
 *    CRÍTICO (tope IMPORTANTE), no va a Prioridades y no avisa; queda con la nota de qué falta.
 *  - RESUELTA: con muestra y sin el síntoma: se cierra "Revalidado: ya no ocurre con la versión X",
 *    con la evidencia guardada en la alerta (historial). No avisa.
 *
 * No se reabre con datos viejos: un incidente de una versión vieja que vuelve a aparecer (el detector
 * de "vigilancia post-cambio" lo recrea cada hora mientras el cambio tenga < 7 días) se revalida ANTES
 * de crearse y solo se crea si da SIGUE, o sea, si el síntoma está en leads NUEVOS.
 *
 * Nada de esto escribe el libro ni le habla a nadie: solo decide el estado de la alerta.
 */

import type { LibroDeReglas } from "../../agente-v3/domain/reglas";
import { OPCIONES_POR_DEFECTO, type Incidente } from "./alertas";
import { comparar, pct, type Proporcion } from "./estadistica";
import { evaluarEscenario, type Escenario, type FlujoConocido } from "./guardian";
import { MADURA_EN, MALO_SI_SUBE, NOMBRE_DEL_INDICADOR, disponible, valorDelIndicador, type FichaDelLead } from "./lead";
import type { FiltroDeLeads, IndicadorDeTasa } from "./linea-base";
import { ORDEN_DE_SEVERIDAD, severidadMayor, type CambioDelLibro, type Hallazgo, type Severidad } from "./tipos";
import { esHallazgoDeArreglo, indicadorDelHallazgo, reglaDelIndicador, versionDelIncidente, type ArregloDelIncidente } from "./version-del-incidente";

const MIN = 60_000;
const HORA = 60 * MIN;
const DIA = 24 * HORA;

export const PREFIJO_REVALIDACION = "REVALIDACION:";

/**
 * El interruptor `supervisor:revalidacion:<workspaceId>` (servicios/config.ts). Sin fila = prendida
 * (REVALIDACION_POR_DEFECTO); "false" / "0" / "no" / "off" / "apagado" = apagada (lo de antes).
 */
export const REVALIDACION_POR_DEFECTO = true;

export function interpretarRevalidacion(valor: string | null | undefined): boolean {
  if (valor === null || valor === undefined || valor.trim() === "") return REVALIDACION_POR_DEFECTO;
  return !["false", "0", "no", "off", "apagado", "apagada"].includes(valor.trim().toLowerCase());
}

export type DecisionDeRevalidacion = "RESUELTA" | "SIGUE" | "PENDIENTE";

export type OpcionesDeRevalidacion = {
  /** El defecto tiene que llevar al menos esto (h) para revalidarlo: lo nuevo lo juzgan los detectores. */
  antiguedadMinimaHoras: number;
  /** Ventana máxima de leads "actuales" (días hacia atrás). */
  ventanaDias: number;
  /** Mirada aparte a lo más reciente (h), para no diluir un problema que volvió. */
  ventanaRecienteHoras: number;
  /** Leads mínimos (con la versión actual) para decidir algo. */
  minimoLeads: number;
};

export const OPCIONES_DE_REVALIDACION: OpcionesDeRevalidacion = {
  antiguedadMinimaHoras: 24,
  ventanaDias: 7,
  ventanaRecienteHoras: 24,
  minimoLeads: 20,
};

export type VeredictoDeMetrica = "ya_no" | "sigue" | "sin_muestra" | "dudoso";

export type MetricaRevalidada = {
  indicador: IndicadorDeTasa;
  /** Principal = síntoma del bot / del cambio (decide). Secundaria = del embudo (solo si empeora). */
  principal: boolean;
  actual: Proporcion;
  reciente: Proporcion;
  base: Proporcion | null;
  delIncidente: Proporcion | null;
  veredicto: VeredictoDeMetrica;
  linea: string;
  /** Leads actuales con el síntoma (ejemplos). */
  chats: string[];
};

export type Revalidacion = {
  clave: string;
  decision: DecisionDeRevalidacion;
  en: Date;
  versionDelIncidente: number;
  versionActual: number;
  /** Desde qué versión cuentan los leads "actuales". */
  versionDesde: number;
  /** Desde cuándo rige esa versión (si se conoce). */
  desde: Date | null;
  leads: number;
  porVersion: Record<string, number>;
  metricas: MetricaRevalidada[];
  guardian: { corrido: boolean; fallaHoy: boolean; lineas: string[]; regla: string | null };
  hechos: string[];
  /** Leads afectados HOY (con el síntoma) y el total de leads actuales de esa métrica. */
  afectados: { n: number; total: number; indicador: IndicadorDeTasa | null };
  chats: string[];
};

function hora(fecha: Date): string {
  const b = new Date(fecha.getTime() - 5 * HORA);
  return `${b.toISOString().slice(0, 10)} ${b.toISOString().slice(11, 16)}`;
}

export function esHallazgoDeRevalidacion(h: Pick<Hallazgo, "clave">): boolean {
  return h.clave.startsWith(PREFIJO_REVALIDACION);
}

function delDefecto(hallazgos: Hallazgo[]): Hallazgo[] {
  return hallazgos.filter((h) => !esHallazgoDeArreglo(h) && !esHallazgoDeRevalidacion(h));
}

/** "84,3 % (59/70)" → {59, 70}. */
export function proporcionDelTexto(texto: string | null | undefined): Proporcion | null {
  const m = /\((\d+)\s*\/\s*(\d+)/.exec(texto ?? "");
  if (!m) return null;
  const exitos = Number(m[1]);
  const total = Number(m[2]);
  return total > 0 && exitos <= total ? { exitos, total } : null;
}

/** ¿Este incidente se revalida en esta vuelta? */
export function aplicaRevalidacion(input: {
  incidente: Pick<Incidente, "clave" | "familia" | "estado" | "severidad" | "desde" | "hallazgos">;
  versionActual: number;
  /** Desde cuándo rige la versión del incidente (si se conoce). */
  inicio?: Date | null;
  ahora: Date;
  opciones?: OpcionesDeRevalidacion;
}): boolean {
  const op = input.opciones ?? OPCIONES_DE_REVALIDACION;
  const inc = input.incidente;
  if (inc.estado !== "ABIERTA" || inc.familia === "ATENCION") return false;
  const version = versionDelIncidente(inc.clave);
  if (version === null || version >= input.versionActual) return false;
  const yaSeRevalidaba = inc.hallazgos.some(esHallazgoDeRevalidacion);
  if (!yaSeRevalidaba && ORDEN_DE_SEVERIDAD[inc.severidad] < ORDEN_DE_SEVERIDAD.IMPORTANTE) return false;
  const inicio = input.inicio ?? inc.desde;
  return input.ahora.getTime() - inicio.getTime() >= op.antiguedadMinimaHoras * HORA;
}

function contar(fichas: FichaDelLead[], indicador: IndicadorDeTasa): Proporcion & { malos: string[] } {
  let exitos = 0;
  let total = 0;
  const malos: string[] = [];
  const malo = MALO_SI_SUBE.has(indicador);
  for (const f of fichas) {
    const v = valorDelIndicador(f, indicador);
    if (v === null) continue;
    total += 1;
    if (v) exitos += 1;
    if (v === malo) malos.push(f.conversationId);
  }
  return { exitos, total, malos };
}

/** Las métricas del incidente: principales (bot / cambio + respuesta en 2 h) y secundarias (embudo). */
export function metricasDelIncidente(hallazgos: Hallazgo[]): Array<{ indicador: IndicadorDeTasa; principal: boolean; hallazgo: Hallazgo | null }> {
  const defecto = delDefecto(hallazgos);
  const salida = new Map<IndicadorDeTasa, { indicador: IndicadorDeTasa; principal: boolean; hallazgo: Hallazgo | null }>();
  const soloEmbudo = !defecto.some((h) => h.familia === "BOT" || h.familia === "CAMBIO");
  const poner = (indicador: IndicadorDeTasa, principal: boolean, hallazgo: Hallazgo | null) => {
    const previo = salida.get(indicador);
    salida.set(indicador, {
      indicador,
      principal: Boolean(previo?.principal) || principal,
      // Para "lo que medía el incidente" sirve el hallazgo con proporción en el texto.
      hallazgo: previo?.hallazgo && proporcionDelTexto(previo.hallazgo.observado) ? previo.hallazgo : (hallazgo ?? previo?.hallazgo ?? null),
    });
  };
  for (const h of defecto) {
    // Un cambio de la regla del primer mensaje se juzga por lo que le hace al cliente: ráfaga y precio de entrada.
    if (h.clave.startsWith("BOT:regla-primer-mensaje")) {
      poner("rafaga_inicial", true, null);
      poner("precio_o_fotos_antes_de_identificar", true, null);
      continue;
    }
    // La vigilancia post-cambio dice "empeoró" por la respuesta en 2 h O por la ráfaga inicial.
    if (h.clave.startsWith("CAMBIO:post-cambio")) poner("rafaga_inicial", true, null);
    const indicador = indicadorDelHallazgo(h.clave);
    if (!indicador) continue;
    poner(indicador, soloEmbudo || h.familia !== "EMBUDO" || indicador === "respondio_2h", h);
  }
  // La respuesta del cliente en 2 h se mira SIEMPRE (igual que confirmarArreglo).
  poner("respondio_2h", true, null);
  return [...salida.values()];
}

const ETIQUETA_VEREDICTO: Record<VeredictoDeMetrica, string> = {
  ya_no: "ya no ocurre",
  sigue: "SIGUE",
  sin_muestra: "sin muestra suficiente",
  dudoso: "dudoso (se espera más)",
};

/** Desde qué versión los leads cuentan como "del comportamiento actual" del libro, y qué dice el Guardian hoy. */
export function versionDeReferencia(input: {
  version: number;
  versionActual: number;
  libros: Map<number, LibroDeReglas>;
  cambios: CambioDelLibro[];
  escenarios: Escenario[];
  flujos?: Record<string, FlujoConocido>;
  arreglo?: ArregloDelIncidente | null;
}): { desde: number; fallaHoy: boolean; tramoSano: number | null } {
  let desde = input.version + 1;
  if (input.arreglo && input.arreglo.version > desde) desde = input.arreglo.version;
  let tramoSano: number | null = null;
  let fallaHoy = false;
  const criticos = input.escenarios.filter((e) => e.critico);
  if (criticos.length) {
    const flujos = input.flujos ?? {};
    const guardadas = [...input.libros.keys()].filter((v) => v > input.version).sort((a, b) => b - a);
    for (const v of guardadas) {
      const libro = input.libros.get(v) as LibroDeReglas;
      if (!criticos.every((e) => evaluarEscenario({ ...libro, version: v }, e, flujos).pasa)) break;
      tramoSano = v;
    }
    const libroActual = input.libros.get(input.versionActual);
    fallaHoy = Boolean(libroActual) && !criticos.every((e) => evaluarEscenario({ ...(libroActual as LibroDeReglas), version: input.versionActual }, e, flujos).pasa);
    if (!fallaHoy && tramoSano !== null) desde = Math.max(desde, tramoSano);
  }
  // Antes de la primera versión con hora conocida, la versión de entrada de un lead no es segura.
  const primera = [...input.cambios].sort((a, b) => a.en.getTime() - b.en.getTime())[0]?.version ?? null;
  if (primera !== null && desde < primera) desde = primera;
  return { desde: Math.min(desde, input.versionActual), fallaHoy, tramoSano };
}

/** Revalida UN incidente contra el libro actual y los leads que entraron con él. */
export function revalidarIncidente(input: {
  incidente: Pick<Incidente, "clave" | "hallazgos" | "desde" | "producto">;
  fichas: FichaDelLead[];
  ahora: Date;
  versionActual: number;
  libroActual?: LibroDeReglas | null;
  libros: Map<number, LibroDeReglas>;
  cambios: CambioDelLibro[];
  escenarios: Escenario[];
  flujos?: Record<string, FlujoConocido>;
  arreglo?: ArregloDelIncidente | null;
  /** Desde cuándo rige la versión con el defecto (para la línea base de 14 días antes). */
  inicioDelDefecto: Date;
  filtro: FiltroDeLeads;
  opciones?: OpcionesDeRevalidacion;
}): Revalidacion {
  const op = input.opciones ?? OPCIONES_DE_REVALIDACION;
  const version = versionDelIncidente(input.incidente.clave) ?? 0;
  const referencia = versionDeReferencia({
    version,
    versionActual: input.versionActual,
    libros: input.libros,
    cambios: input.cambios,
    escenarios: input.escenarios,
    flujos: input.flujos,
    arreglo: input.arreglo,
  });
  const desdeHora = input.cambios.find((c) => c.version === referencia.desde)?.en ?? null;
  const delFiltro = input.fichas.filter(input.filtro);
  const ventanaDesde = input.ahora.getTime() - op.ventanaDias * DIA;
  const actuales = delFiltro.filter(
    (f) =>
      f.libroVersion !== null &&
      f.libroVersion >= referencia.desde &&
      f.libroVersion <= input.versionActual &&
      (!desdeHora || f.entradaEn.getTime() >= desdeHora.getTime()) &&
      f.entradaEn.getTime() >= ventanaDesde &&
      f.entradaEn.getTime() <= input.ahora.getTime(),
  );
  const inicio = input.inicioDelDefecto.getTime();
  const antes = delFiltro.filter((f) => f.entradaEn.getTime() < inicio && f.entradaEn.getTime() >= inicio - 14 * DIA);
  const porVersion: Record<string, number> = {};
  for (const f of actuales) porVersion[`v${f.libroVersion}`] = (porVersion[`v${f.libroVersion}`] ?? 0) + 1;

  const metricas: MetricaRevalidada[] = [];
  for (const { indicador, principal, hallazgo } of metricasDelIncidente(input.incidente.hallazgos)) {
    const regla = reglaDelIndicador(indicador);
    const maduras = actuales.filter((f) => disponible(f, indicador, input.ahora));
    const actual = contar(maduras, indicador);
    const reciente = contar(
      maduras.filter((f) => f.entradaEn.getTime() >= input.ahora.getTime() - op.ventanaRecienteHoras * HORA - MADURA_EN[indicador]),
      indicador,
    );
    // Línea base: los 14 días antes del defecto con las fichas; si no alcanzan, la que midió el detector
    // cuando abrió el hallazgo ("12,7 % (127/998, 14 días)"), que ya cumplió su mínimo en su momento.
    const baseDatos = contar(antes.filter((f) => disponible(f, indicador, input.ahora)), indicador);
    const baseDelTexto = baseDatos.total >= regla.minimoBase ? null : proporcionDelTexto(hallazgo?.esperado);
    const base: Proporcion | null = baseDatos.total >= regla.minimoBase ? { exitos: baseDatos.exitos, total: baseDatos.total } : baseDelTexto;
    const reglaBase = baseDelTexto ? { ...regla, minimoBase: 1 } : regla;
    const delIncidente = proporcionDelTexto(hallazgo?.observado);
    const maloSiSube = MALO_SI_SUBE.has(indicador);
    const esMalo = (puntos: number) => (maloSiSube ? puntos > 0 : puntos < 0);
    let veredicto: VeredictoDeMetrica;
    let detalle = "";
    if (actual.total < regla.minimoObservado) {
      veredicto = "sin_muestra";
      detalle = ` (mínimo ${regla.minimoObservado} leads con la versión actual)`;
    } else if (base) {
      const c = comparar(actual, base, reglaBase);
      const r = comparar(reciente, base, reglaBase);
      if ((c.significativo && esMalo(c.puntos)) || (r.significativo && esMalo(r.puntos))) {
        veredicto = "sigue";
        if (!(c.significativo && esMalo(c.puntos))) detalle = ` (en las últimas ${op.ventanaRecienteHoras} h: ${pct(r.tasaObservada)}, ${reciente.exitos}/${reciente.total})`;
      } else if (esMalo(c.puntos) && Math.abs(c.z) >= 2 && Math.abs(c.puntos) >= regla.puntosMinimos) veredicto = "dudoso";
      else veredicto = "ya_no";
    } else if (delIncidente) {
      // Sin línea base: tiene que estar claramente MEJOR que cuando se abrió el incidente.
      const c = comparar(actual, delIncidente, { ...regla, minimoBase: 1 });
      veredicto = c.significativo && !esMalo(c.puntos) ? "ya_no" : "dudoso";
      detalle = " (sin línea base de antes del defecto)";
    } else {
      veredicto = "dudoso";
      detalle = " (sin línea base de antes del defecto ni cifra del incidente)";
    }
    const partes = [
      `${NOMBRE_DEL_INDICADOR[indicador]}: ${pct(actual.total ? actual.exitos / actual.total : null)} (${actual.exitos}/${actual.total}) con la versión ≥ ${referencia.desde}`,
      delIncidente ? `vs ${pct(delIncidente.exitos / delIncidente.total)} (${delIncidente.exitos}/${delIncidente.total}) cuando se abrió el incidente` : null,
      base ? `y ${pct(base.exitos / base.total)} (${base.exitos}/${base.total}) en los 14 días antes del defecto` : null,
    ].filter(Boolean);
    metricas.push({
      indicador,
      principal,
      actual: { exitos: actual.exitos, total: actual.total },
      reciente: { exitos: reciente.exitos, total: reciente.total },
      base,
      delIncidente,
      veredicto,
      linea: `${partes.join(" ")}${detalle} → ${ETIQUETA_VEREDICTO[veredicto]}${principal ? "" : " (métrica secundaria del embudo)"}.`,
      chats: actual.malos.slice(0, 5),
    });
  }

  // El simulador (mismo motor que v3_probar_mensaje) con el libro actual: solo si el incidente es del bot.
  const delBot = delDefecto(input.incidente.hallazgos).some((h) => h.familia === "BOT" || (h.clave.startsWith("CAMBIO:libro:") && h.severidad !== "OBSERVACION"));
  const guardian = { corrido: false, fallaHoy: false, lineas: [] as string[], regla: null as string | null };
  const libroActual = input.libroActual ?? input.libros.get(input.versionActual) ?? null;
  if (delBot && libroActual && input.escenarios.length) {
    const flujos = input.flujos ?? {};
    const resultados = input.escenarios.map((e) => evaluarEscenario({ ...libroActual, version: input.versionActual }, e, flujos));
    const fallanCriticos = resultados.filter((r) => !r.pasa && r.critico);
    guardian.corrido = true;
    guardian.fallaHoy = fallanCriticos.length > 0;
    const anuncio = resultados.find((r) => r.id === "anuncio-exacto") ?? null;
    guardian.regla = anuncio?.regla ?? null;
    guardian.lineas.push(
      `Simulador del libro (mismo motor que v3_probar_mensaje) con la versión actual ${input.versionActual}: ${resultados.filter((r) => r.pasa).length}/${resultados.length} escenarios dorados pasan${fallanCriticos.length ? `; FALLAN críticos: ${fallanCriticos.map((r) => `"${r.nombre}" (${r.fallas.join("; ")})`).join(", ")}` : ""}.`,
    );
    if (anuncio) {
      guardian.lineas.push(
        `Texto exacto del anuncio: gana "${(anuncio.regla ?? "ninguna").slice(0, 90)}" con ${anuncio.mensajesEstimados} mensaje(s)${anuncio.pasa ? " y cumple lo esperado (sin fotos ni precio de entrada)" : `: ${anuncio.fallas.join("; ")}`}.`,
      );
      // La regla que salía en los ejemplos del síntoma (ráfaga / precio de entrada), ¿todavía gana el anuncio?
      const culpables = [
        ...new Set(
          delDefecto(input.incidente.hallazgos)
            .filter((h) => h.clave.startsWith("BOT:rafaga_inicial") || h.clave.startsWith("BOT:precio_o_fotos"))
            .flatMap((h) => h.evidencia.reglas),
        ),
      ].filter((r) => r && r !== anuncio.regla);
      for (const culpable of culpables.slice(0, 2)) {
        guardian.lineas.push(`"${culpable.slice(0, 70)}", la regla de los ejemplos del incidente, ya no gana el texto del anuncio.`);
      }
    }
  }

  const principales = metricas.filter((m) => m.principal);
  const sigue = metricas.filter((m) => m.veredicto === "sigue");
  let decision: DecisionDeRevalidacion;
  // El libro actual que falla un escenario crítico solo cuenta para un incidente del bot.
  if (sigue.length || guardian.fallaHoy) decision = "SIGUE";
  else if (actuales.length < op.minimoLeads || principales.some((m) => m.veredicto === "sin_muestra" || m.veredicto === "dudoso")) decision = "PENDIENTE";
  else decision = "RESUELTA";

  // Leads afectados HOY: los de la métrica que sigue con más afectados (o la principal con más, como dato).
  const candidatas = (sigue.length ? sigue : principales).map((m) => ({
    indicador: m.indicador,
    n: MALO_SI_SUBE.has(m.indicador) ? m.actual.exitos : m.actual.total - m.actual.exitos,
    total: m.actual.total,
    chats: m.chats,
  }));
  // Primero el síntoma en sí (ráfaga, precio de entrada…: malos cuando suben), después lo demás.
  const peor = candidatas.sort((a, b) => Number(MALO_SI_SUBE.has(b.indicador)) - Number(MALO_SI_SUBE.has(a.indicador)) || b.n - a.n)[0] ?? null;
  const afectados = sigue.length && peor ? { n: peor.n, total: peor.total, indicador: peor.indicador } : { n: 0, total: actuales.length, indicador: null };
  const chats = sigue.length ? [...new Set(sigue.flatMap((m) => m.chats))].slice(0, 5) : [];

  const versiones = Object.entries(porVersion)
    .sort((a, b) => Number(a[0].slice(1)) - Number(b[0].slice(1)))
    .map(([v, n]) => `${v} ${n}`)
    .join(", ");
  const hechos = [
    `Revalidado el ${hora(input.ahora)} (Bogotá) contra el libro actual v${input.versionActual}: ${actuales.length} leads del ${input.incidente.producto ?? "producto"} que entraron con la versión ≥ ${referencia.desde}${desdeHora ? ` (desde ${hora(desdeHora)})` : ""}, últimos ${op.ventanaDias} días${versiones ? ` (${versiones})` : ""}.`,
    ...(referencia.tramoSano !== null && !referencia.fallaHoy
      ? [`Change Guardian: desde la versión ${referencia.tramoSano} hasta la ${input.versionActual} el libro pasa todos los escenarios críticos.`]
      : []),
    ...metricas.map((m) => m.linea),
    ...guardian.lineas,
  ];
  if (actuales.length < op.minimoLeads) hechos.push(`Faltan leads: ${actuales.length} de ${op.minimoLeads} mínimos con la versión actual.`);
  return {
    clave: input.incidente.clave,
    decision,
    en: input.ahora,
    versionDelIncidente: version,
    versionActual: input.versionActual,
    versionDesde: referencia.desde,
    desde: desdeHora,
    leads: actuales.length,
    porVersion,
    metricas,
    guardian,
    hechos,
    afectados,
    chats,
  };
}

const RE_PREFIJO = /^(Revalidado: ya no ocurre con la versión \d+|Pendiente de revalidar con la versión \d+ \(falta muestra\)|Sigue con la versión \d+ \(revalidado\)): /;

/** El título sin el prefijo de la revalidación. */
export function tituloSinRevalidacion(titulo: string): string {
  return titulo.replace(RE_PREFIJO, "");
}

const ENLACE_SUPERVISOR = "/cliente/crm/supervisor";
const enlaceAlChat = (id: string) => `/cliente/chats?chatKey=${encodeURIComponent(`agent:${id}`)}&assigned=all`;

/** El hallazgo que deja la revalidación en la alerta (historial y pantalla). */
export function hallazgoDeRevalidacion(input: {
  revalidacion: Revalidacion;
  incidente: Pick<Incidente, "clave" | "producto" | "hallazgos">;
  severidad: Severidad;
  tituloBase: string;
  severidadBase: Severidad;
}): Hallazgo {
  const r = input.revalidacion;
  const defecto = delDefecto(input.incidente.hallazgos);
  const principal = [...defecto].sort((a, b) => ORDEN_DE_SEVERIDAD[b.severidad] - ORDEN_DE_SEVERIDAD[a.severidad])[0];
  const v = r.versionActual;
  const metricasQueSiguen = r.metricas.filter((m) => m.veredicto === "sigue");
  const faltan = r.metricas.filter((m) => m.principal && (m.veredicto === "sin_muestra" || m.veredicto === "dudoso"));
  const pctAfectados = r.afectados.total ? pct(r.afectados.n / r.afectados.total) : "—";
  const titulo =
    r.decision === "RESUELTA"
      ? `Revalidado: ya no ocurre con la versión ${v}`
      : r.decision === "PENDIENTE"
        ? `Pendiente de revalidar con la versión ${v} (falta muestra)`
        : `Sigue con la versión ${v} (revalidado)`;
  const que =
    r.decision === "RESUELTA"
      ? `Con los ${r.leads} leads que entraron con la versión ≥ ${r.versionDesde} el síntoma del incidente de la versión ${r.versionDelIncidente} ya no aparece. Se cierra como resuelto y queda en el historial.`
      : r.decision === "PENDIENTE"
        ? `Todavía no hay muestra suficiente con la versión actual para saber si el incidente de la versión ${r.versionDelIncidente} sigue (${faltan.map((m) => NOMBRE_DEL_INDICADOR[m.indicador]).join(", ") || `${r.leads} leads`}). No se escala mientras tanto.`
        : `El incidente de la versión ${r.versionDelIncidente} SIGUE con la versión actual ${v}: ${
            metricasQueSiguen.map((m) => `${NOMBRE_DEL_INDICADOR[m.indicador]} ${pct(m.actual.total ? m.actual.exitos / m.actual.total : null)} (${m.actual.exitos}/${m.actual.total})`).join(", ") ||
            "el libro actual falla escenarios críticos del Change Guardian"
          }. Afectados hoy: ${r.afectados.n} de ${r.afectados.total} leads (${pctAfectados}).`;
  const hechos = [...r.hechos];
  if (r.decision === "SIGUE") {
    hechos.push(`Leads afectados actualmente: ${r.afectados.n} de ${r.afectados.total} (${pctAfectados})${r.afectados.indicador ? ` · ${NOMBRE_DEL_INDICADOR[r.afectados.indicador]}` : ""}.`);
    hechos.push(`Decisión que necesita Alexander: ${principal?.tocaProduccion ? `autorizar o descartar: ${principal.queCambiar}` : "revisar el incidente y decidir el arreglo recomendado"}.`);
    hechos.push(`Enlace: ${ENLACE_SUPERVISOR}${r.chats[0] ? ` · chat de ejemplo: ${enlaceAlChat(r.chats[0])}` : ""}.`);
  }
  return {
    clave: `${PREFIJO_REVALIDACION}${input.incidente.clave}`,
    familia: "CAMBIO",
    severidad: r.decision === "SIGUE" ? input.severidad : "OBSERVACION",
    titulo,
    que,
    desde: r.desde ?? r.en,
    producto: input.incidente.producto,
    leadsAfectados: r.decision === "SIGUE" ? r.afectados.n : 0,
    evidencia: { chats: r.chats, reglas: r.guardian.regla ? [r.guardian.regla] : [], versiones: [r.versionDelIncidente, r.versionDesde, r.versionActual] },
    metrica: "Revalidación contra la versión actual del libro",
    esperado: "Sin el síntoma del incidente con la versión actual",
    observado: `${r.decision} · ${r.leads} leads con la versión ≥ ${r.versionDesde}`,
    hechos,
    hipotesis: [],
    causaPosible: principal?.causaPosible ?? `Defecto del libro V3 en la versión ${r.versionDelIncidente}.`,
    impacto:
      r.decision === "SIGUE"
        ? `Hoy ${r.afectados.n} de ${r.afectados.total} leads (${pctAfectados}) tienen el síntoma; cada lead nuevo con la versión ${v} lo sigue sufriendo hasta que se corrija.`
        : "—",
    recomendacion:
      r.decision === "SIGUE"
        ? principal?.recomendacion || "Revisar el incidente con los chats de ejemplo y corregir la regla culpable en el simulador."
        : r.decision === "PENDIENTE"
          ? "Nada todavía: se vuelve a revalidar cada hora hasta tener la muestra mínima."
          : "Nada. Queda en el historial con su evidencia; solo se vuelve a abrir si el síntoma reaparece con datos nuevos.",
    queCambiar: r.decision === "SIGUE" ? principal?.queCambiar || "Libro V3 (producción)." : "Nada.",
    riesgo: r.decision === "SIGUE" ? principal?.riesgo || "Bajo si se prueba antes en el simulador." : "—",
    comoMedir: "Revalidación de cada hora con los leads de la versión actual.",
    tocaProduccion: r.decision === "SIGUE" ? Boolean(principal?.tocaProduccion) : false,
    valores: {
      decision: r.decision,
      versionActual: v,
      versionDesde: r.versionDesde,
      leads: r.leads,
      revalidadoEn: r.en.toISOString(),
      tituloBase: input.tituloBase,
      severidadBase: input.severidadBase,
    },
  };
}

/**
 * Antes de consolidar: saca el hallazgo de la revalidación anterior y devuelve el título y la
 * severidad de base (así la revalidación de esta vuelta decide de nuevo, y con el interruptor
 * apagado el incidente vuelve a ser exactamente el de antes).
 */
export function quitarRevalidacion(incidentes: Incidente[]): Incidente[] {
  return incidentes.map((inc) => {
    const previo = inc.hallazgos.find(esHallazgoDeRevalidacion);
    if (!previo) return inc;
    const base = previo.valores?.severidadBase;
    const tituloBase = typeof previo.valores?.tituloBase === "string" ? previo.valores.tituloBase : tituloSinRevalidacion(inc.titulo);
    return {
      ...inc,
      hallazgos: inc.hallazgos.filter((h) => !esHallazgoDeRevalidacion(h)),
      titulo: RE_PREFIJO.test(inc.titulo) ? tituloBase : inc.titulo,
      severidad: base === "CRITICO" || base === "IMPORTANTE" || base === "OBSERVACION" ? base : inc.severidad,
    };
  });
}

type Aviso = { incidente: Incidente; motivo: "nuevo" | "sube" | "recordatorio" };

/**
 * Después de consolidar: revalida los incidentes viejos y aplica la decisión.
 *  - RESUELTA: se cierra con la evidencia (si era nuevo de esta vuelta, ni se crea).
 *  - PENDIENTE: tope IMPORTANTE, sin aviso (si era nuevo, ni se crea).
 *  - SIGUE: queda con el hallazgo de la revalidación arriba y avisa según la política de siempre.
 */
export function aplicarRevalidaciones(input: {
  incidentes: Incidente[];
  avisar: Aviso[];
  /** Claves que estaban abiertas antes de esta vuelta (lo demás es nuevo). */
  abiertasAntes: Set<string>;
  versionActual: number;
  ahora: Date;
  inicioDe: (inc: Incidente) => Date | null;
  revalidar: (inc: Incidente) => Revalidacion | null;
  /** Severidad que tendría el incidente solo con sus hallazgos del defecto (para escalar un SIGUE). */
  severidadDelDefecto?: (hallazgos: Hallazgo[]) => Severidad;
  opciones?: OpcionesDeRevalidacion;
  recordatorioCriticoMin?: number;
}): { incidentes: Incidente[]; avisar: Aviso[]; revalidaciones: Revalidacion[] } {
  const quitar = new Set<string>();
  const silenciar = new Set<string>();
  const revalidaciones: Revalidacion[] = [];
  const avisar = [...input.avisar];
  const recordatorio = (input.recordatorioCriticoMin ?? OPCIONES_POR_DEFECTO.recordatorioCriticoMin) * MIN;
  for (const inc of input.incidentes) {
    if (!aplicaRevalidacion({ incidente: inc, versionActual: input.versionActual, inicio: input.inicioDe(inc), ahora: input.ahora, opciones: input.opciones })) continue;
    const r = input.revalidar(inc);
    if (!r) continue;
    revalidaciones.push(r);
    const nuevo = !input.abiertasAntes.has(inc.clave);
    const tituloBase = tituloSinRevalidacion(inc.titulo);
    const severidadBase = inc.severidad;
    if (r.decision !== "SIGUE") {
      silenciar.add(inc.clave);
      if (nuevo) {
        // Un incidente viejo que el detector recrea con datos viejos no se vuelve a abrir.
        quitar.add(inc.clave);
        continue;
      }
    }
    const severidad: Severidad =
      r.decision === "RESUELTA"
        ? "OBSERVACION"
        : r.decision === "PENDIENTE"
          ? ORDEN_DE_SEVERIDAD[severidadBase] > ORDEN_DE_SEVERIDAD.IMPORTANTE
            ? "IMPORTANTE"
            : severidadBase
          : severidadMayor(severidadBase, input.severidadDelDefecto ? input.severidadDelDefecto(delDefecto(inc.hallazgos)) : severidadBase);
    const hallazgo = hallazgoDeRevalidacion({ revalidacion: r, incidente: inc, severidad, tituloBase, severidadBase });
    inc.hallazgos = [hallazgo, ...inc.hallazgos.filter((h) => !esHallazgoDeRevalidacion(h))];
    inc.titulo = `${hallazgo.titulo}: ${tituloBase}`;
    inc.severidad = severidad;
    inc.cambiadoEn = input.ahora;
    if (r.decision === "RESUELTA") {
      inc.estado = "RESUELTA";
      inc.resueltaEn = input.ahora;
    } else if (r.decision === "SIGUE" && !avisar.some((a) => a.incidente.clave === inc.clave)) {
      // Escalar con la política de siempre: nuevo / sube de severidad / recordatorio de CRÍTICO.
      let motivo: Aviso["motivo"] | null = null;
      const alcanza = ORDEN_DE_SEVERIDAD[severidad] >= ORDEN_DE_SEVERIDAD[OPCIONES_POR_DEFECTO.avisarDesde];
      if (alcanza && !inc.notificadaEn) motivo = "nuevo";
      else if (alcanza && inc.severidadNotificada && ORDEN_DE_SEVERIDAD[severidad] > ORDEN_DE_SEVERIDAD[inc.severidadNotificada]) motivo = "sube";
      else if (severidad === "CRITICO" && inc.notificadaEn && input.ahora.getTime() - inc.notificadaEn.getTime() >= recordatorio) motivo = "recordatorio";
      if (motivo) {
        inc.notificadaEn = input.ahora;
        inc.severidadNotificada = severidad;
        avisar.push({ incidente: inc, motivo });
      }
    }
  }
  return {
    incidentes: input.incidentes.filter((inc) => !quitar.has(inc.clave)),
    avisar: avisar.filter((a) => !silenciar.has(a.incidente.clave)),
    revalidaciones,
  };
}
