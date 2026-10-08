/**
 * Regla UNICA de la firma de los mensajes manuales del chat.
 *
 * La usan el servidor (prependUserChatSignature, antes de mandar a WhatsApp) y el navegador
 * (burbuja optimista y fila de la lista). Si cada lado tuviera su copia, la burbuja saldria
 * sin firma y al llegar el mensaje real "saltaria" a la version firmada, con otro alto y ancho.
 *
 * La firma va ARRIBA, como encabezado de quien escribe, y el mensaje debajo:
 *   👩‍💻 *Ingrid Sánchez*
 *   Hola
 *
 * - Sin firma configurada (vacia o solo espacios): el mensaje sale tal cual.
 * - Si el texto ya empieza con la firma (la escribio a mano o reenvia algo firmado): no se duplica.
 *
 * Funcion pura, sin imports: se puede usar en server actions, componentes de cliente y pruebas.
 */
export function aplicarFirmaDelChat(message: string, signature: string | null | undefined): string {
  const firma = signature?.trim();
  if (!firma) {
    return message;
  }

  const body = message.replace(/^\s+/, "");
  if (body.startsWith(firma)) {
    return message;
  }

  return `${firma}\n${body}`;
}
