import { sendFlowToChatAction } from "@/app/actions/flow-send-actions";
import { atenderRutaDeEnvio } from "@/lib/chats/atender-ruta-de-envio";

/*
  Mandar un flujo (texto y archivos) por ruta fija: sobrevive a los despliegues (una Server Action
  cambia de id en cada build). Recibe en JSON la entrada EXACTA de sendFlowToChatAction y contesta su
  SendFlowResult tal cual. Ya no hay pausas adentro: la accion guarda el envio y contesta al instante,
  y el servidor manda los pasos despues (procesarEnvioDeFlujo). Contrato en
  src/lib/chats/ruta-de-envio.ts: solo se agregan campos opcionales; esta ruta no se renombra ni se
  borra. No valida por su cuenta ni importa Prisma ni gateways.
*/

export function POST(request: Request) {
  return atenderRutaDeEnvio(request, "enviar-flujo", sendFlowToChatAction);
}
