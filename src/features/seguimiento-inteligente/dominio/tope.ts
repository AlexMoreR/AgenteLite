/**
 * TOPE DE TAREAS POR ASESORA (código puro).
 *
 * Decisión de Alexander (10-10-2026): máximo 15 tareas de seguimiento al día por asesora. La
 * simulación de la semana daba picos de 47 para Ingrid.
 *
 * Cómo se reparte (en cada vuelta del reloj, sobre las tareas que todavía no tienen plan HOY):
 *  1. Orden: prioridad (A, luego B, luego C), después la más caliente (Caliente, Tibio, Frío) y,
 *     entre iguales, la más antigua (la que venció primero).
 *  2. Si la dueña del chat tiene cupo, es suya.
 *  3. Si no, pasa a otra asesora ELEGIBLE con cupo (en el reparto de esa línea, sin pausa ni
 *     monitoreo y dentro de su horario), la de menos carga.
 *  4. Si nadie tiene cupo, queda "pospuesta por tope" para el día siguiente a las 8:00. Nunca se
 *     pierde: al otro día vuelve a entrar al reparto con su prioridad y su antigüedad.
 *  - Lo ya planeado hoy no se mueve (la asesora no ve tareas que aparecen y desaparecen).
 *  - Las tareas sin dueña no cuentan para ningún tope: siguen siendo alerta del Supervisor.
 */

export type EstadoDelTope = "propia" | "redistribuida" | "pospuesta" | "sin_duena";

export type TareaParaElTope = {
  conversationId: string;
  prioridad: string;
  temperatura: string | null;
  vence: Date | null;
  /** La asesora del chat (null = sin dueña). */
  duena: string | null;
  /** Asesoras que pueden recibir esta tarea si la dueña está llena (reparto de la línea, horario). */
  elegibles: string[];
  /** El plan que ya tiene, si lo tiene. */
  plan?: { dia: string; para: string | null; estado: EstadoDelTope; pospuestaHasta?: string | null } | null;
};

export type PlanDeTarea = {
  conversationId: string;
  dia: string;
  para: string | null;
  estado: EstadoDelTope;
  /** De quién era (cuando se redistribuye o se pospone). */
  de: string | null;
  pospuestaHasta: string | null;
};

const DESFASE_BOGOTA_MS = -5 * 3_600_000;
const DIA_MS = 86_400_000;

/** "2026-10-10": el día de Bogotá de esa fecha. */
export function diaBogota(fecha: Date): string {
  return new Date(fecha.getTime() + DESFASE_BOGOTA_MS).toISOString().slice(0, 10);
}

/** Mañana a las 8:00 de Bogotá. */
export function mananaALas8(fecha: Date): Date {
  const local = fecha.getTime() + DESFASE_BOGOTA_MS;
  const medianoche = local - (((local % DIA_MS) + DIA_MS) % DIA_MS) - DESFASE_BOGOTA_MS;
  return new Date(medianoche + DIA_MS + 8 * 3_600_000);
}

const ORDEN_PRIORIDAD: Record<string, number> = { A: 0, B: 1, C: 2 };
const ORDEN_TEMPERATURA: Record<string, number> = { CALIENTE: 0, TIBIO: 1, FRIO: 2 };

export function ordenarTareas<T extends Pick<TareaParaElTope, "prioridad" | "temperatura" | "vence" | "conversationId">>(tareas: T[]): T[] {
  return [...tareas].sort(
    (a, b) =>
      (ORDEN_PRIORIDAD[a.prioridad] ?? 9) - (ORDEN_PRIORIDAD[b.prioridad] ?? 9) ||
      (ORDEN_TEMPERATURA[a.temperatura ?? ""] ?? 9) - (ORDEN_TEMPERATURA[b.temperatura ?? ""] ?? 9) ||
      (a.vence?.getTime() ?? 0) - (b.vence?.getTime() ?? 0) ||
      a.conversationId.localeCompare(b.conversationId),
  );
}

/**
 * Planea las tareas de hoy. Devuelve SOLO los planes nuevos o que cambian (las que ya tienen plan
 * de hoy, o están pospuestas para más tarde, se dejan como están y cuentan en la carga).
 * `tope` 0 = sin tope (todas propias).
 */
export function planearTareas(input: { tareas: TareaParaElTope[]; tope: number; ahora: Date }): PlanDeTarea[] {
  const hoy = diaBogota(input.ahora);
  const carga = new Map<string, number>();
  const sumar = (asesora: string) => carga.set(asesora, (carga.get(asesora) ?? 0) + 1);
  const pendientes: TareaParaElTope[] = [];
  for (const tarea of input.tareas) {
    const plan = tarea.plan;
    if (plan && plan.dia === hoy && plan.estado !== "pospuesta") {
      if (plan.para) sumar(plan.para);
      continue;
    }
    // Pospuesta para un momento que todavía no llegó: se queda quieta.
    if (plan?.estado === "pospuesta" && plan.pospuestaHasta && new Date(plan.pospuestaHasta).getTime() > input.ahora.getTime()) continue;
    pendientes.push(tarea);
  }

  const sinTope = input.tope <= 0;
  const conCupo = (asesora: string) => sinTope || (carga.get(asesora) ?? 0) < input.tope;
  const salida: PlanDeTarea[] = [];
  for (const tarea of ordenarTareas(pendientes)) {
    const base = { conversationId: tarea.conversationId, dia: hoy, de: tarea.duena, pospuestaHasta: null };
    if (!tarea.duena) {
      salida.push({ ...base, para: null, estado: "sin_duena" });
      continue;
    }
    if (conCupo(tarea.duena)) {
      sumar(tarea.duena);
      salida.push({ ...base, para: tarea.duena, estado: "propia" });
      continue;
    }
    const otra = tarea.elegibles
      .filter((asesora) => asesora !== tarea.duena && conCupo(asesora))
      .sort((a, b) => (carga.get(a) ?? 0) - (carga.get(b) ?? 0))[0];
    if (otra) {
      sumar(otra);
      salida.push({ ...base, para: otra, estado: "redistribuida" });
      continue;
    }
    salida.push({ ...base, para: tarea.duena, estado: "pospuesta", pospuestaHasta: mananaALas8(input.ahora).toISOString() });
  }
  return salida;
}
