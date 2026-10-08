/**
 * "RECIBIENDO CLIENTES": las reglas, sin base de datos (para poder probarlas solas).
 *
 * Idea de Alex (08-10-2026): sin horario fijo, cada asesora decide cuándo trabaja.
 *  - Abre el CRM (o vuelve a la app) → queda "Recibiendo clientes" sola.
 *  - Alex, 08-10-2026 (celular): "en línea hasta que pause". Esconder la app, bloquear el celular o
 *    cambiar de app NO la saca: sigue recibiendo (las notificaciones le llegan igual). Solo sale
 *    sola si pasan PAUSA_SOLA_SIN_ABRIR_MS (2 h) sin ningún latido, es decir, sin abrir el CRM.
 *    El latido sigue saliendo solo con la app visible (cada 4 min): no hay pedidos en segundo plano.
 *  - Puede ponerse en Pausa a mano (almuerzo). Esa pausa se respeta hasta que ella la quite o
 *    hasta el día siguiente: al abrir la app otro día vuelve a recibir sola.
 *  - Si nadie está recibiendo, el cliente nuevo va a la asesora de respaldo (Ingrid), con aviso.
 *
 * Horas "recibiendo" (Mi empresa → Actividad): se mide hasta el último latido + MARGEN_DE_MEDICION_MS,
 * no las 2 h de espera. Si vuelve a latir después de ese margen (tuvo el celular bloqueado), el
 * tramo medido se cierra en último latido + margen y empieza otro: para el reparto nunca dejó de
 * estar en línea, pero el rato con la app escondida no suma horas.
 *
 * Esto es aparte de la pausa de reparto de Mi empresa → Equipo, que pone un jefe (vacaciones) y
 * manda por encima de todo: quien está pausada ahí no recibe aunque esté en línea.
 */

/** Sin ningún latido (sin abrir el CRM) en este rato, se pausa sola. El ajuste: cambiarlo solo acá. */
export const PAUSA_SOLA_SIN_ABRIR_MS = 2 * 60 * 60_000;

/**
 * Para medir horas: después del último latido se cuenta este rato y nada más. Los latidos salen
 * cada 4 min con la app visible, así que con 6 min el uso seguido no se corta en tramos.
 */
export const MARGEN_DE_MEDICION_MS = 6 * 60_000;

export type Presencia = {
  ultimoLatido: Date;
  /** Desde cuándo va el tramo medido actual. null = no está recibiendo. */
  enLineaDesde: Date | null;
  /** Cuándo se puso en Pausa a mano. */
  pausaManualEn: Date | null;
};

export type PeriodoCerrado = { inicio: Date; fin: Date };

/** Colombia no cambia de hora: el día del negocio es la hora UTC menos cinco. */
const DESFASE_BOGOTA_MS = 5 * 60 * 60_000;

export function diaEnBogota(fecha: Date): string {
  return new Date(fecha.getTime() - DESFASE_BOGOTA_MS).toISOString().slice(0, 10);
}

/** La pausa a mano vale el mismo día en que se puso. Al otro día, abrir la app la quita. */
export function pausaManualVigente(presencia: Presencia | null, ahora: Date): boolean {
  return Boolean(presencia?.pausaManualEn && diaEnBogota(presencia.pausaManualEn) === diaEnBogota(ahora));
}

export function estaRecibiendo(presencia: Presencia | null, ahora: Date): boolean {
  if (!presencia || !presencia.enLineaDesde || pausaManualVigente(presencia, ahora)) {
    return false;
  }
  return ahora.getTime() - presencia.ultimoLatido.getTime() <= PAUSA_SOLA_SIN_ABRIR_MS;
}

/** Hasta cuándo se miden horas de un tramo: último latido + margen corto (o ahora, si es antes). */
export function finMedido(presencia: Presencia, ahora: Date): Date {
  return new Date(Math.min(presencia.ultimoLatido.getTime() + MARGEN_DE_MEDICION_MS, ahora.getTime()));
}

function periodoQueQuedoAbierto(presencia: Presencia | null, ahora: Date): PeriodoCerrado | null {
  if (!presencia?.enLineaDesde) {
    return null;
  }
  return { inicio: presencia.enLineaDesde, fin: finMedido(presencia, ahora) };
}

/**
 * Llega un latido (la app está visible). Si no está en pausa a mano, queda recibiendo. Si el latido
 * anterior fue hace menos que el margen, el tramo medido sigue; si no (volvió después de tener el
 * celular bloqueado, o después de pausarse sola), ese tramo se cierra en último latido + margen y
 * empieza otro ahora.
 */
export function alLatir(
  presencia: Presencia | null,
  ahora: Date,
): { presencia: Presencia; cerrar: PeriodoCerrado | null } {
  if (presencia && pausaManualVigente(presencia, ahora)) {
    return { presencia: { ...presencia, ultimoLatido: ahora, enLineaDesde: null }, cerrar: periodoQueQuedoAbierto(presencia, ahora) };
  }
  if (
    presencia &&
    estaRecibiendo(presencia, ahora) &&
    ahora.getTime() - presencia.ultimoLatido.getTime() <= MARGEN_DE_MEDICION_MS
  ) {
    return { presencia: { ...presencia, ultimoLatido: ahora }, cerrar: null };
  }
  return {
    presencia: { ultimoLatido: ahora, enLineaDesde: ahora, pausaManualEn: null },
    cerrar: periodoQueQuedoAbierto(presencia, ahora),
  };
}

