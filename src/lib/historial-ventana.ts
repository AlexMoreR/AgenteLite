/**
 * Cuánto historial de WhatsApp se trae al CRM.
 *
 * Decisión de Alex (21-sep-2026): por defecto los últimos 15 días, y como mucho 30 si alguien pide
 * estirarlo. No es una limitación técnica: es que traer años de WhatsApp llena el CRM de charlas
 * muertas -y de leads que ya no existen- y ensucia justo lo que el equipo tiene que mirar hoy.
 *
 * Un número acotado además protege al gateway: pedirle miles de mensajes de golpe es lo que ya una
 * vez dejó los ENVÍOS fallando de forma intermitente.
 */

export const DIAS_DE_HISTORIAL_POR_DEFECTO = 15;
export const DIAS_DE_HISTORIAL_MAXIMO = 30;

/** Desde cuándo se trae, en milisegundos. Acota el pedido a un rango, no a una cantidad. */
export function desdeCuandoTraerHistorial(dias?: number | null): Date {
  const pedidos = typeof dias === "number" && Number.isFinite(dias) ? Math.round(dias) : DIAS_DE_HISTORIAL_POR_DEFECTO;
  const acotados = Math.min(Math.max(pedidos, 1), DIAS_DE_HISTORIAL_MAXIMO);
  return new Date(Date.now() - acotados * 24 * 60 * 60 * 1000);
}
