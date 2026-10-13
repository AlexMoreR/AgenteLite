/**
 * RECUPERACIÓN · "En seguimiento ahora" (pedido de Alex, 13-10-2026). Número EN VIVO, no semanal:
 * no cambia con el selector de semana.
 *
 * Definición (la lectura está en servicios/en-seguimiento.ts): chats de las líneas de ventas con
 * algún mensaje en los últimos 30 días, contacto que no está en Ganado ni Perdido, que recibieron al
 * menos un seguimiento automático (`source` "follow" o "agente-v3-seguimiento") DESPUÉS del último
 * mensaje del cliente, y el último de esos seguimientos salió hace 72 h o menos.
 *
 * "Sin respuesta" cuenta MENSAJES automáticos después del último del cliente (un seguimiento con
 * foto y texto cuenta 2), igual que la consulta de referencia con la que se validaron los números.
 */

import type { FichaDelLead } from "./semana";

export const VENTANA_EN_SEGUIMIENTO_MS = 72 * 3_600_000;
export const DIAS_DE_CHATS_ACTIVOS = 30;

export type LeadEnSeguimiento = {
  conversationId: string;
  /** Mensajes automáticos después del último del cliente (≥ 1). */
  sinRespuesta: number;
  ultimoSeguimientoEn: Date;
  /** Tiene un Follow PENDING (el próximo automático ya está programado). */
  programado: boolean;
  ultimoClienteEn: Date | null;
  ficha: FichaDelLead;
};

export type EnSeguimientoAhora = { total: number; uno: number; dos: number; tresOMas: number; programados: number };

export const GRUPOS_EN_SEGUIMIENTO = ["en_seguimiento", "en_seguimiento_1", "en_seguimiento_2", "en_seguimiento_3"] as const;
export type GrupoEnSeguimiento = (typeof GRUPOS_EN_SEGUIMIENTO)[number];

export const NOMBRE_EN_SEGUIMIENTO: Record<GrupoEnSeguimiento, string> = {
  en_seguimiento: "En seguimiento ahora",
  en_seguimiento_1: "1 seguimiento sin respuesta",
  en_seguimiento_2: "2 seguimientos sin respuesta",
  en_seguimiento_3: "3 o más · llegaron al tope",
};

export function resumirEnSeguimiento(leads: ReadonlyArray<Pick<LeadEnSeguimiento, "sinRespuesta" | "programado">>): EnSeguimientoAhora {
  const r: EnSeguimientoAhora = { total: 0, uno: 0, dos: 0, tresOMas: 0, programados: 0 };
  for (const lead of leads) {
    if (lead.sinRespuesta < 1) continue;
    r.total += 1;
    if (lead.sinRespuesta === 1) r.uno += 1;
    else if (lead.sinRespuesta === 2) r.dos += 1;
    else r.tresOMas += 1;
    if (lead.programado) r.programados += 1;
  }
  return r;
}

export function estaEnSeguimiento(lead: Pick<LeadEnSeguimiento, "sinRespuesta">, grupo: GrupoEnSeguimiento): boolean {
  if (lead.sinRespuesta < 1) return false;
  if (grupo === "en_seguimiento_1") return lead.sinRespuesta === 1;
  if (grupo === "en_seguimiento_2") return lead.sinRespuesta === 2;
  if (grupo === "en_seguimiento_3") return lead.sinRespuesta >= 3;
  return true;
}

function hace(ms: number): string {
  const h = ms / 3_600_000;
  if (h < 1) return `${Math.max(1, Math.round(ms / 60_000))} min`;
  return `${Math.round(h)} h`;
}

/** "2 seguimientos sin respuesta · el último hace 5 h · el próximo ya está programado". */
export function razonEnSeguimiento(lead: LeadEnSeguimiento, ahora: Date): string {
  const partes = [
    lead.sinRespuesta === 1 ? "1 seguimiento sin respuesta" : `${lead.sinRespuesta} seguimientos sin respuesta`,
    `el último hace ${hace(Math.max(0, ahora.getTime() - lead.ultimoSeguimientoEn.getTime()))}`,
  ];
  if (lead.programado) partes.push("el próximo ya está programado");
  return partes.join(" · ");
}

/** Los del grupo, el seguimiento más reciente primero. */
export function leadsEnSeguimiento(leads: ReadonlyArray<LeadEnSeguimiento>, grupo: GrupoEnSeguimiento): LeadEnSeguimiento[] {
  return leads.filter((lead) => estaEnSeguimiento(lead, grupo)).sort((a, b) => b.ultimoSeguimientoEn.getTime() - a.ultimoSeguimientoEn.getTime());
}
