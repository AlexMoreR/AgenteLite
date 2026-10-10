/**
 * Tipos comunes del Supervisor (código puro).
 *
 * Principio: el Coach enseña, el Supervisor VIGILA y el Director decide. El Supervisor en esta fase
 * solo lee, analiza, alerta y recomienda: nunca cambia el libro, el reparto, las etapas ni le
 * escribe a nadie. Por eso cada hallazgo trae su recomendación y, si toca producción, la frase
 * "Recomendación lista. Esperando autorización de Alexander."
 */

export type Severidad = "CRITICO" | "IMPORTANTE" | "OBSERVACION";
export type Familia = "BOT" | "EMBUDO" | "ATENCION" | "CAMBIO";

export const ORDEN_DE_SEVERIDAD: Record<Severidad, number> = { OBSERVACION: 1, IMPORTANTE: 2, CRITICO: 3 };

export const ETIQUETA_DE_SEVERIDAD: Record<Severidad, string> = {
  CRITICO: "CRÍTICO",
  IMPORTANTE: "IMPORTANTE",
  OBSERVACION: "OBSERVACIÓN",
};

export const ESPERANDO_AUTORIZACION = "Recomendación lista. Esperando autorización de Alexander.";

export function severidadMayor(a: Severidad, b: Severidad): Severidad {
  return ORDEN_DE_SEVERIDAD[a] >= ORDEN_DE_SEVERIDAD[b] ? a : b;
}

/** Un problema detectado en una vuelta. Varios hallazgos relacionados forman un incidente. */
export type Hallazgo = {
  /** Clave estable para deduplicar: el mismo problema en la vuelta siguiente trae la misma clave. */
  clave: string;
  familia: Familia;
  severidad: Severidad;
  titulo: string;
  /** Qué ocurrió, en una o dos frases. */
  que: string;
  /** Desde cuándo (el primer lead afectado o el cambio que lo originó). */
  desde: Date;
  producto: string | null;
  asesoraId?: string | null;
  leadsAfectados: number;
  evidencia: { chats: string[]; reglas: string[]; versiones: number[] };
  metrica: string;
  esperado: string;
  observado: string;
  /** Lo comprobado con datos. */
  hechos: string[];
  /** Lo que se cree pero no está comprobado. */
  hipotesis: string[];
  causaPosible: string;
  impacto: string;
  recomendacion: string;
  queCambiar: string;
  riesgo: string;
  comoMedir: string;
  /** La solución toca producción (libro, reparto, flujos...): necesita autorización de Alexander. */
  tocaProduccion: boolean;
  /** Números para mostrar o para comparar en la vuelta siguiente. */
  valores?: Record<string, number | string | null>;
};

/** Un cambio de versión del libro V3 con su resumen. */
export type CambioDelLibro = {
  version: number;
  anterior: number | null;
  en: Date;
  autor: string | null;
  resumen: string | null;
};
