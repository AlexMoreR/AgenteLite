/**
 * SEGUIMIENTOS AUTOMÁTICOS QUE SE APAGAN SOLOS (tarjeta prioridad 1 del dueño, 28-10-2026).
 *
 * Caso real: una clienta de Yair ya había dicho que sí (iba a pagar y venía a Cali) y el robot le siguió
 * mandando "¡Hola! ¿Pudiste ver lo que te envié?" ("Tras asesora: 1 h" y "24 h"). Código puro, sin base:
 * lo prueba `npm run test:seguimientos-apagados`.
 *
 * Un seguimiento AUTOMÁTICO (el de un paso del embudo, el de un producto, el reloj V3, "Tras asesora",
 * "Inteligente") no sale, y los pendientes del contacto se cancelan, cuando:
 *  - el interruptor "Seguimientos automáticos" de ese chat está apagado (lo apaga la asesora);
 *  - el chat está en una etapa de venta o cierre del CRM (Negociación, Ganado);
 *  - el cliente ya confirmó la compra o el pago. Regla CONSERVADORA: es preferible dejar pasar un falso
 *    negativo que apagarle los seguimientos a quien no confirmó. Un "sí" suelto solo cuenta si lo último que
 *    dijo el negocio fue una pregunta de cierre o de pago;
 *  - (solo los del paso del embudo / de un producto) una asesora le escribió a mano en las últimas 24 h;
 *  - (solo "Tras asesora") la última frase de la asesora promete enviar algo o pide esperar ("deme un
 *    momento y te envío todo"): quien tiene que responder es ella, no el cliente. Los "Tras asesora" nacen
 *    justamente porque la asesora escribió, así que "asesora escribió" no los frena.
 * No cambia ningún texto ni manda nada: solo deja de mandar.
 */

import { esMensajeHumano } from "../../../lib/anti-bloqueo/reglas";
import { asesoraPrometio, PREFIJO_FOLLOW_TRAS_ASESORA } from "../../seguimiento-inteligente/dominio/tras-asesora";
import { clienteConfirmoCompra, ETAPAS_DE_VENTA, type MensajeDelChat } from "./confirmacion-de-compra";

export { clienteConfirmoCompra, ETAPAS_DE_VENTA, DIAS_CONFIRMACION_VIGENTE, type MensajeDelChat } from "./confirmacion-de-compra";

export const HORAS_ASESORA_ESCRIBIO = 24;

export type TipoDeSeguimiento = "embudo" | "tras_asesora" | "otro";

/** De qué clase es un Follow automático, por su nombre o su regla (ver lib/anti-bloqueo clasificarFollow). */
export function tipoDeSeguimiento(follow: { name: string | null; followRuleId: string | null }): TipoDeSeguimiento {
  const nombre = (follow.name ?? "").trim();
  if (nombre.startsWith(PREFIJO_FOLLOW_TRAS_ASESORA)) return "tras_asesora";
  if (follow.followRuleId || nombre.startsWith("Etapa ") || nombre.startsWith("Sin responder")) return "embudo";
  return "otro";
}

export type CodigoDeApagado = "interruptor" | "etapa_de_venta" | "cliente_confirmo" | "asesora_prometio" | "asesora_escribio";
export type MotivoDeApagado = { codigo: CodigoDeApagado; texto: string };

export type HechosDeApagado = {
  tipo: TipoDeSeguimiento;
  /** `Contact.crmStage`. */
  etapaCrm: string | null;
  /** `Conversation.seguimientosApagados`. */
  interruptorApagado: boolean;
  mensajes: MensajeDelChat[];
  inicioDeLaCharla: Date | null;
  ahora: Date;
};

/** Null = el seguimiento puede seguir su camino (lo demás lo deciden las medidas de siempre). */
export function decidirApagado(h: HechosDeApagado): MotivoDeApagado | null {
  if (h.interruptorApagado) {
    return { codigo: "interruptor", texto: "los apagó la asesora en este chat" };
  }
  const etapa = h.etapaCrm ? ETAPAS_DE_VENTA[h.etapaCrm] : undefined;
  if (etapa) {
    return { codigo: "etapa_de_venta", texto: `el chat está en etapa de venta (${etapa})` };
  }
  if (clienteConfirmoCompra(h.mensajes, h.ahora)) {
    return { codigo: "cliente_confirmo", texto: "el cliente confirmó la compra o el pago" };
  }
  const esHumano = (m: MensajeDelChat) => m.direccion === "OUT" && esMensajeHumano({ createdAt: m.en, origen: m.origen }, h.inicioDeLaCharla);
  const delaAsesora = h.mensajes.filter((m) => m.tipo !== "SYSTEM" && m.en.getTime() <= h.ahora.getTime() && esHumano(m));
  if (h.tipo === "tras_asesora") {
    const ultima = delaAsesora[delaAsesora.length - 1];
    if (ultima && asesoraPrometio(ultima.texto)) {
      return { codigo: "asesora_prometio", texto: "la asesora quedó de enviarle algo al cliente (le toca a ella responder)" };
    }
  }
  if (h.tipo === "embudo") {
    const desde = h.ahora.getTime() - HORAS_ASESORA_ESCRIBIO * 3_600_000;
    if (delaAsesora.some((m) => m.en.getTime() >= desde)) {
      return { codigo: "asesora_escribio", texto: "la asesora le escribió a mano en las últimas 24 h" };
    }
  }
  return null;
}
