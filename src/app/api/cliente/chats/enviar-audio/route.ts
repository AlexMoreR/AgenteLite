import { sendChatAudioReplyAction } from "@/app/actions/agent-actions";
import { atenderRutaDeEnvio } from "@/lib/chats/atender-ruta-de-envio";

/*
  Nota de voz o audio por ruta fija: sobrevive a los despliegues (una Server Action cambia de id en
  cada build). Recibe en JSON la entrada EXACTA de sendChatAudioReplyAction y contesta lo que ella
  devuelve; el freno de repetidos (NOTAS_DE_VOZ_EN_CURSO) sigue adentro de la accion. Contrato en
  src/lib/chats/ruta-de-envio.ts: solo se agregan campos opcionales; esta ruta no se renombra ni se
  borra. No valida por su cuenta ni importa Prisma ni gateways.
*/

export function POST(request: Request) {
  return atenderRutaDeEnvio(request, "enviar-audio", sendChatAudioReplyAction);
}
