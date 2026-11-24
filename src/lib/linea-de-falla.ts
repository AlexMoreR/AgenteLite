import { esPasajera, resumenDeError, type LineaDeRegistro } from "@/lib/resumen-de-error";

/*
  LINEA DE FALLA PARA EL REGISTRO, EN UNA SOLA LINEA (24-nov-2026, parte 3).

  La vigilancia de 30 minutos deshacia subidas sanas por `error: 'getaddrinfo EAI_AGAIN
  fcm.googleapis.com'` (notificaciones push) y `error: 'The operation was aborted due to timeout'`
  (webhook de Evolution): salian con console.warn/console.error y un objeto de varias lineas con la
  clave `error:`, aunque fueran cortes de red que ya pasaron.

  Mismo criterio que resumen-de-error.ts (parte 2): una linea con JSON. Si es un corte pasajero va
  como informativa, sin la palabra error, y la etiqueta termina en "corte"; si no, con el nivel de
  siempre (error o aviso), la causa, el codigo y el texto corto.

  No usa la base ni Next: se prueba solo con src/lib/linea-de-falla.test.ts.
*/

/**
 * Etiquetas que son un cliente que se quedo sin respuesta: siguen saliendo como error aunque la
 * causa sea un corte pasajero (la vigilancia tiene que verlas).
 */
const ETIQUETAS_SIEMPRE_ERROR = new Set(["v3_error", "auto_reply_failed"]);

/** El final de la etiqueta que es una palabra de falla (`gap_sync_error`, `v3_asignar_fallo`, `fallo`). */
const FINAL_DE_FALLA = /(?:^|[_\s])(?:error|failed|fallo)$/i;

/** La etiqueta de un corte pasajero: sin el final de falla y con "corte" (`gap_sync_error` → `gap_sync corte`). */
function etiquetaDeCorte(etiqueta: string): string {
  const base = etiqueta.trim().replace(FINAL_DE_FALLA, "").trim();
  return base ? `${base} corte` : "corte";
}

/**
 * La linea de una falla atrapada: `${prefijo} ${etiqueta} {json}`.
 * Pasajera: info, etiqueta con "corte", los datos y la causa (sin texto ni la palabra error).
 * Si no (o si la etiqueta es v3_error / auto_reply_failed): el `nivel` pedido, los datos, la causa,
 * el codigo y el texto corto del error (una linea, 200 letras como maximo).
 */
export function lineaDeFalla(
  prefijo: string,
  etiqueta: string,
  datos: Record<string, unknown>,
  error: unknown,
  nivel: "warn" | "error",
): LineaDeRegistro {
  const { causa, codigo, texto } = resumenDeError(error);
  if (esPasajera(error) && !ETIQUETAS_SIEMPRE_ERROR.has(etiqueta)) {
    return { linea: `${prefijo} ${etiquetaDeCorte(etiqueta)} ${JSON.stringify({ ...datos, causa })}`, nivel: "info" };
  }
  return { linea: `${prefijo} ${etiqueta} ${JSON.stringify({ ...datos, causa, codigo, error: texto })}`, nivel };
}

/** Cuantas letras del endpoint del push se anotan: alcanza para reconocer el servicio sin la clave entera. */
const LARGO_DEL_ENDPOINT = 48;

/**
 * Que hacer cuando falla un envio de push (src/lib/web-push.ts):
 * - 404/410: "podar" (la suscripcion vencio o la revoco el navegador; se borra, sin linea);
 * - corte pasajero: info `[web-push] no_entregado {endpoint, statusCode, causa}`, sin la palabra error;
 * - otra falla: warn `[web-push] send_failed {endpoint, statusCode, causa, error}` con el texto corto.
 */
export function queHacerConFallaDePush(
  endpoint: string,
  statusCode: number | null | undefined,
  error: unknown,
): "podar" | LineaDeRegistro {
  if (statusCode === 404 || statusCode === 410) return "podar";
  const datos = { endpoint: String(endpoint ?? "").slice(0, LARGO_DEL_ENDPOINT), statusCode: statusCode ?? null };
  const { causa, texto } = resumenDeError(error);
  if (esPasajera(error)) {
    return { linea: `[web-push] no_entregado ${JSON.stringify({ ...datos, causa })}`, nivel: "info" };
  }
  return { linea: `[web-push] send_failed ${JSON.stringify({ ...datos, causa, error: texto })}`, nivel: "warn" };
}
