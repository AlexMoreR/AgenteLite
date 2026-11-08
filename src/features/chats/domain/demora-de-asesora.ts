import { FRANJA_DEL_RESPALDO, minutoDelDiaEnBogota } from "@/lib/en-linea-reglas";

/**
 * DEMORA DE LA ASESORA: las reglas, sin base de datos (para poder probarlas solas).
 *
 * "Si la asesora no contesta en 10 minutos, el chat pasa a una asesora activa" (partes 1 y 2).
 * Un chat de ventas ASIGNADO que lleva `minutosAviso` (5) sin respuesta de una persona: la asesora
 * recibe un push. A los `minutosReasignar` (10) la regla dice "reasignar": el chat pasa a una
 * asesora ACTIVA (ver `elegirAsesoraActiva`), una sola vez por espera. Si no hay ninguna, o ya se
 * usó esa única vez, el chat no se mueve y se avisa al dueño. Al cliente no se le escribe nada.
 *
 * EL RELOJ arranca en lo MÁS RECIENTE entre:
 *  - `desde` de la espera (el primer mensaje de la clienta sin respuesta de una persona),
 *  - la última asignación del chat a ESA asesora (si se lo acaban de pasar, no tiene la culpa),
 *  - el arranque de la regla (cuándo se prendió),
 *  - el inicio de la franja de hoy (7:00): de noche la regla no corre y en la mañana el reloj
 *    arranca de nuevo, para que no salga todo de golpe.
 *
 * Una espera que ya existía antes de prender la regla no genera aviso: si solo se contara desde que
 * se prendió, 5 minutos después saldrían todas juntas.
 *
 * Solo corre dentro de FRANJA_DEL_RESPALDO (7:00 a 23:00 de Bogotá). Viene APAGADA: sin la fila de
 * configuración, o con un JSON roto, no hace nada.
 */

/** La configuración de un negocio vive en AppSetting con esta clave + workspaceId. */
export const PREFIJO_CONFIG_DEMORA = "chats:demora-asesora:config:";

export type ConfigDemora = {
  activo: boolean;
  /** Sin respuesta humana en este rato: push a la asesora. */
  minutosAviso: number;
  /** Sin respuesta humana en este rato: el chat pasa a una asesora activa. */
  minutosReasignar: number;
  /** "Activa" = mandó desde el CRM un mensaje escrito por ella en este rato. */
  minutosActiva: number;
};

export const CONFIG_DEMORA_POR_DEFECTO: ConfigDemora = {
  activo: false,
  minutosAviso: 5,
  minutosReasignar: 10,
  minutosActiva: 10,
};

function minutosValidos(valor: unknown, porDefecto: number): number {
  const numero = typeof valor === "string" ? Number(valor) : valor;
  return typeof numero === "number" && Number.isFinite(numero) && numero > 0 ? numero : porDefecto;
}

/** Igual que leerConfigTurnoDeTexto: sin fila o con JSON roto = apagado. */
export function leerConfigDemoraDeTexto(texto: string | null | undefined): ConfigDemora {
  let crudo: Record<string, unknown> = {};
  try {
    const v = texto ? JSON.parse(texto) : null;
    crudo = v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    crudo = {};
  }
  const minutosAviso = minutosValidos(crudo.minutosAviso, CONFIG_DEMORA_POR_DEFECTO.minutosAviso);
  return {
    activo: crudo.activo === true || crudo.activo === "true",
    minutosAviso,
    // Reasignar nunca antes que avisar.
    minutosReasignar: Math.max(
      minutosAviso,
      minutosValidos(crudo.minutosReasignar, CONFIG_DEMORA_POR_DEFECTO.minutosReasignar),
    ),
    minutosActiva: minutosValidos(crudo.minutosActiva, CONFIG_DEMORA_POR_DEFECTO.minutosActiva),
  };
}

/** ¿La regla corre a esta hora? De 7:00 a 23:00 de Bogotá (la franja del respaldo). */
export function dentroDeLaFranja(ahora: Date): boolean {
  const minuto = minutoDelDiaEnBogota(ahora);
  return minuto >= FRANJA_DEL_RESPALDO.desdeHora * 60 && minuto < FRANJA_DEL_RESPALDO.hastaHora * 60;
}

/** Las 7:00 de hoy (Bogotá), en ms. Colombia no cambia de hora: se resta en minutos enteros. */
export function inicioDeLaFranjaDeHoy(ahora: Date): number {
  const minutoExacto = Math.floor(ahora.getTime() / 60_000) * 60_000;
  return minutoExacto - (minutoDelDiaEnBogota(ahora) - FRANJA_DEL_RESPALDO.desdeHora * 60) * 60_000;
}

