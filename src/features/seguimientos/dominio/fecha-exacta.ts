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

/** 'pasada' si queda a menos de 1 minuto de ahora; 'muy lejana' si queda a más de 90 días. */
export function validarFechaExacta(fecha: Date, ahora: Date): ResultadoFechaExacta {
  const diferencia = fecha.getTime() - ahora.getTime();
  if (Number.isNaN(diferencia) || diferencia < MINUTO_MS) return { ok: false, motivo: "pasada" };
  if (diferencia > MAXIMO_DIAS_FECHA_EXACTA * DIA_MS) return { ok: false, motivo: "muy lejana" };
  return { ok: true };
}

/** 'YYYY-MM-DDTHH:mm' en hora de Colombia, para el atributo `min` del calendario. */
export function ahoraEnBogotaParaInput(ahora: Date): string {
  return new Date(ahora.getTime() - DESFASE_COLOMBIA_HORAS * 60 * MINUTO_MS).toISOString().slice(0, 16);
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
