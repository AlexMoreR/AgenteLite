/**
 * Si quien mira tiene vista general de la bandeja (jefe o supervisora) o solo lo suyo.
 *
 * Lo aprende el navegador de la respuesta de /api/cliente/chats/list (`isManager`), que ya pide la
 * campanita en toda la app. Sirve para una sola cosa: saber si el aviso `noSeEnteran` del altavoz
 * coincide con lo que muestra su lista. Para una asesora coincide (misma regla que la lista, ver
 * quien-se-entera-del-mensaje); para una supervisora NO -su lista muestra "Todas" de sus lineas,
 * pero el aviso solo la incluye en sus chats asignados-, asi que a ella nunca se le salta nada.
 *
 * Mientras no se sepa (null), se comporta como antes: no se salta ningun aviso.
 */
let tieneVistaGeneral: boolean | null = null;

export function recordarVistaDeLaBandeja(isManager: unknown) {
  if (typeof isManager === "boolean") {
    tieneVistaGeneral = isManager;
  }
}

/** true solo cuando ya se sabe que su lista es "Mias" (o la de lo que monitorea). */
export function avisoAjenoCoincideConSuLista() {
  return tieneVistaGeneral === false;
}
