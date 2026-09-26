/*
  Los tipos y reglas del horario de reparto que también usa la pantalla de Equipo (componente de
  cliente). Lo que toca la base vive en `horario-de-reparto.ts`.
*/

export type ModoDelDia = "todo" | "horas" | "nada";

export type HorarioDelDia = { modo: ModoDelDia; desde: string; hasta: string };

/** Índice 0 = domingo ... 6 = sábado, igual que `Date.getDay()`. */
export type HorarioSemanal = HorarioDelDia[];

export const DIAS_DE_LA_SEMANA = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

const HORA_VALIDA = /^([01]\d|2[0-3]):[0-5]\d$/;

export function horarioSiempre(): HorarioSemanal {
  return DIAS_DE_LA_SEMANA.map(() => ({ modo: "todo", desde: "08:00", hasta: "18:00" }));
}

function normalizarDia(valor: unknown): HorarioDelDia {
  const fila = valor && typeof valor === "object" ? (valor as Record<string, unknown>) : {};
  const modo: ModoDelDia = fila.modo === "horas" || fila.modo === "nada" ? fila.modo : "todo";
  const desde = typeof fila.desde === "string" && HORA_VALIDA.test(fila.desde) ? fila.desde : "08:00";
  const hasta = typeof fila.hasta === "string" && HORA_VALIDA.test(fila.hasta) ? fila.hasta : "18:00";
  return { modo, desde, hasta };
}

export function normalizarHorario(valor: unknown): HorarioSemanal {
  const lista = Array.isArray(valor) ? valor : [];
  return DIAS_DE_LA_SEMANA.map((_, indice) => normalizarDia(lista[indice]));
}

/** Un horario que recibe todos los días a toda hora no se guarda: es lo mismo que no tener. */
export function esSiempre(horario: HorarioSemanal) {
  return horario.every((dia) => dia.modo === "todo");
}