/** Ella toca "Pausada". Se cierra el tramo medido (en este instante si latió hace poco). */
export function alPausarAMano(
  presencia: Presencia | null,
  ahora: Date,
): { presencia: Presencia; cerrar: PeriodoCerrado | null } {
  const cerrar = periodoQueQuedoAbierto(presencia, ahora);
  return {
    presencia: { ultimoLatido: presencia?.ultimoLatido ?? ahora, enLineaDesde: null, pausaManualEn: ahora },
    cerrar,
  };
}

/** Ella toca "Recibiendo clientes": es como un latido que además quita la pausa a mano. */
export function alActivarAMano(
  presencia: Presencia | null,
  ahora: Date,
): { presencia: Presencia; cerrar: PeriodoCerrado | null } {
  return alLatir(presencia ? { ...presencia, pausaManualEn: null } : null, ahora);
}

/**
 * A quién le toca el cliente nuevo.
 *
 * `rueda` es la lista completa del turno (colaboradoras activas, sin pausadas por un jefe ni las
 * que solo monitorean); `disponibles`, las de esa lista que están en horario y recibiendo. Se
 * sigue la rueda desde la última que recibió. Si no hay nadie disponible, va a la de respaldo,
 * siempre que esté en la rueda (si un jefe la pausó o la sacó de la línea, no se le fuerza).
 */
export function elegirAsesora(input: {
  rueda: string[];
  disponibles: Set<string>;
  ultimaAsignada: string | null;
  respaldo: string | null;
}): { userId: string; porRespaldo: boolean } | null {
  const { rueda, disponibles } = input;
  const desde = input.ultimaAsignada ? rueda.indexOf(input.ultimaAsignada) : -1;
  const siguiente = Array.from({ length: rueda.length }, (_, paso) => rueda[(desde + 1 + paso) % rueda.length]).find(
    (userId) => disponibles.has(userId),
  );
  if (siguiente) {
    return { userId: siguiente, porRespaldo: false };
  }
  if (input.respaldo && rueda.includes(input.respaldo)) {
    return { userId: input.respaldo, porRespaldo: true };
  }
  return null;
}

/*
  LA MADRUGADA (Alex, 08-10-2026): "bot responde y se asigna en la mañana"; respaldo de 7 a. m. a
  11 p. m.; los chats de la noche se reparten en rueda a medida que se conectan, con tope.

  - El respaldo (y su push, y el aviso a los jefes) solo funciona dentro de la FRANJA DEL RESPALDO.
  - Fuera de la franja, si nadie está en línea, el chat queda SIN dueña (el bot sigue contestando)
    y se marca "de madrugada".
  - Desde la hora de fin de la noche (7:00), los chats de madrugada van a las que estén en línea,
    al que tenga menos (en el orden de la rueda), hasta TOPE_DE_MADRUGADA_POR_ASESORA cada una,
    sin respaldo. Más antiguos primero. No mueven la rueda del día.
  - Desde REPARTO_LIBRE_DE_MADRUGADA_HORA (8:00), lo que quede se reparte por la rueda normal
    entre las que estén en línea y, si no hay nadie, al respaldo.
  Un cliente NUEVO a las 7:00 con nadie en línea va al respaldo como de día.

  Los ajustes están acá, junto con las reglas del respaldo. Horas de Bogotá.
*/
export const FRANJA_DEL_RESPALDO = { desdeHora: 7, hastaHora: 23 };
export const TOPE_DE_MADRUGADA_POR_ASESORA = 3;
export const REPARTO_LIBRE_DE_MADRUGADA_HORA = 8;

const HORA_MS = 60 * 60_000;

/** Minuto del día en Bogotá (0 a 1439). */
export function minutoDelDiaEnBogota(fecha: Date): number {
  const enBogota = new Date(fecha.getTime() - DESFASE_BOGOTA_MS);
  return enBogota.getUTCHours() * 60 + enBogota.getUTCMinutes();
}

/** ¿El respaldo atiende a esta hora? */
export function respaldoAtiende(ahora: Date): boolean {
  const minuto = minutoDelDiaEnBogota(ahora);
  return minuto >= FRANJA_DEL_RESPALDO.desdeHora * 60 && minuto < FRANJA_DEL_RESPALDO.hastaHora * 60;
}

/** ¿Los chats de madrugada todavía se reparten con tope (entre las 7:00 y las 8:00)? */
export function madrugadaConTope(ahora: Date): boolean {
  return respaldoAtiende(ahora) && minutoDelDiaEnBogota(ahora) < REPARTO_LIBRE_DE_MADRUGADA_HORA * 60;
}

