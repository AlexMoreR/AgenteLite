import { prisma } from "@/lib/prisma";

import { leerMarcaExterior } from "../dominio/exterior";
import { leerConfigSeguimiento } from "./config";

/**
 * CONVIVENCIA con los seguimientos de hoy (V3 "si no responde" y motor Follow).
 *
 * Con el motor ACTIVO, los genéricos no se suman encima de lo que decide el motor:
 *  - lead con tarea humana, Caliente, dormido por fecha, en cadencia, "no insistir" o descartado
 *    → no sale ningún genérico (motivo `inteligente_tarea_humana` / `inteligente_no_insistir`);
 *  - Frío que maneja el motor → el genérico se REEMPLAZA por el mensaje útil, si la convivencia lo
 *    dice (`reemplazarGenericosEnFrios`, reglas del V3 elegidas y/o seguimientos de etapa);
 *  - teléfono fuera de Colombia (interruptor `exterior`) → nada (motivo `fuera_de_colombia`).
 * Los mensajes que agenda el propio motor (nombre "Inteligente: …") nunca se frenan acá.
 *
 * Con todo apagado devuelve null en una lectura de configuración en memoria: no cambia nada.
 */

export const PREFIJO_FOLLOW_INTELIGENTE = "Inteligente: ";

export type MotivoDeConvivencia = "fuera_de_colombia" | "inteligente_tarea_humana" | "inteligente_no_insistir" | "inteligente_reemplazado";

/** La regla pura: con la foto del lead y la config, ¿se frena este genérico? */
export function decidirConvivencia(input: {
  motorActivo: boolean;
  exteriorActivo: boolean;
  esExterior: boolean;
  accion: string | null;
  supresion: string | null;
  motor: "v3" | "follow";
  reglaId?: string | null;
  nombre?: string | null;
  convivencia: { reemplazarGenericosEnFrios: boolean; reglasV3: string[]; followsDeEtapa: boolean };
}): MotivoDeConvivencia | null {
  if ((input.nombre ?? "").startsWith(PREFIJO_FOLLOW_INTELIGENTE)) return null;
  if (input.exteriorActivo && input.esExterior) return "fuera_de_colombia";
  if (!input.motorActivo || !input.accion) return null;
  if (input.supresion === "siempre" || input.accion === "tarea_asesora" || input.accion === "dormido" || input.accion === "descartar") {
    return input.accion === "no_insistir" ? "inteligente_no_insistir" : "inteligente_tarea_humana";
  }
  if (input.supresion === "reemplazo" && input.convivencia.reemplazarGenericosEnFrios) {
    if (input.motor === "v3") {
      const reglas = input.convivencia.reglasV3;
      return reglas.length === 0 || (input.reglaId && reglas.includes(input.reglaId)) ? "inteligente_reemplazado" : null;
    }
    return input.convivencia.followsDeEtapa && (input.nombre ?? "").startsWith("Etapa ") ? "inteligente_reemplazado" : null;
  }
  return null;
}

/** ¿Se frena este seguimiento genérico? Null = sale como siempre. Nunca lanza (ante error, null). */
export async function revisarConvivencia(input: {
  workspaceId: string;
  conversationId?: string | null;
  contactId: string;
  channelId?: string | null;
  motor: "v3" | "follow";
  reglaId?: string | null;
  nombre?: string | null;
}): Promise<MotivoDeConvivencia | null> {
  try {
    if ((input.nombre ?? "").startsWith(PREFIJO_FOLLOW_INTELIGENTE)) return null;
    const config = await leerConfigSeguimiento(input.workspaceId);
    const motorActivo = config.motor.modo === "activo";
    if (!motorActivo && !config.exterior.activo) return null;
    const conversationId =
      input.conversationId ??
      (
        await prisma.conversation.findFirst({
          where: { workspaceId: input.workspaceId, contactId: input.contactId, ...(input.channelId ? { channelId: input.channelId } : {}) },
          orderBy: { lastMessageAt: "desc" },
          select: { id: true },
        })
      )?.id ??
      null;
    const [lead, contacto] = await Promise.all([
      conversationId ? prisma.embudoLead.findUnique({ where: { conversationId }, select: { accion: true, accionDatos: true, exterior: true } }) : null,
      config.exterior.activo ? prisma.contact.findUnique({ where: { id: input.contactId }, select: { metadata: true } }) : null,
    ]);
    const datos = (lead?.accionDatos ?? null) as { supresion?: unknown; modo?: unknown } | null;
    // Solo cuenta una decisión tomada en modo activo (una de sombra no frena nada).
    const activa = datos?.modo === "activo";
    return decidirConvivencia({
      motorActivo: motorActivo && activa,
      exteriorActivo: config.exterior.activo,
      esExterior: Boolean(lead?.exterior) || Boolean(leerMarcaExterior(contacto?.metadata)),
      accion: lead?.accion ?? null,
      supresion: typeof datos?.supresion === "string" ? datos.supresion : null,
      motor: input.motor,
      reglaId: input.reglaId,
      nombre: input.nombre,
      convivencia: config.convivencia,
    });
  } catch (error) {
    console.warn("[seguimiento-inteligente] fallo la convivencia; el seguimiento sale como antes", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
