import type { EstadoReunion } from "@prisma/client";

/** Cómo se lee cada estado en la pantalla (y en el MCP). */
export const NOMBRE_DEL_ESTADO: Record<EstadoReunion, string> = {
  ESPERANDO: "Esperando",
  EN_VIVO: "En vivo",
  EN_COLA: "En cola",
  TRANSCRIBIENDO: "Transcribiendo",
  HACIENDO_ACTA: "Haciendo acta",
  LISTA: "Lista",
  ERROR: "Error",
};

/** Mientras está en alguno de estos, la lista se refresca sola. */
export const ESTADOS_EN_CURSO: EstadoReunion[] = ["EN_VIVO", "EN_COLA", "TRANSCRIBIENDO", "HACIENDO_ACTA"];

/** Se puede entrar por el link mientras la reunión no terminó. */
export const ESTADOS_PARA_ENTRAR: EstadoReunion[] = ["ESPERANDO", "EN_VIVO"];

/** La identidad en LiveKit: u_<userId> con sesión; i_<azar> un invitado. */
export const identidadDeUsuario = (userId: string) => `u_${userId}`;
export const esIdentidadDeInvitado = (identidad: string) => /^i_[A-Za-z0-9_-]{10,40}$/.test(identidad);
export function userIdDeIdentidad(identidad: string): string | null {
  return identidad.startsWith("u_") ? identidad.slice(2) || null : null;
}
