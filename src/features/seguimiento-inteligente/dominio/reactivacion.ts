/**
 * "LLAMAR SOLO LAS DE 7 DÍAS O MENOS" (Alexander, 13-10-2026). Código puro.
 *
 * Una tarea de la Recuperación 72 h (motivo `recuperacion_72h`) cuyo cliente escribió por última vez
 * hace más de `recuperacion72h.vencerTrasDias` días ya no es trabajo de las asesoras: sale de Mi
 * día, del tope, del Supervisor y de la alarma, y queda marcada para una futura campaña de
 * reactivación (`accionDatos.paraReactivar`). No se crea ni se envía ninguna campaña.
 *
 * Si el cliente vuelve a escribir, su último mensaje es reciente y la tarea vuelve a contar.
 * `vencerTrasDias` = 0 apaga la regla (todo como antes).
 *
 * La misma regla está escrita en SQL en servicios/reactivacion.ts (filtro de las listas y marca).
 */

export const MOTIVO_RECUPERACION_72H = "recuperacion_72h";

const DIA_MS = 86_400_000;

/** Desde cuándo el último mensaje del cliente "cuenta" (null = regla apagada). */
export function corteDeReactivacion(ahora: Date, vencerTrasDias: number): Date | null {
  if (!Number.isFinite(vencerTrasDias) || vencerTrasDias <= 0) return null;
  return new Date(ahora.getTime() - vencerTrasDias * DIA_MS);
}

/**
 * ¿Esta tarea va a reactivación (y no a la lista de la asesora)?
 * Solo las tareas de la Recuperación 72 h; sin ningún mensaje del cliente también (no hay a quién
 * "recuperar" de esta semana).
 */
export function vaAReactivacion(input: {
  accion: string | null | undefined;
  motivo: string | null | undefined;
  ultimoClienteEn: Date | null | undefined;
  ahora: Date;
  vencerTrasDias: number;
}): boolean {
  if (input.accion !== "tarea_asesora" || input.motivo !== MOTIVO_RECUPERACION_72H) return false;
  const corte = corteDeReactivacion(input.ahora, input.vencerTrasDias);
  if (!corte) return false;
  if (!input.ultimoClienteEn) return true;
  return input.ultimoClienteEn.getTime() < corte.getTime();
}

/** Separa las tareas: las que siguen para las asesoras y las que van a reactivación. */
export function separarParaReactivar<T extends { accion: string | null; motivo: string | null; ultimoClienteEn: Date | null }>(
  tareas: ReadonlyArray<T>,
  ahora: Date,
  vencerTrasDias: number,
): { siguen: T[]; paraReactivar: T[] } {
  const siguen: T[] = [];
  const paraReactivar: T[] = [];
  for (const tarea of tareas) {
    (vaAReactivacion({ ...tarea, ahora, vencerTrasDias }) ? paraReactivar : siguen).push(tarea);
  }
  return { siguen, paraReactivar };
}
