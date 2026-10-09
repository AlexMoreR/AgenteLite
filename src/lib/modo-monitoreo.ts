import { canalesDelNegocio } from "@/lib/canales-del-negocio";

/**
 * Modo monitoreo: mirar sin poder tocar.
 *
 * Nace de entrenar gente nueva. Alex necesitaba que una asesora recien entrada VIERA como trabaja
 * el agente -todos los chats del canal, no solo los suyos- sin poder escribirle a un cliente y sin
 * llevarse los numeros. Las dos cosas a la vez: darle "Todas" pero quitarle la mano.
 *
 * Lo que cambia para quien esta en modo monitoreo:
 *  - Ve TODOS los chats del canal que monitorea, aunque no sea jefa.
 *  - No puede enviar nada: ni texto, ni audio, ni archivos, ni borrar mensajes.
 *  - Los telefonos le llegaban tapados. YA NO (ver TAPAR_TELEFONOS).
 */

/*
  Tapar los telefonos, apagado (Alex, 30-09-2026: "eso de ocultar numero quitalo a los monitores").

  Todas las pantallas pasan por las dos funciones de abajo, asi que se apaga aca, en un solo lugar,
  y vuelve igual de facil si algun dia se quiere de nuevo. Cuando estaba prendido se tapaba DEL
  SERVIDOR, no en la pantalla: el numero real no viajaba, que es lo unico que sirve para taparlo.
*/
const TAPAR_TELEFONOS = false;

/** El aviso, escrito una sola vez para que todas las puertas digan lo mismo. */
export const AVISO_MODO_MONITOREO =
  "Estás en modo monitoreo: puedes ver los chats, pero no escribir ni enviar.";

/**
 * Tapa los ultimos 4 digitos: `573214861454` queda `57321486****`.
 *
 * Alcanza para que no se pueda contactar a nadie -sin los 4 finales no hay numero- y a la vez el
 * chat sigue siendo reconocible: dos conversaciones distintas no se ven iguales en la lista, que
 * es lo que pasaria tapandolo entero.
 */
export function enmascararTelefono(valor?: string | null): string {
  const texto = (valor ?? "").trim();
  if (!TAPAR_TELEFONOS) {
    return texto;
  }
  const digitos = texto.replace(/\D/g, "");
  if (digitos.length < 5) {
    return texto;
  }
  return `${texto.slice(0, Math.max(0, texto.length - 4))}****`;
}

/**
 * Tapa el valor SOLO si parece un telefono.
 *
 * En la lista, el titulo del chat es el nombre del cliente; cuando no lo tenemos, es su numero. Se
 * enmascara ese caso y se deja el nombre en paz, que no es un dato de contacto.
 */
export function enmascararSiEsTelefono(valor?: string | null): string {
  const texto = (valor ?? "").trim();
  if (!TAPAR_TELEFONOS || !texto || /[a-zA-ZáéíóúÁÉÍÓÚñÑ]/.test(texto)) {
    return texto;
  }
  return texto.replace(/\D/g, "").length >= 8 ? enmascararTelefono(texto) : texto;
}

/** Los canales que esta persona solo mira. Vacio = no esta en modo monitoreo. */
export async function canalesQueMonitorea(input: {
  workspaceId: string;
  userId: string;
}): Promise<string[]> {
  // De la cache de canales: se vacia sola con cualquier cambio de monitoras (cache-de-permisos.ts).
  const canales = await canalesDelNegocio(input.workspaceId);

  return canales.filter((canal) => canal.monitores.includes(input.userId)).map((canal) => canal.id);
}

/**
 * Si esta persona esta en modo monitoreo en algun canal.
 *
 * Basta con uno: el modo apaga el envio y tapa los numeros en TODO el CRM, no solo en ese canal.
 * Es a proposito y es la parte que hace que sirva de verdad — con dejarlo suelto en una sola
 * pantalla, quien quisiera el numero lo buscaria en Contactos y listo. Quien tiene que atender
 * clientes no se pone en modo monitoreo; se le quita y vuelve a ser una asesora normal.
 */
export async function estaEnModoMonitoreo(input: {
  workspaceId: string;
  userId: string;
}): Promise<boolean> {
  const canales = await canalesQueMonitorea(input);
  return canales.length > 0;
}
