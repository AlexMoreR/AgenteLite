/**
 * "RECIBIENDO CLIENTES": las reglas, sin base de datos (para poder probarlas solas).
 *
 * Idea de Alex (08-10-2026): sin horario fijo, cada asesora decide cuándo trabaja.
 *  - Abre el CRM (o vuelve a la app) → queda "Recibiendo clientes" sola.
 *  - Sale de la app o la cierra → deja de recibir cuando pasan 7 min sin latido. El latido sale
 *    cada 4 min SOLO con la app visible, y uno más al esconderla, así que mirar una foto o
 *    contestar una llamada (menos de 5 min) no la saca del reparto.
 *  - Puede ponerse en Pausa a mano (almuerzo). Esa pausa se respeta hasta que ella la quite o
 *    hasta el día siguiente: al abrir la app otro día vuelve a recibir sola.
 *  - Si nadie está recibiendo, el cliente nuevo va a la asesora de respaldo (Ingrid), con aviso.
 *
 * Esto es aparte de la pausa de reparto de Mi empresa → Equipo, que pone un jefe (vacaciones) y
 * manda por encima de todo: quien está pausada ahí no recibe aunque esté en línea.
 */

/** Sin latido en este rato, ya no recibe. Más que los 4 min entre latidos, con 5 min de margen. */
export const VENCE_EL_LATIDO_MS = 7 * 60_000;

export type Presencia = {
  ultimoLatido: Date;
  /** Desde cuándo recibe sin cortes. null = no está recibiendo. */
  enLineaDesde: Date | null;
  /** Cuándo se puso en Pausa a mano. */
  pausaManualEn: Date | null;
};

export type PeriodoCerrado = { inicio: Date; fin: Date };

/** Colombia no cambia de hora: el día del negocio es la hora UTC menos cinco. */
const DESFASE_BOGOTA_MS = 5 * 60 * 60_000;

export function diaEnBogota(fecha: Date): string {
  return new Date(fecha.getTime() - DESFASE_BOGOTA_MS).toISOString().slice(0, 10);
}

/** La pausa a mano vale el mismo día en que se puso. Al otro día, abrir la app la quita. */
export function pausaManualVigente(presencia: Presencia | null, ahora: Date): boolean {
  return Boolean(presencia?.pausaManualEn && diaEnBogota(presencia.pausaManualEn) === diaEnBogota(ahora));
}

export function estaRecibiendo(presencia: Presencia | null, ahora: Date): boolean {
  if (!presencia || !presencia.enLineaDesde || pausaManualVigente(presencia, ahora)) {
    return false;
  }
  return ahora.getTime() - presencia.ultimoLatido.getTime() <= VENCE_EL_LATIDO_MS;
}

/** Hasta cuándo contó como "recibiendo" un periodo que se cortó por falta de latido. */
export function finPorVencimiento(presencia: Presencia, ahora: Date): Date {
  return new Date(Math.min(presencia.ultimoLatido.getTime() + VENCE_EL_LATIDO_MS, ahora.getTime()));
}

function periodoQueQuedoAbierto(presencia: Presencia | null, ahora: Date): PeriodoCerrado | null {
  if (!presencia?.enLineaDesde) {
    return null;
  }
  return { inicio: presencia.enLineaDesde, fin: finPorVencimiento(presencia, ahora) };
}

/**
 * Llega un latido (la app está visible). Si no está en pausa a mano, queda recibiendo; si venía de
 * un periodo vencido, ese periodo se cierra y empieza otro.
 */
export function alLatir(
  presencia: Presencia | null,
  ahora: Date,
): { presencia: Presencia; cerrar: PeriodoCerrado | null } {
  if (presencia && pausaManualVigente(presencia, ahora)) {
    return { presencia: { ...presencia, ultimoLatido: ahora, enLineaDesde: null }, cerrar: periodoQueQuedoAbierto(presencia, ahora) };
  }
  if (presencia && estaRecibiendo(presencia, ahora)) {
    return { presencia: { ...presencia, ultimoLatido: ahora }, cerrar: null };
  }
  return {
    presencia: { ultimoLatido: ahora, enLineaDesde: ahora, pausaManualEn: null },
    cerrar: periodoQueQuedoAbierto(presencia, ahora),
  };
}

/** Ella toca "Pausada". Se cierra el periodo en este instante. */
export function alPausarAMano(
  presencia: Presencia | null,
  ahora: Date,
): { presencia: Presencia; cerrar: PeriodoCerrado | null } {
  const cerrar = presencia?.enLineaDesde
    ? { inicio: presencia.enLineaDesde, fin: estaRecibiendo(presencia, ahora) ? ahora : finPorVencimiento(presencia, ahora) }
    : null;
  return {
    presencia: { ultimoLatido: presencia?.ultimoLatido ?? ahora, enLineaDesde: null, pausaManualEn: ahora },
    cerrar,
  };
}

/** Ella toca "Recibiendo clientes": es como un latido que además quita la pausa a mano. */
export function alActivarAMano(
  presencia: Presencia | null,
  ahora: Date,
): { presencia: Presencia; cerrar: PeriodoCerrado | null } {
  return alLatir(presencia ? { ...presencia, pausaManualEn: null } : null, ahora);
}

/**
 * A quién le toca el cliente nuevo.
 *
 * `rueda` es la lista completa del turno (colaboradoras activas, sin pausadas por un jefe ni las
 * que solo monitorean); `disponibles`, las de esa lista que están en horario y recibiendo. Se
 * sigue la rueda desde la última que recibió. Si no hay nadie disponible, va a la de respaldo,
 * siempre que esté en la rueda (si un jefe la pausó o la sacó de la línea, no se le fuerza).
 */
export function elegirAsesora(input: {
  rueda: string[];
  disponibles: Set<string>;
  ultimaAsignada: string | null;
  respaldo: string | null;
}): { userId: string; porRespaldo: boolean } | null {
  const { rueda, disponibles } = input;
  const desde = input.ultimaAsignada ? rueda.indexOf(input.ultimaAsignada) : -1;
  const siguiente = Array.from({ length: rueda.length }, (_, paso) => rueda[(desde + 1 + paso) % rueda.length]).find(
    (userId) => disponibles.has(userId),
  );
  if (siguiente) {
    return { userId: siguiente, porRespaldo: false };
  }
  if (input.respaldo && rueda.includes(input.respaldo)) {
    return { userId: input.respaldo, porRespaldo: true };
  }
  return null;
}

/** Minutos de una lista de periodos que caen dentro de [desde, hasta). */
export function minutosEnRango(periodos: PeriodoCerrado[], desde: Date, hasta: Date): number {
  let ms = 0;
  for (const periodo of periodos) {
    const inicio = Math.max(periodo.inicio.getTime(), desde.getTime());
    const fin = Math.min(periodo.fin.getTime(), hasta.getTime());
    if (fin > inicio) {
      ms += fin - inicio;
    }
  }
  return Math.round(ms / 60_000);
}

/** "3 h 20 min", "45 min", "—". */
export function formatoDeHoras(minutos: number): string {
  if (minutos <= 0) return "—";
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  if (horas === 0) return `${resto} min`;
  return resto === 0 ? `${horas} h` : `${horas} h ${resto} min`;
}