/**
 * La noche en curso o, de día, la última que terminó: de las 23:00 a las 7:00 de Bogotá.
 */
export function ventanaDeMadrugada(ahora: Date): { desde: Date; hasta: Date } {
  const medianoche = Date.parse(`${diaEnBogota(ahora)}T00:00:00.000Z`) + DESFASE_BOGOTA_MS;
  const duracion = (24 - FRANJA_DEL_RESPALDO.hastaHora + FRANJA_DEL_RESPALDO.desdeHora) * HORA_MS;
  const inicio =
    minutoDelDiaEnBogota(ahora) >= FRANJA_DEL_RESPALDO.hastaHora * 60
      ? medianoche + FRANJA_DEL_RESPALDO.hastaHora * HORA_MS
      : medianoche + (FRANJA_DEL_RESPALDO.hastaHora - 24) * HORA_MS;
  return { desde: new Date(inicio), hasta: new Date(inicio + duracion) };
}

export type DecisionDeReparto =
  | { tipo: "asignar"; userId: string; porRespaldo: boolean; deMadrugada: boolean; mueveLaRueda: boolean }
  /** Nadie ahora: queda sin dueña y se reparte después (madrugada). */
  | { tipo: "esperar" }
  | { tipo: "nadie" };

/**
 * A quién va un chat, con la hora: la franja del respaldo y los chats de madrugada.
 * `recibidasDeMadrugada`: cuántos chats de madrugada recibió hoy cada una (para el tope).
 *
 * `disponibles` es "quién está EN LÍNEA" (con el CRM abierto o latido reciente); lo usa la regla de
 * madrugada: de noche, para no asignarle a nadie dormida, y en el tope de 7 a 8.
 *
 * `disponiblesParaTurno` (opcional) es quién puede recibir por la RUEDA DE DÍA: todas las elegibles
 * menos las pausadas a mano, estén o no con la app abierta (Alex, 08-10-2026: el reparto ya no
 * exige "en línea"). Si no se pasa, se usa `disponibles` (comportamiento de antes, para las pruebas
 * de las reglas). La madrugada no la mira: esos caminos siguen con `disponibles`.
 */
export function decidirReparto(input: {
  rueda: string[];
  disponibles: Set<string>;
  disponiblesParaTurno?: Set<string>;
  ultimaAsignada: string | null;
  respaldo: string | null;
  ahora: Date;
  deMadrugada: boolean;
  recibidasDeMadrugada?: Map<string, number>;
}): DecisionDeReparto {
  const { rueda, disponibles, ahora } = input;
  const paraTurno = input.disponiblesParaTurno ?? disponibles;

  if (!respaldoAtiende(ahora)) {
    // De noche: si alguien está en línea recibe por la rueda; si no, sin dueña hasta la mañana.
    const elegida = elegirAsesora({ ...input, respaldo: null });
    return elegida
      ? { tipo: "asignar", ...elegida, deMadrugada: false, mueveLaRueda: true }
      : { tipo: "esperar" };
  }

  if (input.deMadrugada && madrugadaConTope(ahora)) {
    const recibidas = input.recibidasDeMadrugada ?? new Map<string, number>();
    const elegibles = rueda.filter(
      (userId) => disponibles.has(userId) && (recibidas.get(userId) ?? 0) < TOPE_DE_MADRUGADA_POR_ASESORA,
    );
    if (elegibles.length === 0) {
      return { tipo: "esperar" };
    }
    // En rueda: la que menos lleva; si empatan, en el orden de la rueda.
    const userId = elegibles.reduce((mejor, candidata) =>
      (recibidas.get(candidata) ?? 0) < (recibidas.get(mejor) ?? 0) ? candidata : mejor,
    );
    return { tipo: "asignar", userId, porRespaldo: false, deMadrugada: true, mueveLaRueda: false };
  }

  // Reparto de día: por la rueda entre TODAS las elegibles (tengan o no la app abierta).
  const elegida = elegirAsesora({ ...input, disponibles: paraTurno });
  if (!elegida) {
    return { tipo: "nadie" };
  }
  return {
    tipo: "asignar",
    ...elegida,
    deMadrugada: input.deMadrugada,
    mueveLaRueda: !elegida.porRespaldo,
  };
}

/** Minutos de una lista de periodos que caen dentro de [desde, hasta). */
export function minutosEnRango(periodos: PeriodoCerrado[], desde: Date, hasta: Date): number {
  let ms = 0;
  for (const periodo of periodos) {
    const inicio = Math.max(periodo.inicio.getTime(), desde.getTime());
    const fin = Math.min(periodo.fin.getTime(), hasta.getTime());
    if (fin > inicio) {
      ms += fin - inicio;
    }
  }
  return Math.round(ms / 60_000);
}

/** "3 h 20 min", "45 min", "—". */
export function formatoDeHoras(minutos: number): string {
  if (minutos <= 0) return "—";
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  if (horas === 0) return `${resto} min`;
  return resto === 0 ? `${horas} h` : `${horas} h ${resto} min`;
}
