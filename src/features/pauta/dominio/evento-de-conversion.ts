/**
 * EVENTO DE CONVERSIÓN (reglas puras, sin base ni red): arma el evento "Purchase" que se le avisa a Meta
 * (API de Conversiones, canal WhatsApp) cuando un chat que llegó por un anuncio se vuelve venta, y decide
 * si esa venta se manda o no.
 *
 * Al evento solo van el ctwa_clid del chat y la cuenta de WhatsApp Business: nunca teléfono, nombre ni ciudad.
 *
 * Este archivo no importa Prisma a propósito: se prueba con `node scripts/check-conversiones-meta.mjs`.
 */

export type ModoConversiones = "APAGADO" | "PRUEBA" | "ACTIVO";

/** Un evento ERROR con estos intentos o más ya no se reintenta: cuenta como ya enviado. */
export const MAX_INTENTOS = 3;
/** Meta no acepta eventos de más de 7 días. */
export const DIAS_MAXIMOS = 7;
export const MONEDA = "COP";
export const LLAVES_META_CAPI = ["META_CAPI_ACCESS_TOKEN", "META_CAPI_DATASET_ID", "META_CAPI_WABA_ID"] as const;

const MODOS: readonly ModoConversiones[] = ["APAGADO", "PRUEBA", "ACTIVO"];

/** Cualquier valor que no sea PRUEBA o ACTIVO (vacío, mal escrito, otro tipo) da APAGADO. */
export function leerModo(valor: unknown): ModoConversiones {
  if (typeof valor !== "string") return "APAGADO";
  const limpio = valor.trim().toUpperCase();
  return (MODOS as readonly string[]).includes(limpio) ? (limpio as ModoConversiones) : "APAGADO";
}

export type EventoPurchase = {
  event_name: "Purchase";
  event_time: number;
  action_source: "business_messaging";
  messaging_channel: "whatsapp";
  event_id: string;
  user_data: { whatsapp_business_account_id: string; ctwa_clid: string };
  custom_data: { currency: typeof MONEDA; value: number };
};

/** El evento Purchase de una venta de pauta. `event_id` es el id de la venta, para que Meta no lo cuente dos veces. */
export function armarEventoPurchase(entrada: {
  ventaDePautaId: string;
  pagadaEn: Date;
  valor: number;
  ctwaClid: string;
  wabaId: string;
}): EventoPurchase {
  return {
    event_name: "Purchase",
    event_time: Math.floor(entrada.pagadaEn.getTime() / 1000),
    action_source: "business_messaging",
    messaging_channel: "whatsapp",
    event_id: entrada.ventaDePautaId,
    user_data: { whatsapp_business_account_id: entrada.wabaId, ctwa_clid: entrada.ctwaClid },
    custom_data: { currency: MONEDA, value: entrada.valor },
  };
}

export type CuerpoConversiones = { data: EventoPurchase[]; test_event_code?: string };

/** El cuerpo que se le manda a Meta. `test_event_code` solo va en PRUEBA (los eventos salen en "Probar eventos"). */
export function armarCuerpo(eventos: EventoPurchase[], modo: ModoConversiones, codigoPrueba?: string | null): CuerpoConversiones {
  const cuerpo: CuerpoConversiones = { data: eventos };
  if (modo === "PRUEBA" && codigoPrueba && codigoPrueba.trim()) cuerpo.test_event_code = codigoPrueba.trim();
  return cuerpo;
}

export type MotivoNoEnvio = "APAGADO" | "NO_ES_PAUTA" | "SIN_CLID" | "SIN_MONTO" | "MUY_VIEJA" | "YA_ENVIADO";
export type DecisionEnvio = { mandar: true } | { mandar: false; motivo: MotivoNoEnvio };

/** El evento que ya se guardó para esta venta (en este modo), o null si nunca se intentó. */
export type EventoPrevio = { estado: string; intentos: number } | null | undefined;

/** Ya enviado: ENVIADO, o un ERROR que ya gastó sus MAX_INTENTOS. Un SIN_MONTO o un ERROR con menos intentos se vuelve a intentar. */
export function cuentaComoEnviado(previo: EventoPrevio): boolean {
  if (!previo) return false;
  if (previo.estado === "ENVIADO") return true;
  return previo.estado === "ERROR" && previo.intentos >= MAX_INTENTOS;
}

export function montoValido(monto: unknown): monto is number {
  return typeof monto === "number" && Number.isFinite(monto) && monto > 0;
}

export function decidirEnvio(entrada: {
  venta: { categoria: string; pagadaEn: Date };
  ctwaClid: string | null | undefined;
  monto: unknown;
  modo: ModoConversiones;
  yaEnviado: EventoPrevio;
  ahora: Date;
}): DecisionEnvio {
  if (entrada.modo !== "PRUEBA" && entrada.modo !== "ACTIVO") return { mandar: false, motivo: "APAGADO" };
  if (entrada.venta.categoria !== "PAUTA") return { mandar: false, motivo: "NO_ES_PAUTA" };
  if (!entrada.ctwaClid || !entrada.ctwaClid.trim()) return { mandar: false, motivo: "SIN_CLID" };
  if (!montoValido(entrada.monto)) return { mandar: false, motivo: "SIN_MONTO" };
  const edad = entrada.ahora.getTime() - entrada.venta.pagadaEn.getTime();
  // Una fecha inválida tampoco se manda.
  if (!Number.isFinite(edad) || edad > DIAS_MAXIMOS * 24 * 60 * 60 * 1000) return { mandar: false, motivo: "MUY_VIEJA" };
  if (cuentaComoEnviado(entrada.yaEnviado)) return { mandar: false, motivo: "YA_ENVIADO" };
  return { mandar: true };
}

/** Las llaves de la API de Conversiones que faltan (o están vacías) en el entorno. Nunca devuelve sus valores. */
export function faltanLlaves(env: Record<string, string | undefined>): string[] {
  return LLAVES_META_CAPI.filter((llave) => !env[llave] || !String(env[llave]).trim());
}
