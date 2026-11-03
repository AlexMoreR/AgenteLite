/*
  RECONEXIÓN SOLA DE LA SALA (lógica pura, sin navegador ni LiveKit: se prueba con node).

  Cuando la sala pierde la conexión del todo, la pantalla decide con estas funciones si vuelve a entrar
  sola (con un pase nuevo y la misma identidad), cuánto espera entre intentos y cuándo se rinde.
  Se rinde a los 10 minutos: es lo que LiveKit espera con la sala vacía antes de cerrarla.
*/

/** Esperas de los primeros intentos; después, cada 15 s. */
export const ESPERAS_MS = [1_000, 2_000, 4_000, 8_000] as const;
export const ESPERA_LARGA_MS = 15_000;
export const RENDIRSE_MS = 10 * 60 * 1000;

/**
 * Motivos de LiveKit (DisconnectReason) con los que NO se vuelve a entrar:
 * terminaron la reunión, la misma persona entró en otro dispositivo o la sacaron.
 * Reconectar en esos casos dejaría dos sesiones peleando o volvería a meter a alguien que sacaron.
 */
export const MOTIVOS_SIN_RECONEXION = ["ROOM_DELETED", "DUPLICATE_IDENTITY", "PARTICIPANT_REMOVED"] as const;

/** El nombre del motivo (ROOM_DELETED…), venga como número del enum o como texto. */
export function nombreDelMotivo(motivo: unknown, tabla?: Record<string, number | string> | null): string | null {
  if (typeof motivo === "string") {
    return motivo;
  }
  if (typeof motivo !== "number" || !tabla) {
    return null;
  }
  for (const [nombre, valor] of Object.entries(tabla)) {
    if (valor === motivo && !/^\d+$/.test(nombre)) {
      return nombre;
    }
  }
  return null;
}

/**
 * ¿Se vuelve a entrar sola? No si la persona tocó «Salir» (salida voluntaria) ni con los motivos de arriba.
 * Sí con cualquier caída de red o de señal (también sin motivo conocido).
 */
export function debeReconectar({
  motivo,
  tabla,
  voluntaria,
}: {
  motivo?: unknown;
  tabla?: Record<string, number | string> | null;
  voluntaria: boolean;
}): boolean {
  if (voluntaria) {
    return false;
  }
  const nombre = nombreDelMotivo(motivo, tabla);
  return !(nombre && (MOTIVOS_SIN_RECONEXION as readonly string[]).includes(nombre));
}

/** Cuánto esperar antes del intento número `intento` (0 es el primero): 1, 2, 4, 8 y después 15 s. */
export function esperaDelIntento(intento: number): number {
  const indice = Math.max(0, Math.floor(intento));
  return indice < ESPERAS_MS.length ? ESPERAS_MS[indice] : ESPERA_LARGA_MS;
}

/** ¿Ya pasaron los 10 minutos desde la caída? */
export function hayQueRendirse(caidaDesdeMs: number, ahoraMs: number): boolean {
  return ahoraMs - caidaDesdeMs >= RENDIRSE_MS;
}
