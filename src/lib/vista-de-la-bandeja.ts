/**
 * Si la lista de quien mira es solo "Mias" o algo mas amplio (jefe, supervisora o monitora).
 *
 * Lo aprende el navegador de la respuesta de /api/cliente/chats/list (`assignedFilter`), que ya
 * pide la campanita en toda la app con `assigned=all`: la ruta solo le impone "mine" a quien no es
 * jefe, supervisora ni monitora. Sirve para una sola cosa: saber si el aviso `noSeEnteran` del
 * altavoz coincide con lo que muestra su lista. Para quien ve solo "Mias" coincide (no se entera
 * de lo que no tiene asignado, ver quien-se-entera-del-mensaje); para los demas NO -su lista
 * muestra chats que no tienen asignados y que no les suenan-, asi que a ellos nunca se les salta
 * nada.
 *
 * Mientras no se sepa (null), se comporta como antes: no se salta ningun aviso.
 */
let tieneVistaGeneral: boolean | null = null;

export function recordarVistaDeLaBandeja(assignedFilter: unknown) {
  if (typeof assignedFilter === "string") {
    tieneVistaGeneral = assignedFilter !== "mine";
  }
}

/** true solo cuando ya se sabe que su lista es "Mias". */
export function avisoAjenoCoincideConSuLista() {
  return tieneVistaGeneral === false;
}
