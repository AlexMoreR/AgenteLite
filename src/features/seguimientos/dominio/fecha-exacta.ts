// Fecha exacta de un seguimiento, siempre en hora de Colombia (UTC-5 fijo: Colombia no cambia la hora).
// Funciones puras: sin base de datos y sin imports con alias, para poder probarlas con Node solo.

const DESFASE_COLOMBIA_HORAS = 5;
const MINUTO_MS = 60 * 1000;
const DIA_MS = 24 * 60 * MINUTO_MS;

export const MAXIMO_DIAS_FECHA_EXACTA = 90;

export type ResultadoFechaExacta = { ok: true } | { ok: false; motivo: "pasada" | "muy lejana" };

/** Convierte 'YYYY-MM-DDTHH:mm' (input datetime-local) tomado como hora de Colombia a un instante UTC. */
export function horaDeBogotaAUtc(valor: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(valor.trim());
  if (!m) return null;
  const [anio, mes, dia, hora, minuto] = m.slice(1).map(Number);
  const fecha = new Date(Date.UTC(anio, mes - 1, dia, hora + DESFASE_COLOMBIA_HORAS, minuto));
  if (Number.isNaN(fecha.getTime())) return null;
  // Rechaza fechas que JS "corrige" solas (31 de febrero, hora 25).
  const ida = new Date(fecha.getTime() - DESFASE_COLOMBIA_HORAS * 60 * MINUTO_MS);
  if (
    ida.getUTCFullYear() !== anio ||
    ida.getUTCMonth() !== mes - 1 ||
    ida.getUTCDate() !== dia ||
    ida.getUTCHours() !== hora ||
    ida.getUTCMinutes() !== minuto
  ) {
    return null;
  }
  return fecha;
}

/**
 * 'pasada' si ya paso; 'muy lejana' si queda a más de 90 días.
 *
 * Antes pedia al menos 1 minuto: a las 9:35 y medio, "9:36" quedaba a 30 segundos y salia "escoge
 * una hora que todavia no haya pasado" (Alex, 11-nov-2026). Ahora vale cualquier hora que no paso.
 * El servidor la revisa con `holguraMs` (lo que tarda en llegar el pedido): si sale unos segundos
 * tarde, el reloj la manda en su proxima vuelta.
 */
export function validarFechaExacta(fecha: Date, ahora: Date, holguraMs = 0): ResultadoFechaExacta {
  const diferencia = fecha.getTime() - ahora.getTime();
  if (Number.isNaN(diferencia) || diferencia <= -holguraMs) return { ok: false, motivo: "pasada" };
  if (diferencia > MAXIMO_DIAS_FECHA_EXACTA * DIA_MS) return { ok: false, motivo: "muy lejana" };
  return { ok: true };
}

/** 'YYYY-MM-DDTHH:mm' en hora de Colombia, para el atributo `min` del calendario. */
export function ahoraEnBogotaParaInput(ahora: Date): string {
  return new Date(ahora.getTime() - DESFASE_COLOMBIA_HORAS * 60 * MINUTO_MS).toISOString().slice(0, 16);
}

/** 'HH:mm' de ahora en hora de Colombia, para el selector de hora de los atajos. */
export function horaDeBogotaParaInput(ahora: Date): string {
  return ahoraEnBogotaParaInput(ahora).slice(11, 16);
}

/**
 * 'YYYY-MM-DDTHH:mm' (hora de Colombia) del dia de hoy + `dias`, a la hora `hora` ('HH:mm').
 * Para los atajos "Mañana", "En 2 días"...: el dia se cuenta en el calendario de Colombia.
 */
export function diaMasHoraDeBogota(ahora: Date, dias: number, hora: string): string | null {
  if (!/^\d{2}:\d{2}$/.test(hora)) return null;
  const dia = new Date(ahora.getTime() - DESFASE_COLOMBIA_HORAS * 60 * MINUTO_MS + dias * DIA_MS);
  return `${dia.toISOString().slice(0, 10)}T${hora}`;
}

/** Ejemplo: 'mar. 3 nov., 3:30 p. m.' */
export function formatoBogota(fecha: Date): string {
  return new Intl.DateTimeFormat("es-CO", {
    timeZone: "America/Bogota",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(fecha);
}
