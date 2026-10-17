/**
 * CHATS YA CERRADOS EN EL COACH (Alex, 16-10-2026): el Coach muestra el informe que se guardo en la
 * noche, asi que un chat que despues se resolvio, se descarto (Perdido) o se gano seguia saliendo
 * en "Pendientes para hoy" / "Pendientes para mañana" y en "Lo que te dejó el Coach" de Mi día.
 *
 * Se arregla AL LEER (el informe guardado no cambia):
 *  - las listas que piden ACTUAR sobre un chat (pendientes) quitan los chats cerrados;
 *  - la evidencia, los errores y los aciertos (ejemplos para entrenar) se quedan, con una etiqueta
 *    "Resuelto" / "Descartado" / "Ganado" para que se vea que ya estan cerrados.
 *
 * Puro, solo imports relativos: lo prueba scripts/check-coach-resueltos.mjs
 * (npm run test:coach-resueltos).
 */

import { estaResuelto } from "../../../lib/chat-resuelto";

export type CierreDeChat = "resuelto" | "descartado" | "ganado";

/** numero corto del chat -> como quedo cerrado. Solo trae los chats cerrados. */
export type CierresPorNumero = Record<number, CierreDeChat>;

export const ETIQUETA_DE_CIERRE: Record<CierreDeChat, string> = {
  resuelto: "Resuelto",
  descartado: "Descartado",
  ganado: "Ganado",
};

/**
 * ¿Como quedo cerrado el chat HOY? La etapa manda sobre el estado: un chat ganado y resuelto dice
 * "Ganado". null = sigue abierto (se le hace seguimiento).
 */
export function cierreDeChat(chat: { estado?: string | null; crmStage?: string | null }): CierreDeChat | null {
  const etapa = String(chat.crmStage ?? "").toUpperCase();
  if (etapa === "GANADO") return "ganado";
  if (etapa === "PERDIDO") return "descartado";
  if (estaResuelto(chat.estado)) return "resuelto";
  return null;
}

/** Arma el mapa con lo que trajo la base (filas de Conversation u OfficialApiConversation). */
export function armarCierres(filas: Array<{ numero: number | null; estado?: string | null; crmStage?: string | null }>): CierresPorNumero {
  const salida: CierresPorNumero = {};
  for (const fila of filas) {
    if (typeof fila.numero !== "number") continue;
    const cierre = cierreDeChat(fila);
    if (cierre) salida[fila.numero] = cierre;
  }
  return salida;
}

export function cierreDe(numero: number | null | undefined, cierres: CierresPorNumero | null | undefined): CierreDeChat | null {
  if (typeof numero !== "number" || !cierres) return null;
  return cierres[numero] ?? null;
}

/** Quita de una lista para ACTUAR los chats que ya estan cerrados. Sin numero: se queda (no se sabe). */
export function sinChatsCerrados<T extends { numero: number | null }>(lista: T[], cierres: CierresPorNumero | null | undefined): T[] {
  if (!cierres) return lista;
  return lista.filter((item) => !cierreDe(item.numero, cierres));
}

/** Los numeros de chat de una parte del informe (para UNA consulta con todos). */
export function numerosDeLaParte(parte: {
  errores: Array<{ numero: number | null }>;
  pendientes: Array<{ numero: number | null }>;
  aciertos?: Array<{ numero: number | null }>;
  resumen?: { habilidad?: { evidencia: Array<{ numero: number | null }> } | null } | null;
}): number[] {
  const todos = [
    ...parte.errores,
    ...parte.pendientes,
    ...(parte.aciertos ?? []),
    ...(parte.resumen?.habilidad?.evidencia ?? []),
  ].map((x) => x.numero);
  return [...new Set(todos.filter((n): n is number => typeof n === "number" && Number.isSafeInteger(n) && n > 0))];
}

/** Solo los cierres de estos numeros (a una asesora no le llegan los de las demas). */
export function cierresDe(numeros: number[], cierres: CierresPorNumero): CierresPorNumero {
  const salida: CierresPorNumero = {};
  for (const n of numeros) if (cierres[n]) salida[n] = cierres[n];
  return salida;
}
