/*
  Cuándo vuelve a preguntar la franja «Enviando flujo» (velocidad de Chats, 21-nov-2026).

  La franja pregunta /avance-de-flujo cada vez que cambia el último mensaje del chat, para que otra
  asesora vea el flujo que salió desde otra pantalla. Al enviar, el último mensaje cambiaba dos
  veces: primero la burbuja provisional («optimistic:…» o la foto en camino) y después el mensaje
  real que trae el servidor. Eran dos pedidos por envío. Las burbujas provisionales no son un
  mensaje nuevo del chat, así que no cuentan: queda un solo pedido, cuando llega el real. Los flujos
  que manda esta pantalla avisan aparte (AVISO_ENVIO_DE_FLUJO).
*/

import { esFotoEnEnvio } from "./fotos-en-envio";

const esProvisional = (id: string) => id.startsWith("optimistic:") || esFotoEnEnvio(id);

/** El id del último mensaje que ya puso el servidor; 0 si todavía no hay ninguno. */
export function senalDeLaFranja(mensajes: readonly { id: string }[]): string | 0 {
  for (let i = mensajes.length - 1; i >= 0; i -= 1) {
    const id = mensajes[i].id;
    if (!esProvisional(id)) return id;
  }
  return 0;
}
