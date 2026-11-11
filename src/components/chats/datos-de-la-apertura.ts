"use client";

/*
  Lo que trae /live al ABRIR un chat y antes se pedia con acciones de servidor (velocidad del chat,
  10-nov-2026): la ficha del contacto y el interruptor de seguimientos automaticos.

  Medido en produccion: al abrir un chat salian 3 acciones en fila (0,6-3,9 s cada una) detras de
  /live. Ahora /live trae la ficha y el interruptor; la bandeja los deja aca y la ficha y el
  interruptor los toman en vez de preguntar. Mientras la apertura esta en camino esperan (como
  mucho ESPERA_MAXIMA_MS); si /live no los trajo (API oficial, un error), preguntan como antes.
*/

export const ESPERA_MAXIMA_MS = 2500;
const VIDA_MS = 30_000;

const fichas = new Map<string, { valor: unknown; en: number }>();
const seguimientos = new Map<string, { apagados: boolean; en: number }>();
let aperturasEnCamino = 0;
const esperando = new Set<() => void>();

function despertar() {
  for (const listo of [...esperando]) listo();
}

/** La bandeja empieza a pedir /live para abrir un chat. */
export function empezoLaApertura() {
  aperturasEnCamino += 1;
}

/** Llego (o fallo) /live: deja lo que trajo y despierta a quien esperaba. Siempre se llama una vez. */
export function terminoLaApertura(datos?: {
  contactId?: string | null;
  ficha?: unknown;
  conversationId?: string | null;
  seguimientosApagados?: unknown;
}) {
  const ahora = Date.now();
  if (datos?.contactId && datos.ficha && typeof datos.ficha === "object") {
    fichas.set(datos.contactId, { valor: datos.ficha, en: ahora });
  }
  if (datos?.conversationId && typeof datos.seguimientosApagados === "boolean") {
    seguimientos.set(datos.conversationId, { apagados: datos.seguimientosApagados, en: ahora });
  }
  aperturasEnCamino = Math.max(0, aperturasEnCamino - 1);
  despertar();
}

/**
 * Espera a que no quede ninguna apertura en camino, como mucho `maxMs`.
 *
 * Primero deja pasar un instante (setTimeout 0): el interruptor esta mas adentro que la bandeja, asi que
 * su efecto corre ANTES que el de la bandeja que avisa la apertura (React corre los efectos de los hijos
 * primero). Sin esa pausa veia "nada en camino" y salia la accion igual (medido en produccion).
 */
export async function esperarLaApertura(maxMs: number = ESPERA_MAXIMA_MS): Promise<void> {
  await new Promise<void>((listo) => setTimeout(listo, 0));
  if (aperturasEnCamino === 0) return;
  return new Promise((resolver) => {
    let temporizador: ReturnType<typeof setTimeout> | null = null;
    const listo = () => {
      if (aperturasEnCamino > 0 && temporizador !== null) return;
      esperando.delete(listo);
      if (temporizador !== null) clearTimeout(temporizador);
      resolver();
    };
    esperando.add(listo);
    temporizador = setTimeout(() => {
      temporizador = null;
      listo();
    }, maxMs);
  });
}

/** La ficha que trajo /live para este contacto (menos de 30 s), o null. Se usa una sola vez. */
export function tomarFichaDeLaApertura(contactId: string): unknown | null {
  const guardada = fichas.get(contactId);
  fichas.delete(contactId);
  return guardada && Date.now() - guardada.en < VIDA_MS ? guardada.valor : null;
}

/** Si los seguimientos de este chat estan apagados segun /live (menos de 30 s), o null. */
export function tomarSeguimientosDeLaApertura(conversationId: string): boolean | null {
  const guardado = seguimientos.get(conversationId);
  seguimientos.delete(conversationId);
  return guardado && Date.now() - guardado.en < VIDA_MS ? guardado.apagados : null;
}
