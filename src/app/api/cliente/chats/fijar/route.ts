import { fijarMensajeAction } from "@/app/actions/mensaje-fijado-actions";
import { atenderRutaDeEnvio } from "@/lib/chats/atender-ruta-de-envio";

/*
  Fijar o desfijar un mensaje del chat por ruta fija (sobrevive a los despliegues, igual que
  reaccionar). Recibe en JSON la entrada EXACTA de fijarMensajeAction ({conversationId, messageId};
  messageId null desfija) y contesta lo que ella devuelve. Es SOLO del CRM: no manda nada por
  WhatsApp. Contrato en src/lib/chats/ruta-de-envio.ts. No valida por su cuenta ni importa Prisma.
*/

export function POST(request: Request) {
  return atenderRutaDeEnvio(request, "fijar", fijarMensajeAction);
}
