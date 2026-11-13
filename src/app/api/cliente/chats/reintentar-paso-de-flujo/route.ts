import { reintentarPasoDeFlujoAction } from "@/app/actions/flow-send-actions";
import { atenderRutaDeEnvio } from "@/lib/chats/atender-ruta-de-envio";

/*
  «No salió · Reintentar» de UN paso de un flujo (parte 4 de «Flujos: que se envíen completos aunque
  la asesora cambie de chat, y al instante»), por ruta fija: sobrevive a los despliegues. Recibe en
  JSON { envioId, indice } y contesta lo que devuelve reintentarPasoDeFlujoAction tal cual. Contrato en
  src/lib/chats/ruta-de-envio.ts: solo se agregan campos opcionales; esta ruta no se renombra ni se
  borra. No valida por su cuenta ni importa Prisma ni gateways.
*/

export function POST(request: Request) {
  return atenderRutaDeEnvio(request, "reintentar-paso-de-flujo", reintentarPasoDeFlujoAction);
}
