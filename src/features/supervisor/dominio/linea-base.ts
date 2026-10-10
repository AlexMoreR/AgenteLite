/**
 * LÍNEA BASE ADAPTATIVA del Supervisor (código puro).
 *
 * Para cada indicador se arman dos cohortes de leads YA MADUROS (su ventana pasó):
 *
 * - Observada: los que entraron en las últimas W horas, con W adaptativa (3, 6, 12, 24, 48 h): la
 *   ventana más corta que junte el mínimo de leads. De noche entra poca gente y la ventana se
 *   estira sola; de día alcanza con 3 h.
 * - Base: los 14 días anteriores a la ventana observada, dejando un día de colchón para que un
 *   problema que empezó hace horas no "contamine" su propia línea base.
 *
 * Además se mira el PERÍODO EQUIVALENTE (misma franja horaria de Bogotá y mismo día de la semana)
 * para no confundir un cambio de hora con un problema, y el ANTES/DESPUÉS de cada cambio de
 * versión del libro.
 */

import { comparar, moda, jensenShannon, type Comparacion, type Proporcion, SIGNIFICANCIA_POR_DEFECTO, type ReglaDeSignificancia } from "./estadistica";
import { disponible, valorDelIndicador, MADURA_EN, type FichaDelLead, type Indicador } from "./lead";

const HORA = 3_600_000;
const DIA = 24 * HORA;

export const VENTANAS_ADAPTATIVAS_H = [3, 6, 12, 24, 48] as const;
export const DIAS_DE_BASE = 14;

export type IndicadorDeTasa = Exclude<Indicador, "regla_primer_mensaje">;

export type FiltroDeLeads = (ficha: FichaDelLead) => boolean;

/** Hora de Bogotá (UTC−5, sin horario de verano). */
export function horaBogota(fecha: Date): number {
  return (fecha.getUTCHours() + 24 - 5) % 24;
}

export function diaSemanaBogota(fecha: Date): number {
  return new Date(fecha.getTime() - 5 * HORA).getUTCDay();
}

/** Franja de 6 h: 0 madrugada (0–6), 1 mañana (6–12), 2 tarde (12–18), 3 noche (18–24). */
export function franja(fecha: Date): number {
  return Math.floor(horaBogota(fecha) / 6);
}

export const NOMBRE_DE_FRANJA = ["madrugada", "mañana", "tarde", "noche"];

function proporcion(fichas: FichaDelLead[], indicador: IndicadorDeTasa): Proporcion & { chats: string[] } {
  let exitos = 0;
  let total = 0;
  const chats: string[] = [];
  for (const ficha of fichas) {
    const valor = valorDelIndicador(ficha, indicador);
    if (valor === null) continue;
    total += 1;
    if (valor) {
      exitos += 1;
      if (chats.length < 20) chats.push(ficha.conversationId);
    }
  }
  return { exitos, total, chats };
}

function entre(ficha: FichaDelLead, desde: number, hasta: number): boolean {
  const t = ficha.entradaEn.getTime();
  return t >= desde && t < hasta;
}

export type ComparacionConBase = Comparacion & {
  indicador: IndicadorDeTasa;
  ventanaHoras: number;
  observadaDesde: Date;
  observadaHasta: Date;
  chatsObservados: string[];
  /** Contra la misma franja horaria de los días base (null si no hay muestra). */
  mismaFranja: Comparacion | null;
  /** Contra el mismo día de la semana (null si no hay muestra). */
  mismoDia: Comparacion | null;
};

/**
 * Compara un indicador de tasa (lo reciente contra la línea base). `filtro` limita a un producto,
 * una asesora o una versión del libro.
 */
export function compararConBase(
  fichas: FichaDelLead[],
  indicador: IndicadorDeTasa,
  ahora: Date,
  filtro: FiltroDeLeads = () => true,
  regla: ReglaDeSignificancia = SIGNIFICANCIA_POR_DEFECTO,
): ComparacionConBase | null {
  const maduros = fichas.filter((f) => filtro(f) && disponible(f, indicador, ahora));
  const corte = ahora.getTime() - MADURA_EN[indicador];

  for (const horas of VENTANAS_ADAPTATIVAS_H) {
    const desde = corte - horas * HORA;
    const observadas = maduros.filter((f) => entre(f, desde, corte + 1));
    const obs = proporcion(observadas, indicador);
    if (obs.total < regla.minimoObservado && horas !== VENTANAS_ADAPTATIVAS_H.at(-1)) continue;

    const baseHasta = desde - DIA;
    const baseDesde = baseHasta - DIAS_DE_BASE * DIA;
    const base = maduros.filter((f) => entre(f, baseDesde, baseHasta));
    const esperado = proporcion(base, indicador);
    const comparacion = comparar(obs, esperado, regla);

    // Período equivalente: misma franja horaria / mismo día de la semana (de la entrada de los observados).
    const franjas = new Set(observadas.map((f) => franja(f.entradaEn)));
    const dias = new Set(observadas.map((f) => diaSemanaBogota(f.entradaEn)));
    const baseFranja = proporcion(base.filter((f) => franjas.has(franja(f.entradaEn))), indicador);
    const baseDia = proporcion(base.filter((f) => dias.has(diaSemanaBogota(f.entradaEn))), indicador);
    const reglaChica = { ...regla, minimoBase: Math.max(20, Math.floor(regla.minimoBase / 2)) };

    return {
      ...comparacion,
      indicador,
      ventanaHoras: horas,
      observadaDesde: new Date(desde),
      observadaHasta: new Date(corte),
      chatsObservados: obs.chats,
      mismaFranja: baseFranja.total >= reglaChica.minimoBase ? comparar(obs, baseFranja, reglaChica) : null,
      mismoDia: baseDia.total >= reglaChica.minimoBase ? comparar(obs, baseDia, reglaChica) : null,
    };
  }
  return null;
}

