/*
  Que hacer cuando una nota de voz no sale (asesoras en celular, 08-10-2026).

  Ese dia, entre las 4:10 y las 4:16 p. m., varias notas de voz se quedaron "pensando" y terminaron
  en "No se pudo enviar la nota de voz." con el audio perdido. En el servidor, TODO lo que llego a
  WhatsApp salio bien: las fallas eran antes, en la subida o en la llamada al envio, por la señal
  del celular o un momento en que la app no respondio (hubo un 502).

  Aca vive solo la decision -sin React ni red- para poder probarla: que paso, si vale la pena
  reintentar solo y que mensaje mostrar. Lo usa el compositor del chat.
*/

/** Cuanto espera la subida antes de darla por perdida. Una nota de voz pesa pocos cientos de KB. */
export const TIEMPO_LIMITE_SUBIDA_MS = 45_000;
/** Espera antes del unico reintento automatico. */
export const ESPERA_ANTES_DE_REINTENTAR_MS = 2_000;

export type FallaDeNotaDeVoz = {
  /** Que paso, para el registro y para elegir el mensaje. */
  tipo: "conexion" | "tiempo" | "rechazo";
  /** Si se puede volver a intentar sin riesgo y con chance de que salga. */
  reintentable: boolean;
  /** Lo que se le muestra a la asesora. */
  mensaje: string;
};

export type PasoDeNotaDeVoz<T> = { ok: true; valor: T } | { ok: false; falla: FallaDeNotaDeVoz };

export const MENSAJE_SIN_CONEXION_SUBIDA = "No se pudo subir el audio (conexión).";
export const MENSAJE_SIN_CONEXION_ENVIO = "No se pudo enviar el audio (conexión).";
export const MENSAJE_TIEMPO_AGOTADO = "Se agotó el tiempo al subir el audio.";

/**
 * Lo que respondio (o no) el servidor al subir el audio.
 *
 * - Sin respuesta (sin señal, corte) o tiempo vencido: reintentable.
 * - 5xx, 408 o 429 (la app no respondio, un 502 de paso): reintentable.
 * - Cualquier otro 4xx (formato no permitido, sin permiso, muy pesado): NO. Repetirlo da lo mismo,
 *   y se muestra el motivo tal cual.
 */
export function clasificarSubida(input: {
  /** null si no hubo respuesta (fetch fallo o se aborto). */
  status: number | null;
  /** true si se corto por el tiempo limite. */
  vencio?: boolean;
  url?: string | null;
  error?: string | null;
}): PasoDeNotaDeVoz<string> {
  if (input.vencio) {
    return { ok: false, falla: { tipo: "tiempo", reintentable: true, mensaje: MENSAJE_TIEMPO_AGOTADO } };
  }
  if (input.status === null) {
    return { ok: false, falla: { tipo: "conexion", reintentable: true, mensaje: MENSAJE_SIN_CONEXION_SUBIDA } };
  }
  if (input.status >= 200 && input.status < 300 && input.url) {
    return { ok: true, valor: input.url };
  }
  const transitorio = input.status >= 500 || input.status === 408 || input.status === 429 || input.status < 400;
  if (transitorio) {
    return { ok: false, falla: { tipo: "conexion", reintentable: true, mensaje: MENSAJE_SIN_CONEXION_SUBIDA } };
  }
  const detalle = input.error?.trim();
  return {
    ok: false,
    falla: {
      tipo: "rechazo",
      reintentable: false,
      mensaje: detalle ? `No se pudo subir el audio: ${detalle}` : "No se pudo subir el audio.",
    },
  };
}

/**
 * Lo que devolvio la accion de envio.
 *
 * La clave para no mandar el audio dos veces: SOLO se reintenta si la llamada no llego a dar una
 * respuesta (excepcion de red, la app caida). Si el servidor contesto `{ error }`, ya decidio
 * -ventana de 24 h, numero invalido, WhatsApp lo rechazo- y repetir no cambia nada: se muestra tal
 * cual. Y aun en el reintento, el servidor reconoce la misma URL y no lo vuelve a mandar.
 */
export function clasificarEnvio(input: { resultado?: unknown; excepcion?: boolean }): PasoDeNotaDeVoz<true> {
  if (input.excepcion) {
    return { ok: false, falla: { tipo: "conexion", reintentable: true, mensaje: MENSAJE_SIN_CONEXION_ENVIO } };
  }
  const resultado = input.resultado as { ok?: unknown; error?: unknown } | null | undefined;
  if (resultado && resultado.ok === true) {
    return { ok: true, valor: true };
  }
  if (resultado && typeof resultado.error === "string" && resultado.error.trim()) {
    const detalle = resultado.error.trim().replace(/^No se pudo enviar la nota de voz:?\s*/i, "");
    return {
      ok: false,
      falla: {
        tipo: "rechazo",
        reintentable: false,
        mensaje: detalle ? `WhatsApp no aceptó el audio: ${detalle}` : "WhatsApp no aceptó el audio.",
      },
    };
  }
  // Una respuesta vacia o rara es la app que no contesto bien: igual que sin conexion.
  return { ok: false, falla: { tipo: "conexion", reintentable: true, mensaje: MENSAJE_SIN_CONEXION_ENVIO } };
}

/**
 * Corre un paso y, si fallo de forma reintentable, lo repite UNA vez despues de una espera.
 * Una falla no reintentable (o la segunda falla) se devuelve tal cual.
 */
export async function conUnReintento<T>(
  paso: () => Promise<PasoDeNotaDeVoz<T>>,
  opciones: { esperaMs?: number; esperar?: (ms: number) => Promise<void> } = {},
): Promise<PasoDeNotaDeVoz<T> & { intentos: number }> {
  const primero = await paso();
  if (primero.ok || !primero.falla.reintentable) {
    return { ...primero, intentos: 1 };
  }
  const esperar = opciones.esperar ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  await esperar(opciones.esperaMs ?? ESPERA_ANTES_DE_REINTENTAR_MS);
  const segundo = await paso();
  return { ...segundo, intentos: 2 };
}
