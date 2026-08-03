/**
 * Posponer un lead: sacarlo de "Mi dia" hasta un momento dado.
 *
 * La lista decide sola que es urgente, pero la asesora sabe cosas que el sistema no: que quedo
 * de llamar despues del almuerzo, que la clienta pidio que le escriban el lunes, que ya lo
 * trabajo y no hay nada mas que hacer hoy. Sin poder sacarlo, el mismo lead le queda arriba
 * pinchandola todo el dia y la lista deja de significar algo.
 *
 * Se guarda en la ficha del contacto (metadata) y no en una columna nueva: la base de produccion
 * viene con drift y una migracion ahi es un riesgo que este boton no justifica.
 */

const CLAVE = "snoozedUntil";

function comoRegistro(metadata: unknown): Record<string, unknown> {
  return metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>)
    : {};
}

/** Hasta cuando esta pospuesto, o null si no lo esta. */
export function readSnoozedUntil(metadata: unknown): Date | null {
  const valor = comoRegistro(metadata)[CLAVE];
  if (typeof valor !== "string" || !valor.trim()) {
    return null;
  }
  const fecha = new Date(valor);
  return Number.isFinite(fecha.getTime()) ? fecha : null;
}

/** ¿Sigue pospuesto AHORA? Un vencido no cuenta: vuelve solo a la lista. */
export function isSnoozed(metadata: unknown, now = new Date()): boolean {
  const hasta = readSnoozedUntil(metadata);
  return hasta !== null && hasta.getTime() > now.getTime();
}

export function buildSnoozeMetadata(metadata: unknown, hasta: Date | null): Record<string, unknown> {
  const base = { ...comoRegistro(metadata) };
  if (!hasta) {
    delete base[CLAVE];
    return base;
  }
  base[CLAVE] = hasta.toISOString();
  return base;
}

/** Las opciones del boton, en minutos. "Personalizado" lo elige ella con fecha y hora. */
export const SNOOZE_PRESETS = [
  { label: "5 minutos", minutos: 5 },
  { label: "2 horas", minutos: 120 },
  { label: "1 día", minutos: 60 * 24 },
  { label: "3 días", minutos: 60 * 24 * 3 },
] as const;
