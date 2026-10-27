import { SENALES_FUERTES } from "../../seguimiento-inteligente/dominio/recuperacion";

/**
 * DESCARTE TRAS LOS SEGUIMIENTOS (código puro, sin base): la regla de cuándo un lead que nunca
 * contestó pasa solo a Descartado.
 *
 * La secuencia del paso es 15 min → 1 h → 1 día → 3 días → 7 días (redes). El descarte va DESPUÉS
 * del de 7 días, no del de 3: el cliente recibe los 5 seguimientos y recién entonces se cierra.
 */

/** Cuánto esperar después de que salió el de 7 días, para que el cliente tenga tiempo de contestar. */
export const MARGEN_HORAS_POR_DEFECTO = 24;

/** Los días del seguimiento que marca el final de la secuencia. */
export const DIAS_DEL_ULTIMO_SEGUIMIENTO = 7;

/** Motivo oficial del CRM (el mismo de "Sin respuesta"); lo que lo distingue es la nota. */
export const MOTIVO_DESCARTE = "sin_respuesta";
export const TEXTO_DEL_MOTIVO = "Sin respuesta a seguimientos";

/** Descartables: Nuevo, Frío y Tibio. Caliente (NEGOCIACION), Ganado y Perdido quedan afuera. */
export const ETAPAS_DESCARTABLES = ["NUEVO", "CALIFICADO", "PROPUESTA"] as const;

/**
 * Señal de compra: preguntó el precio, preguntó por el envío o dio su ciudad (`precio` y
 * `envio_ciudad` del embudo), más las señales fuertes. Esos leads no se descartan: van a la lista
 * LLAMAR de su asesora, que arma la Recuperación 72 h.
 */
export const SENALES_DE_COMPRA: string[] = [...SENALES_FUERTES, "precio", "envio_ciudad"];

export type FilaDeDescarte = {
  etapa: string;
  /** Cuándo salió el seguimiento de 7 días. */
  sieteEn: Date | null;
  /** Cuándo salió el primer seguimiento de la secuencia. */
  primeroEn: Date | null;
  /** Último mensaje del cliente. */
  ultimoClienteEn: Date | null;
  /** Tipos de señal guardados en el lead. */
  senales: string[];
};

export type DecisionDeDescarte =
  | { tipo: "descartar" }
  | { tipo: "llamar"; motivo: string }
  | { tipo: "no"; motivo: "etapa" | "sin_siete_dias" | "margen" | "respondio" };

export function tieneSenalDeCompra(senales: string[]): boolean {
  return senales.some((tipo) => SENALES_DE_COMPRA.includes(tipo));
}

export function decidirDescarte(fila: FilaDeDescarte, ahora: Date, margenHoras = MARGEN_HORAS_POR_DEFECTO): DecisionDeDescarte {
  if (!(ETAPAS_DESCARTABLES as readonly string[]).includes(fila.etapa)) return { tipo: "no", motivo: "etapa" };
  if (!fila.sieteEn) return { tipo: "no", motivo: "sin_siete_dias" };
  if (ahora.getTime() - fila.sieteEn.getTime() < margenHoras * 3_600_000) return { tipo: "no", motivo: "margen" };
  // Escribió algo después del primer seguimiento: contestó, no se descarta.
  const desde = fila.primeroEn ?? fila.sieteEn;
  if (fila.ultimoClienteEn && fila.ultimoClienteEn.getTime() > desde.getTime()) return { tipo: "no", motivo: "respondio" };
  const senal = fila.senales.find((tipo) => SENALES_DE_COMPRA.includes(tipo));
  if (senal) return { tipo: "llamar", motivo: `señal de compra: ${senal.replace(/_/g, " ")}` };
  return { tipo: "descartar" };
}
