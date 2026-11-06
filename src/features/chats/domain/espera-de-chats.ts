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

/**
 * Los parametros de la direccion que ya eligen que mirar. Si viene cualquiera (un enlace a un chat,
 * una lista guardada, un filtro, la busqueda), la bandeja respeta eso y no elige la vista inicial.
 */
export const PARAMETROS_QUE_ELIGEN_LA_VISTA = [
  "chatKey",
  "conversacion",
  "assigned",
  "q",
  "status",
  "c",
  "stage",
  "tag",
  "pending",
  "espera",
] as const;

/** Con que vista abre la bandeja: la pestaña (Mias o Todas) y si arranca en "Esperando respuesta". */
export type VistaInicialDeBandeja = { assigned: "mine" | "all"; espera: boolean };

/**
 * La vista con que abre la bandeja cuando la direccion no pide nada. Funcion pura (la usara la
 * pantalla; la prueba la llama directo).
 *
 * - Asesora con chats suyos esperando: "Esperando respuesta" dentro de Mias, para que vea primero
 *   lo que lleva mas tiempo sin contestar.
 * - Asesora sin chats esperando: Mias, como siempre.
 * - Dueño, administrador, supervisora o monitora (`veTodas`): Todas, como siempre.
 *
 * Devuelve null si la direccion ya trae algo de PARAMETROS_QUE_ELIGEN_LA_VISTA: se respeta lo que
 * venga.
 */
export function vistaInicialDeBandeja(input: {
  leer: (clave: string) => string | null | undefined;
  /** Dueño, administrador, supervisora o monitora: abren en Todas. */
  veTodas: boolean;
  /** Cuantos chats de esta persona estan esperando (el `mine` de /counts). */
  suyosEsperando: number;
}): VistaInicialDeBandeja | null {
  const traeAlgo = PARAMETROS_QUE_ELIGEN_LA_VISTA.some((clave) => Boolean(input.leer(clave)?.trim()));
  if (traeAlgo) return null;
  if (input.veTodas) return { assigned: "all", espera: false };
  return { assigned: "mine", espera: input.suyosEsperando > 0 };
}
