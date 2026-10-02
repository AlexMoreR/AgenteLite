/**
 * LAS NOTAS INTERNAS DEL AGENTE V3 NO SE MUESTRAN EN EL CHAT.
 *
 * Despues de cada respuesta el motor deja una nota que explica por que contesto lo que contesto
 * ("Agente V3: Ganó «Pide el combo de camillas» porque el cliente dijo..."), y el rescate y los
 * viejos seguimientos dejaban otras con el mismo comienzo. Sirven para depurar una respuesta, pero
 * en el chat nadie las lee y estorban entre los mensajes (Alex, 02-10-2026).
 *
 * Se siguen GUARDANDO igual -son mensajes de tipo SYSTEM en la base- y se pueden ver por el MCP
 * (`ver_conversacion` las muestra con quien = "sistema"). Solo se sacan de la vista del chat, para
 * todos, incluido el dueño. Nunca se envian por WhatsApp: se escriben directo en la base con
 * `recordConversationActivity`, que no manda nada.
 *
 * "El agente pide un asesor: ..." NO empieza asi y sigue visible: esa si la usan las asesoras.
 *
 * Este archivo lo usan el servidor (para no mandarlas al navegador) y el navegador (por las que
 * hayan quedado en la cache del chat), asi que no puede importar nada del servidor.
 */

export const PREFIJO_NOTA_INTERNA_DEL_AGENTE = "Agente V3:";

export function esNotaInternaDelAgente(mensaje: { type?: string | null; content?: string | null }) {
  return mensaje.type === "SYSTEM" && (mensaje.content ?? "").trimStart().startsWith(PREFIJO_NOTA_INTERNA_DEL_AGENTE);
}
