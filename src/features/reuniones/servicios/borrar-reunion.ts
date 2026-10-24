import type { EstadoReunion } from "@prisma/client";

/*
  BORRAR UNA REUNIÓN (regla pura, sin base de datos).

  Solo se borra lo que no tiene grabación que valga: ESPERANDO (nadie entró) o ERROR. Cualquier otro
  estado (en vivo, en cola, transcribiendo, haciendo acta, lista) se conserva. Esta regla la revisa
  el servidor; la pantalla solo la usa para mostrar o esconder el botón.
  Pueden borrar: quien la creó, el dueño del negocio y los administradores (igual que "Terminar reunión").
*/

export const ESTADOS_QUE_SE_PUEDEN_BORRAR: EstadoReunion[] = ["ESPERANDO", "ERROR"];

export function sePuedeBorrarPorEstado(estado: EstadoReunion | string): boolean {
  return (ESTADOS_QUE_SE_PUEDEN_BORRAR as string[]).includes(estado);
}

export function puedeBorrarPorPersona(quien: { userId: string; esDuenoOAdmin: boolean }, creadaPorId: string | null): boolean {
  return quien.esDuenoOAdmin || (creadaPorId !== null && creadaPorId === quien.userId);
}

export function puedeBorrarLaReunionDe(
  quien: { userId: string; esDuenoOAdmin: boolean },
  reunion: { estado: EstadoReunion | string; creadaPorId: string | null },
): boolean {
  return sePuedeBorrarPorEstado(reunion.estado) && puedeBorrarPorPersona(quien, reunion.creadaPorId);
}