export type EntradaDelReloj = {
  /** Primer mensaje de la clienta sin respuesta de una persona (ms). */
  desde: number;
  /** Última asignación del chat a la asesora actual (ms), si hay nota. */
  ultimaAsignacion: number | null;
  /** Cuándo se prendió la regla en el negocio (ms). */
  arranque: number;
  ahora: Date;
};

/** Desde cuándo corre el reloj de la asesora: el mayor de los cuatro. */
export function inicioDelReloj(entrada: EntradaDelReloj): number {
  return Math.max(
    entrada.desde,
    entrada.ultimaAsignacion ?? Number.NEGATIVE_INFINITY,
    entrada.arranque,
    inicioDeLaFranjaDeHoy(entrada.ahora),
  );
}

export type DecisionDeDemora =
  | { tipo: "nada" }
  | { tipo: "avisar"; inicio: number }
  | { tipo: "reasignar"; inicio: number };

export function decidirDemora(entrada: EntradaDelReloj & { config: ConfigDemora }): DecisionDeDemora {
  const { config, ahora } = entrada;
  if (!config.activo || !dentroDeLaFranja(ahora)) {
    return { tipo: "nada" };
  }
  // La espera ya existía cuando se prendió la regla: no se avisa.
  if (entrada.desde < entrada.arranque) {
    return { tipo: "nada" };
  }
  const inicio = inicioDelReloj(entrada);
  const transcurrido = ahora.getTime() - inicio;
  if (transcurrido >= config.minutosReasignar * 60_000) {
    return { tipo: "reasignar", inicio };
  }
  if (transcurrido >= config.minutosAviso * 60_000) {
    return { tipo: "avisar", inicio };
  }
  return { tipo: "nada" };
}

/** El `origen` de la nota que deja la reasignación automática (y con el que se cuenta el tope). */
export const ORIGEN_REASIGNACION_POR_DEMORA = "reasignacion-por-demora";

/**
 * Tope de reasignaciones automáticas por espera: UNA. Si la nueva tampoco contesta, el chat no
 * salta de asesora en asesora: se avisa al dueño y se queda donde está.
 */
export const TOPE_DE_REASIGNACIONES_POR_ESPERA = 1;

/**
 * ¿Ya se usó la reasignación automática de ESTA espera? `reasignaciones` son las horas (ms) de las
 * notas con origen ORIGEN_REASIGNACION_POR_DEMORA del chat; solo cuentan las de desde `desde` (el
 * primer mensaje de la clienta sin respuesta): una espera nueva arranca con el tope en cero.
 */
export function alcanzoElTopeDeReasignaciones(reasignaciones: number[], desde: number): boolean {
  return reasignaciones.filter((en) => en >= desde).length >= TOPE_DE_REASIGNACIONES_POR_ESPERA;
}

export type EntradaDeLaEleccion = {
  /** Las que pueden recibir el chat en esta línea, en el orden de la rueda del reparto. */
  candidatas: string[];
  /** Última vez (ms) que cada asesora ACTIVA mandó un mensaje escrito por ella. Sin fila = no activa. */
  ultimoMensajePorAsesora: Map<string, number>;
  /** Cuántos chats tiene esperando cada asesora (como principal). */
  esperandoPorAsesora: Map<string, number>;
  /** La dueña actual del chat. */
  original: string;
  /** La segunda asesora del chat, si tiene. */
  segunda: string | null;
};

/**
 * A quién se le pasa el chat: entre las candidatas ACTIVAS, nunca la original ni la segunda.
 * Gana la de menos chats esperando; si empatan, la que escribió más reciente; si siguen empatadas,
 * la que va primero en la rueda. null = no hay ninguna (el chat se queda y se avisa al dueño).
 */
export function elegirAsesoraActiva(entrada: EntradaDeLaEleccion): string | null {
  const posibles = entrada.candidatas
    .map((userId, orden) => ({ userId, orden, ultimo: entrada.ultimoMensajePorAsesora.get(userId) }))
    .filter(
      (c): c is { userId: string; orden: number; ultimo: number } =>
        c.ultimo !== undefined && c.userId !== entrada.original && c.userId !== entrada.segunda,
    );
  if (!posibles.length) return null;
  posibles.sort(
    (a, b) =>
      (entrada.esperandoPorAsesora.get(a.userId) ?? 0) - (entrada.esperandoPorAsesora.get(b.userId) ?? 0) ||
      b.ultimo - a.ultimo ||
      a.orden - b.orden,
  );
  return posibles[0].userId;
}
