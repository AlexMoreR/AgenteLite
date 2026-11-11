/*
  Cuando la app se actualiza sola (orden de Alexander, 11-nov-2026).

  La pantalla NUNCA se recarga mientras la asesora la usa y no sale ningun aviso de "version nueva".
  La version nueva entra solo en dos casos:
  1. Al abrir la app o recargar la pagina (el navegador ya trae lo nuevo; no hace falta codigo).
  2. La pestaña lleva MAS de 10 minutos seguidos en segundo plano y no hay nada escrito ni nada por
     salir: entonces se recarga una vez, en silencio, todavia en segundo plano.

  Ante la duda NO se recarga: con la pestaña a la vista nunca, con texto, adjunto, nota de voz o un
  envio pendiente tampoco. Si se llena la barra mientras sigue oculta, se vuelve a mirar en la
  siguiente vuelta (cada minuto); al volver a primer plano el reloj vuelve a cero.

  Una actualizacion urgente NO se fuerza desde el codigo: la decide Alexander.
*/

/** Tiempo seguido en segundo plano a partir del cual se puede recargar (estrictamente mas). */
export const SEGUNDO_PLANO_MINIMO_MS = 10 * 60_000;

export type EstadoParaRecargar = {
  /** document.visibilityState === "visible". */
  visible: boolean;
  /** Cuanto lleva oculta sin interrupcion (0 si esta a la vista). */
  msEnSegundoPlano: number;
  /** Texto en la caja, borradores, adjuntos elegidos o nota de voz grabandose. */
  hayTextoEscrito: boolean;
  /** Un texto o archivo en camino, fallido sin reintentar o guardado en la cola del navegador. */
  hayEnviosPendientes: boolean;
  /** /api/version dice otra version que la cargada. */
  hayVersionNueva: boolean;
  /** Ya se recargo una vez por esta misma version del servidor (para no recargar en bucle). */
  yaSeRecargoPorEstaVersion?: boolean;
};

export function debeRecargarEnSilencio(estado: EstadoParaRecargar): boolean {
  if (estado.visible) {
    return false;
  }
  if (!estado.hayVersionNueva || estado.yaSeRecargoPorEstaVersion) {
    return false;
  }
  // `>` y no `>=`: "mas de 10 minutos". Un NaN tampoco pasa.
  if (!(estado.msEnSegundoPlano > SEGUNDO_PLANO_MINIMO_MS)) {
    return false;
  }
  return !estado.hayTextoEscrito && !estado.hayEnviosPendientes;
}

/** Cuanto lleva oculta. `ocultaDesde` es null mientras esta a la vista. */
export function tiempoEnSegundoPlano(ocultaDesde: number | null, ahora: number): number {
  if (ocultaDesde === null || ahora < ocultaDesde) {
    return 0;
  }
  return ahora - ocultaDesde;
}
