import { sendChatMediaReplyAction } from "@/app/actions/agent-actions";
import { atenderRutaDeEnvio } from "@/lib/chats/atender-ruta-de-envio";
import { conServerTiming } from "@/lib/server-timing";

/*
  Foto, video o documento (envio final) por ruta fija: sobrevive a los despliegues (una Server
  Action cambia de id en cada build). Recibe en JSON la entrada EXACTA de sendChatMediaReplyAction y
  contesta lo que ella devuelve. Contrato en src/lib/chats/ruta-de-envio.ts: solo se agregan campos
  opcionales; esta ruta no se renombra ni se borra. No valida por su cuenta ni importa Prisma ni gateways.

  Con Server-Timing y la linea [timing] (velocidad de fotos, 11-nov-2026): los pasos de la ruta
  (ruta_auth, ruta_cuerpo, ruta_accion) y los de la accion (archivo_sesion, archivo_datos,
  archivo_whatsapp, archivo_guardado...) mas las llamadas a WAHA (waha_*).
*/

export const POST = conServerTiming(
  (request) => atenderRutaDeEnvio(request, "enviar-archivo", sendChatMediaReplyAction),
  { log: "chats/enviar-archivo" },
);
