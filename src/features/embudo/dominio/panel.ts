/**
 * LAS CUENTAS DEL PANEL DEL EMBUDO (v1), en código puro.
 *
 * Cohorte: cada lead cuenta en el día en que entró y en una etapa si llegó a ella alguna vez.
 * Los que todavía no cumplen su ventana (72 h para la conversación, 30 días para cotización y
 * anticipo) están "madurando": se muestran, pero no entran en los porcentajes, para que la semana
 * en curso no parezca peor de lo que es.
 */

export const ETAPAS_DEL_PANEL = [
  { clave: "entrada", nombre: "Entrada", ventana: "72h" },
  { clave: "bienvenida", nombre: "Bienvenida", ventana: "72h" },
  { clave: "respondio", nombre: "Respondió", ventana: "72h" },
  { clave: "identificacion", nombre: "Identificación", ventana: "72h" },
  { clave: "recomendacion", nombre: "Recomendación", ventana: "72h" },
  { clave: "acepto", nombre: "Aceptó info / preguntó", ventana: "72h" },
  { clave: "intencion", nombre: "Intención (≥ tibio)", ventana: "72h" },
  { clave: "asesora", nombre: "A asesora", ventana: "72h" },
  { clave: "cotizacion", nombre: "Cotización", ventana: "30d" },
  { clave: "anticipo", nombre: "Anticipo", ventana: "30d" },
] as const;

export type ClaveDeEtapa = (typeof ETAPAS_DEL_PANEL)[number]["clave"];

/** Lo que devuelve la consulta: por etapa, cuántos llegaron (todos) y cuántos de los maduros. */
export type ConteosDelEmbudo = {
  total: number;
  maduros72: number;
  maduros30: number;
  etapas: Record<ClaveDeEtapa, { todos: number; maduros: number; maduros30: number }>;
};

export type FilaDelEmbudo = {
  clave: ClaveDeEtapa;
  nombre: string;
  /** Cuántos llegaron, contando también los que maduran. */
  numero: number;
  /** De los que llegaron, cuántos todavía están madurando (no entran en los %). */
  madurando: number;
  /** % sobre la etapa anterior, solo con cohortes maduras. null = sin base. */
  sobreAnterior: number | null;
  /** % sobre la entrada, solo con cohortes maduras. */
  sobreEntrada: number | null;
  /** Pérdida en puntos respecto de la etapa anterior (100 - sobreAnterior). */
  perdida: number | null;
  esMayorAbandono: boolean;
};

function porcentaje(parte: number, base: number): number | null {
  if (!base) return null;
  return Math.round((parte / base) * 1000) / 10;
}

export function filasDelEmbudo(conteos: ConteosDelEmbudo): FilaDelEmbudo[] {
  const filas: FilaDelEmbudo[] = [];
  /*
    Para comparar dos etapas se usa la MISMA base de maduración: la de la etapa de abajo. Así
    "Cotización / A asesora" compara los maduros a 30 días en las dos.
  */
  const madurosDe = (clave: ClaveDeEtapa, ventana: "72h" | "30d") =>
    ventana === "30d" ? conteos.etapas[clave].maduros30 : conteos.etapas[clave].maduros;

  ETAPAS_DEL_PANEL.forEach((etapa, indice) => {
    const actual = conteos.etapas[etapa.clave];
    const maduros = madurosDe(etapa.clave, etapa.ventana);
    const anterior = indice > 0 ? ETAPAS_DEL_PANEL[indice - 1] : null;
    const baseAnterior = anterior ? madurosDe(anterior.clave, etapa.ventana) : null;
    const baseEntrada = etapa.ventana === "30d" ? conteos.maduros30 : conteos.maduros72;
    const sobreAnterior = anterior ? porcentaje(maduros, baseAnterior ?? 0) : null;
    filas.push({
      clave: etapa.clave,
      nombre: etapa.nombre,
      numero: actual.todos,
      madurando: Math.max(0, actual.todos - maduros),
      sobreAnterior,
      sobreEntrada: indice === 0 ? null : porcentaje(maduros, baseEntrada),
      perdida: sobreAnterior === null ? null : Math.round((100 - sobreAnterior) * 10) / 10,
      esMayorAbandono: false,
    });
  });

  let peor: FilaDelEmbudo | null = null;
  for (const fila of filas) {
    if (fila.perdida === null) continue;
    if (!peor || (peor.perdida ?? 0) < fila.perdida) peor = fila;
  }
  if (peor && (peor.perdida ?? 0) > 0) peor.esMayorAbandono = true;
  return filas;
}

/** Diferencia en puntos entre dos porcentajes (actual - comparado). */
export function diferenciaEnPuntos(actual: number | null, comparado: number | null): number | null {
  if (actual === null || comparado === null) return null;
  return Math.round((actual - comparado) * 10) / 10;
}

/** Con menos de 50 leads maduros, la comparación no es concluyente. */
export const MINIMO_PARA_COMPARAR = 50;

/* ---------------------------------------------------------------- fechas (Bogotá, UTC-5 fijo) */

export function esDiaValido(dia: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(dia) && Number.isFinite(new Date(`${dia}T12:00:00Z`).getTime());
}

export function diaEnBogota(fecha: Date): string {
  return new Date(fecha.getTime() - 5 * 3_600_000).toISOString().slice(0, 10);
}

export function moverDia(dia: string, dias: number): string {
  const fecha = new Date(`${dia}T12:00:00.000Z`);
  fecha.setUTCDate(fecha.getUTCDate() + dias);
  return fecha.toISOString().slice(0, 10);
}

/** [desde, hasta] en días de Bogotá (ambos incluidos) -> instantes UTC [inicio, fin). */
export function rangoBogota(desde: string, hasta: string): { inicio: Date; fin: Date } {
  return {
    inicio: new Date(`${desde}T00:00:00.000-05:00`),
    fin: new Date(`${moverDia(hasta, 1)}T00:00:00.000-05:00`),
  };
}

export function diasEntre(desde: string, hasta: string): number {
  return Math.round((new Date(`${hasta}T12:00:00Z`).getTime() - new Date(`${desde}T12:00:00Z`).getTime()) / 86_400_000) + 1;
}
