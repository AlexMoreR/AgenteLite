/**
 * "Esperando respuesta": los chats donde el cliente escribio y ninguna PERSONA le contesto.
 *
 * Esta parte no importa Prisma a proposito: los tipos y la ventana los va a usar tambien la
 * bandeja, que corre en el navegador. Las consultas viven en ../services/espera-de-chats.ts.
 *
 * Ojo: no es lo mismo que el filtro "Sin responder" ni que el turno de la conversacion
 * (lib/turno-de-la-conversacion.ts). Aca el bot NO cuenta como respuesta: un chat que solo
 * atendio el bot sigue esperando a una persona.
 */

/** Solo se mira lo de las ultimas 72 horas: lo mas viejo no es trabajo de hoy. */
export const HORAS_DE_ESPERA = 72;
export const VENTANA_DE_ESPERA_MS = HORAS_DE_ESPERA * 60 * 60 * 1000;

/** Un chat esperando, tal como sale en GET /api/cliente/chats/counts. */
export type ChatEsperando = {
  /** `agent:<id>` u `official:<id>`: la misma clave que usa la lista. */
  key: string;
  /** Desde cuando espera (ISO): el primer mensaje del cliente que nadie le contesto. */
  desde: string;
  /** Es de quien pregunta (asesora principal o segunda). */
  mia: boolean;
};

/** El campo `espera` de /counts. `null` si no se pudo calcular (el resto de la respuesta sale igual). */
export type EsperaDeChats = {
  /** Cuantos de los que esperan son de quien pregunta. */
  mine: number;
  /** Cuantos esperan de todo lo que esa persona ve. */
  all: number;
  /** Los que esperan, el que mas lleva esperando primero. */
  chats: ChatEsperando[];
};
