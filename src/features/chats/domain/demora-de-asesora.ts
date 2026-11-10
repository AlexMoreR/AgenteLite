import { FRANJA_DEL_RESPALDO, diaEnBogota, minutoDelDiaEnBogota } from "@/lib/en-linea-reglas";

/**
 * DEMORA DE LA ASESORA: las reglas, sin base de datos (para poder probarlas solas).
 *
 * Partes 1, 2 y 3 de 3 de "si la asesora no contesta en 10 minutos, el chat pasa a una asesora activa".
 * Un chat de ventas ASIGNADO que lleva `minutosAviso` (5) sin respuesta de una persona: la asesora
 * recibe un push. A los `minutosReasignar` (10) la regla dice "reasignar": el chat pasa a una
 * asesora ACTIVA (elegirAsesoraActiva). Una sola vez por espera (topeDeReasignacionAlcanzado); sin
 * activa, o con el tope ya usado, el chat se queda donde está y se avisa al dueño.
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

/** `origen` de la nota "Reasignado de X a Y…" que deja esta regla (también sirve para el tope). */
export const ORIGEN_REASIGNACION_POR_DEMORA = "reasignacion-por-demora";

/** Reasignaciones automáticas por espera: una, para que el chat no salte de asesora en asesora. */
export const MAXIMO_REASIGNACIONES_POR_ESPERA = 1;

/**
 * ¿Ya se usó la reasignación de ESTA espera? `reasignaciones` son las fechas (ms) de las notas con
 * origen ORIGEN_REASIGNACION_POR_DEMORA del chat; cuentan solo las de esta espera (desde `desde`).
 */
export function topeDeReasignacionAlcanzado(reasignaciones: readonly number[], desde: number): boolean {
  return reasignaciones.filter((en) => en >= desde).length >= MAXIMO_REASIGNACIONES_POR_ESPERA;
}

export type EntradaDeEleccion = {
  /** Las que pueden recibir en esta línea ahora (reparto, miembro activo, horario, sin pausa), en el orden de la rueda. */
  candidatas: readonly string[];
  /** Último mensaje escrito desde el CRM por cada asesora dentro de `minutosActiva` (ms). Sin entrada = no está activa. */
  ultimoMensajePorAsesora: ReadonlyMap<string, number>;
  /** Cuántos chats esperando tiene cada asesora (como principal). */
  esperandoPorAsesora: ReadonlyMap<string, number>;
  /** La dueña actual del chat. */
  original: string;
  /** La segunda asesora del chat, si hay. */
  segunda: string | null;
};

/**
 * A quién pasarle el chat: una candidata ACTIVA que no sea la original ni la segunda. Gana la de
 * menos chats esperando; si empatan, la que escribió más reciente; si siguen empatadas, el orden
 * de la rueda. null = no hay ninguna.
 */
export function elegirAsesoraActiva(entrada: EntradaDeEleccion): string | null {
  const opciones = entrada.candidatas
    .map((userId, orden) => ({ userId, orden, ultimo: entrada.ultimoMensajePorAsesora.get(userId) }))
    .filter(
      (opcion): opcion is { userId: string; orden: number; ultimo: number } =>
        opcion.ultimo !== undefined && opcion.userId !== entrada.original && opcion.userId !== entrada.segunda,
    );
  if (!opciones.length) return null;
  opciones.sort(
    (a, b) =>
      (entrada.esperandoPorAsesora.get(a.userId) ?? 0) - (entrada.esperandoPorAsesora.get(b.userId) ?? 0) ||
      b.ultimo - a.ultimo ||
      a.orden - b.orden,
  );
  return opciones[0].userId;
}

/*
 * PARTE 3: LA MEDICIÓN (solo lee y guarda una foto al día; no cambia ninguna asignación).
 *
 * Medida 1, la FOTO DEL CIERRE: cuántos chats tienen al cliente esperando 10 min o más sin respuesta
 * de una persona al cierre del día (las 23:00 de Bogotá, fin de FRANJA_DEL_RESPALDO). Es un dato del
 * momento que no se puede reconstruir después, por eso se guarda una vez por negocio y día. Cuenta con
 * el `desde` de la espera, sin el reloj de la regla, y se guarda aunque la regla esté apagada (para
 * tener con qué comparar antes de prenderla).
 *
 * Medida 2, las REASIGNACIONES: las notas con origen ORIGEN_REASIGNACION_POR_DEMORA, agrupadas por
 * quién se demoró (reasignadoDeUserId) y por quién recibió el chat (assigneeUserId).
 */

