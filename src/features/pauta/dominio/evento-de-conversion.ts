/**
 * EVENTO DE CONVERSIÓN PARA META (reglas puras, sin base ni red): arma el evento "Purchase" que se le
 * avisa a la API de Conversiones de Meta cuando un chat que llegó por un anuncio de WhatsApp se vuelve
 * venta, y decide si esa venta se manda o no.
 *
 * El evento solo lleva el `ctwa_clid` (el identificador del clic en el anuncio) y la cuenta de WhatsApp
 * Business: nunca el teléfono, el nombre ni la ciudad del cliente.
 *
 * Este archivo no importa Prisma a propósito: se prueba con `node scripts/check-conversiones-meta.mjs`.
 */

/** APAGADO = no se manda nada; PRUEBA = se manda con `test_event_code`; ACTIVO = se manda de verdad. */
export type ModoConversiones = "APAGADO" | "PRUEBA" | "ACTIVO";

/** Después de tantos intentos con ERROR la venta ya no se reintenta (cuenta como ya enviada). */
export const MAX_INTENTOS = 3;
/** Meta solo acepta eventos de los últimos 7 días. */
export const DIAS_MAXIMOS = 7;
export const LLAVES_CONVERSIONES = ["META_CAPI_ACCESS_TOKEN", "META_CAPI_DATASET_ID", "META_CAPI_WABA_ID"] as const;

const MODOS: ModoConversiones[] = ["APAGADO", "PRUEBA", "ACTIVO"];

/** Lee el modo guardado; cualquier valor que no se reconozca da APAGADO. */
export function leerModo(valor: unknown): ModoConversiones {
  if (typeof valor !== "string") return "APAGADO";
  const limpio = valor.trim().toUpperCase();
  return (MODOS as string[]).includes(limpio) ? (limpio as ModoConversiones) : "APAGADO";
}

export type EventoPurchase = {
  event_name: "Purchase";
  event_time: number;
  action_source: "business_messaging";
  messaging_channel: "whatsapp";
  event_id: string;
  user_data: { whatsapp_business_account_id: string; ctwa_clid: string };
  custom_data: { currency: "COP"; value: number };
};

/** Arma el evento "Purchase" de una venta. `event_id` es la venta, para que Meta no lo cuente dos veces. */
export function armarEventoPurchase(datos: {
  ventaDePautaId: string;
  pagadaEn: Date | string;
  valor: number;
  ctwaClid: string;
  wabaId: string;
}): EventoPurchase {
  return {
    event_name: "Purchase",
    event_time: Math.floor(new Date(datos.pagadaEn).getTime() / 1000),
    action_source: "business_messaging",
    messaging_channel: "whatsapp",
    event_id: datos.ventaDePautaId,
    user_data: { whatsapp_business_account_id: datos.wabaId, ctwa_clid: datos.ctwaClid },
    custom_data: { currency: "COP", value: datos.valor },
  };
}

export type CuerpoConversiones = { data: EventoPurchase[]; test_event_code?: string };

/** El cuerpo que se manda a Meta; `test_event_code` solo va en modo PRUEBA. */
export function armarCuerpo(eventos: EventoPurchase[], modo: ModoConversiones, codigoPrueba?: string | null): CuerpoConversiones {
  const cuerpo: CuerpoConversiones = { data: eventos };
  if (modo === "PRUEBA" && codigoPrueba) cuerpo.test_event_code = codigoPrueba;
  return cuerpo;
}

export type MotivoNoEnvio = "APAGADO" | "NO_ES_PAUTA" | "SIN_CLID" | "SIN_MONTO" | "MUY_VIEJA" | "YA_ENVIADO";
export type DecisionEnvio = { mandar: true } | { mandar: false; motivo: MotivoNoEnvio };

/** Lo que ya quedó guardado en EventoDeConversion para esa venta (null = nunca se intentó). */
export type EnvioAnterior = { estado: string; intentos: number } | null;

/** true si ya se mandó bien, o si ya falló MAX_INTENTOS veces (no se insiste más). */
export function cuentaComoEnviado(anterior: EnvioAnterior | boolean | undefined): boolean {
  if (anterior === true) return true;
  if (!anterior) return false;
  if (anterior.estado === "ENVIADO") return true;
  return anterior.estado === "ERROR" && anterior.intentos >= MAX_INTENTOS;
}

/** Decide si una venta se le avisa a Meta. Si no, dice por qué. */
export function decidirEnvio(datos: {
  venta: { categoria: string; pagadaEn: Date | string };
  ctwaClid: string | null | undefined;
  monto: unknown;
  modo: ModoConversiones;
  yaEnviado: EnvioAnterior | boolean | undefined;
  ahora: Date;
}): DecisionEnvio {
  if (leerModo(datos.modo) === "APAGADO") return { mandar: false, motivo: "APAGADO" };
  if (datos.venta.categoria !== "PAUTA") return { mandar: false, motivo: "NO_ES_PAUTA" };
  if (typeof datos.ctwaClid !== "string" || !datos.ctwaClid.trim()) return { mandar: false, motivo: "SIN_CLID" };
  if (typeof datos.monto !== "number" || !Number.isFinite(datos.monto) || datos.monto <= 0) {
    return { mandar: false, motivo: "SIN_MONTO" };
  }
  const pagada = new Date(datos.venta.pagadaEn).getTime();
  // Una fecha que no se puede leer tampoco se manda: Meta la rechazaría.
  if (!Number.isFinite(pagada) || datos.ahora.getTime() - pagada > DIAS_MAXIMOS * 24 * 60 * 60 * 1000) {
    return { mandar: false, motivo: "MUY_VIEJA" };
  }
  if (cuentaComoEnviado(datos.yaEnviado)) return { mandar: false, motivo: "YA_ENVIADO" };
  return { mandar: true };
}

/** Las llaves de la API de Conversiones que faltan (vacías o sin poner). Nunca devuelve sus valores. */
export function faltanLlaves(env: Record<string, string | undefined>): string[] {
  return LLAVES_CONVERSIONES.filter((llave) => !env[llave]?.trim());
}