/** Antes / después de un momento (un cambio de versión del libro), con leads ya maduros. */
export function compararAntesYDespues(
  fichas: FichaDelLead[],
  indicador: IndicadorDeTasa,
  ahora: Date,
  momento: Date,
  filtro: FiltroDeLeads = () => true,
  regla: ReglaDeSignificancia = SIGNIFICANCIA_POR_DEFECTO,
  limites: { antesDesde?: Date | null; despuesHasta?: Date | null } = {},
): (Comparacion & { chatsDespues: string[] }) | null {
  const maduros = fichas.filter((f) => filtro(f) && disponible(f, indicador, ahora));
  const m = momento.getTime();
  const hasta = limites.despuesHasta ? limites.despuesHasta.getTime() : Infinity;
  const desdeAntes = Math.max(m - DIAS_DE_BASE * DIA, limites.antesDesde ? limites.antesDesde.getTime() : -Infinity);
  const despues = proporcion(maduros.filter((f) => f.entradaEn.getTime() >= m && f.entradaEn.getTime() < hasta), indicador);
  const antes = proporcion(maduros.filter((f) => entre(f, desdeAntes, m)), indicador);
  if (despues.total === 0) return null;
  return { ...comparar(despues, antes, regla), chatsDespues: despues.chats };
}

export type DistribucionDeReglas = {
  observado: Record<string, number>;
  base: Record<string, number>;
  js: number;
  modaObservada: ReturnType<typeof moda>;
  modaBase: ReturnType<typeof moda>;
  ventanaHoras: number;
  observadaDesde: Date;
  chats: string[];
  /** Chat de ejemplo por regla en la ventana observada. */
  ejemplo: Record<string, string>;
};

/**
 * Qué regla gana el primer mensaje: lo reciente contra la base (o contra lo de antes de un
 * momento, si se pasa `desdeMomento`). Solo leads cuyo primer turno ya pasó y con nota del V3.
 */
export function distribucionDeReglas(
  fichas: FichaDelLead[],
  ahora: Date,
  filtro: FiltroDeLeads = () => true,
  minimo = 10,
  desdeMomento?: Date,
): DistribucionDeReglas | null {
  const maduros = fichas.filter((f) => filtro(f) && f.reglaPrimerMensaje && disponible(f, "regla_primer_mensaje", ahora));
  const corte = ahora.getTime() - MADURA_EN.regla_primer_mensaje;
  const contar = (lista: FichaDelLead[]) => {
    const conteo: Record<string, number> = {};
    for (const f of lista) conteo[f.reglaPrimerMensaje as string] = (conteo[f.reglaPrimerMensaje as string] ?? 0) + 1;
    return conteo;
  };
  const ventanas = desdeMomento ? [Math.max(0, (corte - desdeMomento.getTime()) / HORA)] : [...VENTANAS_ADAPTATIVAS_H];
  for (const horas of ventanas) {
    const desde = desdeMomento ? desdeMomento.getTime() : corte - horas * HORA;
    const observadas = maduros.filter((f) => entre(f, desde, corte + 1));
    if (observadas.length < minimo && horas !== ventanas.at(-1)) continue;
    const baseHasta = desdeMomento ? desdeMomento.getTime() : desde - DIA;
    const base = maduros.filter((f) => entre(f, baseHasta - DIAS_DE_BASE * DIA, baseHasta));
    const observado = contar(observadas);
    const conteoBase = contar(base);
    const ejemplo: Record<string, string> = {};
    for (const f of observadas) ejemplo[f.reglaPrimerMensaje as string] ??= f.conversationId;
    return {
      observado,
      base: conteoBase,
      js: jensenShannon(observado, conteoBase),
      modaObservada: moda(observado),
      modaBase: moda(conteoBase),
      ventanaHoras: horas,
      observadaDesde: new Date(desde),
      chats: observadas.slice(0, 20).map((f) => f.conversationId),
      ejemplo,
    };
  }
  return null;
}
