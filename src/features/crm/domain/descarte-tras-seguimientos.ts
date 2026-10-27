import { detectarSenales, type TipoDeSenal } from "../../embudo/dominio/senales";

/**
 * DESCARTE TRAS SEGUIMIENTOS (decisión del dueño, 26-10-2026): el bot hace los seguimientos y el CRM
 * descarta solo a quien nunca contesta. Código puro, sin base: lo prueba
 * `npm run test:descarte-tras-seguimientos`.
 *
 * La regla: el seguimiento de 3 días del paso Bienvenida salió, pasaron 24 h y el cliente no escribió
 * nada (ni una asesora le escribió a mano).
 *  - Sin señal de compra: pasa a Descartado con el motivo "Sin respuesta".
 *  - Con señal de compra (o cotización o anticipo): NO se descarta; va a la lista LLAMAR de su
 *    asesora para UNA llamada. Si después no avanza, la asesora lo descarta.
 *  - Si el cliente escribe después de descartarlo, se reabre en la etapa en que estaba.
 */

/** Horas de espera después del seguimiento de 3 días. */
export const HORAS_DE_ESPERA = 24;
/** Lo que el cliente escribe en sus primeros minutos es el texto automático del anuncio: no es señal. */
export const MINUTOS_DEL_TEXTO_DEL_ANUNCIO = 2;
/** Tope de leads por vuelta (el cron corre cada 10 minutos). */
export const TOPE_POR_VUELTA = 50;
export const MOTIVO_SIN_RESPUESTA = "sin_respuesta";
export const ETIQUETA_LLAMAR = { slug: "llamar", name: "LLAMAR", color: "#dc2626" };
export const NOTA_LLAMAR = "Llámalo una vez; si no avanza, descártalo tú.";
export const NOTA_REABRE = "Volvió a escribir: se reabre.";
/** Marca en el historial de etapas y en las notas, para encontrar lo que hizo esta regla. */
export const NOTA_HISTORIAL_DESCARTE = "descarte tras seguimientos";
export const ORIGEN_NOTA = "descarte-tras-seguimientos";

const ETAPAS_CERRADAS = new Set(["GANADO", "PERDIDO"]);
const ETAPAS_QUE_NO_SE_DESCARTAN_SOLAS = new Set(["NEGOCIACION"]);

/** Señales que dicen "tiene ganas de comprar": precio, envío o ciudad, pago, cotización, anticipo... */
const SENALES_DE_COMPRA = new Set<TipoDeSenal>([
  "precio",
  "envio_ciudad",
  "forma_pago",
  "anticipo_pago",
  "pide_cotizacion",
  "acepta_precio",
  "separar",
  "direccion_fecha",
  "comprobante",
  "decision_proxima",
]);

export type MensajeDelCliente = { texto: string | null; creadoEn: Date };

export type HechosDelLead = {
  etapa: string;
  /** Cuándo salió el seguimiento de 3 días. */
  enviadoEn: Date;
  ahora: Date;
  /** El cliente escribió algo después del seguimiento. */
  escribioDespues: boolean;
  /** Una asesora le escribió a mano después del seguimiento. */
  asesoraEscribioDespues: boolean;
  /** Todo lo que ha escrito el cliente, para buscar señales de compra. */
  mensajesDelCliente: MensajeDelCliente[];
  /** Cotización en curso o anticipo (el candado de hoy lo protege). */
  conCotizacionOAnticipo: boolean;
};

export type Decision = "descartar" | "llamar" | "nada";

/** ¿Alguno de sus mensajes (fuera de los primeros 2 minutos) muestra ganas de comprar? */
export function tieneSenalDeCompra(mensajes: MensajeDelCliente[]): boolean {
  if (mensajes.length === 0) return false;
  const primero = Math.min(...mensajes.map((m) => m.creadoEn.getTime()));
  const desde = primero + MINUTOS_DEL_TEXTO_DEL_ANUNCIO * 60_000;
  return mensajes.some(
    (m) => m.creadoEn.getTime() > desde && detectarSenales(m.texto).some((s) => SENALES_DE_COMPRA.has(s.tipo)),
  );
}

export function decidir(h: HechosDelLead): Decision {
  if (ETAPAS_CERRADAS.has(h.etapa)) return "nada";
  if (h.escribioDespues || h.asesoraEscribioDespues) return "nada";
  if (h.ahora.getTime() - h.enviadoEn.getTime() < HORAS_DE_ESPERA * 3_600_000) return "nada";
  if (h.conCotizacionOAnticipo || ETAPAS_QUE_NO_SE_DESCARTAN_SOLAS.has(h.etapa) || tieneSenalDeCompra(h.mensajesDelCliente)) {
    return "llamar";
  }
  return "descartar";
}

/* ---------- La vuelta (con la base inyectada, para probarla sin base) ---------- */

export type Candidato = { contactId: string; etapa: string; enviadoEn: Date };

export type Puerto = {
  encendido(): Promise<boolean>;
  /** Leads con el seguimiento de 3 días enviado hace 24 h o más, sin respuesta ni asesora, abiertos y sin LLAMAR. */
  buscarCandidatos(limite: number): Promise<Candidato[]>;
  hechos(candidato: Candidato): Promise<HechosDelLead>;
  descartar(candidato: Candidato): Promise<boolean>;
  ponerLlamar(candidato: Candidato): Promise<boolean>;
  /** Descartados por esta regla cuyo cliente escribió después. Devuelve cuántos reabrió. */
  reabrir(limite: number): Promise<number>;
};

export type ResultadoDeVuelta = { descartados: number; aLlamar: number; reabiertos: number; revisados: number };

export async function correrVuelta(puerto: Puerto): Promise<ResultadoDeVuelta> {
  const resultado: ResultadoDeVuelta = { descartados: 0, aLlamar: 0, reabiertos: 0, revisados: 0 };
  if (!(await puerto.encendido())) return resultado;

  resultado.reabiertos = await puerto.reabrir(TOPE_POR_VUELTA);

  const candidatos = await puerto.buscarCandidatos(TOPE_POR_VUELTA);
  for (const candidato of candidatos.slice(0, TOPE_POR_VUELTA)) {
    resultado.revisados += 1;
    // Los hechos se leen justo antes de actuar: si el cliente escribió entre la búsqueda y ahora, no pasa nada.
    const decision = decidir(await puerto.hechos(candidato));
    if (decision === "descartar" && (await puerto.descartar(candidato))) resultado.descartados += 1;
    if (decision === "llamar" && (await puerto.ponerLlamar(candidato))) resultado.aLlamar += 1;
  }
  return resultado;
}