/** Espera mínima para contar en la foto del cierre. */
export const MINUTOS_DE_ESPERA_DEL_CIERRE = 10;

export const PREFIJO_FOTO_DE_CIERRE = "chats:demora-asesora:cierre:";

/** `chats:demora-asesora:cierre:<workspaceId>:<AAAA-MM-DD>`. Con una fecha, el día es el de Bogotá. */
export function claveFotoDeCierre(workspaceId: string, dia: string | Date): string {
  return `${PREFIJO_FOTO_DE_CIERRE}${workspaceId}:${typeof dia === "string" ? dia : diaEnBogota(dia)}`;
}

/** ¿Ya es la hora de la foto? Desde las 23:00 de Bogotá (cierre de la franja) hasta las 23:59. */
export function esHoraDeLaFotoDeCierre(ahora: Date): boolean {
  return minutoDelDiaEnBogota(ahora) >= FRANJA_DEL_RESPALDO.hastaHora * 60;
}

export type FotoDeCierre = {
  total: number;
  /** userId de la asesora principal → chats esperando. */
  porAsesora: Record<string, number>;
  /** Chats esperando sin asesora asignada. */
  sinAsignar: number;
};

/** Cuenta los chats con `ahora - desde >= 10 min` y los agrupa por asesora (o sin asignar). */
export function contarEsperaDeCierre(
  chats: ReadonlyArray<{ desde: number; assignedToUserId: string | null }>,
  ahora: Date,
): FotoDeCierre {
  const foto: FotoDeCierre = { total: 0, porAsesora: {}, sinAsignar: 0 };
  const limite = ahora.getTime() - MINUTOS_DE_ESPERA_DEL_CIERRE * 60_000;
  for (const chat of chats) {
    if (!(chat.desde <= limite)) continue;
    foto.total += 1;
    if (chat.assignedToUserId) {
      foto.porAsesora[chat.assignedToUserId] = (foto.porAsesora[chat.assignedToUserId] ?? 0) + 1;
    } else {
      foto.sinAsignar += 1;
    }
  }
  return foto;
}

function enteroNoNegativo(valor: unknown): number | null {
  return typeof valor === "number" && Number.isInteger(valor) && valor >= 0 ? valor : null;
}

/** Lee la foto guardada. JSON roto o con otra forma = null. */
export function leerFotoDeCierreDeTexto(
  texto: string | null | undefined,
): (FotoDeCierre & { guardadoEn: string | null }) | null {
  let crudo: unknown;
  try {
    crudo = texto ? JSON.parse(texto) : null;
  } catch {
    return null;
  }
  if (!crudo || typeof crudo !== "object" || Array.isArray(crudo)) return null;
  const v = crudo as Record<string, unknown>;
  const total = enteroNoNegativo(v.total);
  const sinAsignar = enteroNoNegativo(v.sinAsignar);
  if (total === null || sinAsignar === null) return null;
  if (!v.porAsesora || typeof v.porAsesora !== "object" || Array.isArray(v.porAsesora)) return null;
  const porAsesora: Record<string, number> = {};
  for (const [userId, cuenta] of Object.entries(v.porAsesora as Record<string, unknown>)) {
    const n = enteroNoNegativo(cuenta);
    if (n === null) return null;
    porAsesora[userId] = n;
  }
  return { total, porAsesora, sinAsignar, guardadoEn: typeof v.guardadoEn === "string" ? v.guardadoEn : null };
}

export type ReasignacionesAgrupadas = {
  total: number;
  /** userId de la que se demoró (le quitaron el chat) → veces. */
  porQuienSeDemoro: Record<string, number>;
  /** userId de la que recibió el chat → veces. */
  porQuienRecibio: Record<string, number>;
};

/** Agrupa los rawPayload de las notas. Una nota sin uno de los ids no suma en ese lado, pero sí en el total. */
export function agruparReasignaciones(
  notas: ReadonlyArray<{ reasignadoDeUserId?: unknown; assigneeUserId?: unknown } | null | undefined>,
): ReasignacionesAgrupadas {
  const grupos: ReasignacionesAgrupadas = { total: 0, porQuienSeDemoro: {}, porQuienRecibio: {} };
  const sumar = (cuenta: Record<string, number>, id: unknown) => {
    if (typeof id === "string" && id) cuenta[id] = (cuenta[id] ?? 0) + 1;
  };
  for (const nota of notas) {
    grupos.total += 1;
    sumar(grupos.porQuienSeDemoro, nota?.reasignadoDeUserId);
    sumar(grupos.porQuienRecibio, nota?.assigneeUserId);
  }
  return grupos;
}
