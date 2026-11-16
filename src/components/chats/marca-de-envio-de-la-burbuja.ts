import { esFotoEnEnvio, type EstadoDeFoto } from "./fotos-en-envio";

/*
  Qué marca de envío dibuja la burbuja al lado de la hora (y en la tarjeta de documento).

  Antes la regla vivía suelta en chat-message-bubble.tsx: «si el número empieza por
  `optimistic-media:` y no trae estado de la cola, ruedita». Una foto de la cola que ya había
  salido del almacén (quitarFotos) pero seguía en la lista un render más quedaba sin estado y
  dibujaba la ruedita para siempre. Ahora:

  - Número de la cola (`optimistic-media:local-…`) con estado `fallida`: "fallida" (la capa con
    Reintentar/Descartar la dibuja la burbuja aparte).
  - Número de la cola con otro estado, o SIN estado: "enviado" (✓, como WhatsApp). Sin estado
    quiere decir que la cola ya la soltó: no hay nada subiendo.
  - `optimistic-media:` que no es de la cola: "ruedita", como antes (hoy ningún camino los crea).
  - Otro número optimista (`optimistic:` de un texto) sin acuse de WhatsApp: "reloj".
  - Lo demás: "ninguna"; la burbuja dibuja el acuse de WhatsApp (SENT, DELIVERED, READ…).
*/
export type MarcaDeEnvio = "ruedita" | "reloj" | "enviado" | "fallida" | "ninguna";

export function marcaDeEnvioDeLaBurbuja(input: {
  id: string;
  fotoEstado?: EstadoDeFoto | null;
  outboundStatusLabel?: string | null;
}): MarcaDeEnvio {
  const { id, fotoEstado, outboundStatusLabel } = input;
  if (fotoEstado === "fallida") return "fallida";
  if (fotoEstado || esFotoEnEnvio(id)) return "enviado";
  if (id.startsWith("optimistic-media:")) return "ruedita";
  if (id.startsWith("optimistic") && !outboundStatusLabel) return "reloj";
  return "ninguna";
}
