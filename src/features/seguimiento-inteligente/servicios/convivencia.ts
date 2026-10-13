import { prisma } from "@/lib/prisma";

import { leerMarcaExterior } from "../dominio/exterior";
import { esExcepcionQueActua, excepcionesQueActuan, type ConfigSeguimientoInteligente } from "../dominio/config";
import { evaluarLead } from "../dominio/motor";
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
 * SOLO EXCEPCIONES (motor en sombra + `motor.excepcionesActivas`, Alexander 13-10-2026): devuelve
 * null para TODOS los leads (como la sombra), salvo cuando el lead tiene de verdad una TAREA HUMANA
 * ACTIVA de formulario o cotización: la decisión guardada es `tarea_asesora` en activo de esas reglas
 * Y, decidida otra vez en este instante (mensajes de ahora), lo sigue siendo. Mientras el escalón no
 * vence ("esperar") o si una persona ya escribió, el automático sale como siempre. Nunca reemplaza
 * (no hay mensaje útil) ni frena por Caliente / Tibio / dormido / cadencia / descarte / recuperación.
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
  /** Motivo de la decisión: la Recuperación 72 h nunca frena un genérico. */
  motivo?: string | null;
  motor: "v3" | "follow";
  reglaId?: string | null;
  nombre?: string | null;
  convivencia: { reemplazarGenericosEnFrios: boolean; reglasV3: string[]; followsDeEtapa: boolean };
  /** Motor en sombra con excepciones (formulario / cotización): solo frena su tarea humana activa. */
  soloExcepciones?: boolean;
  /** El motivo de la decisión es de una excepción que actúa. */
  esExcepcion?: boolean;
}): MotivoDeConvivencia | null {
  if ((input.nombre ?? "").startsWith(PREFIJO_FOLLOW_INTELIGENTE)) return null;
  if (input.exteriorActivo && input.esExterior) return "fuera_de_colombia";
  if (!input.motorActivo || !input.accion) return null;
  if (input.motivo === "recuperacion_72h") return null;
  if (input.soloExcepciones) {
    return input.esExcepcion && input.accion === "tarea_asesora" ? "inteligente_tarea_humana" : null;
  }
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

/** La decisión del motor en este instante (sin efectos). Null si no se pudo leer (se usa la guardada). */
async function decisionEnVivo(conversationId: string, config: ConfigSeguimientoInteligente): Promise<{ accion: string; supresion: string; motivo: string } | null> {
  try {
    // Import dinámico: ficha.ts lee el estado del agente V3, que a su vez importa esta convivencia.
    const { leerFicha, leerNotasDelTurno } = await import("./ficha");
    const ctx = await leerFicha(conversationId);
    if (!ctx) return null;
    ctx.ficha.notas = await leerNotasDelTurno(conversationId).catch(() => []);
    const { decision } = evaluarLead(ctx.ficha, config, new Date());
    return { accion: decision.accion, supresion: decision.supresion, motivo: decision.motivo };
  } catch {
    return null;
  }
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
    const soloExcepciones = !motorActivo && excepcionesQueActuan(config).length > 0;
    if (!motorActivo && !soloExcepciones && !config.exterior.activo) return null;
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
    const datos = (lead?.accionDatos ?? null) as { supresion?: unknown; modo?: unknown; motivo?: unknown } | null;
    // Solo cuenta una decisión tomada en modo activo (una de sombra no frena nada).
    const activa = datos?.modo === "activo";
    // TURNO DE LA CONVERSACIÓN (interruptor `turno:config`): la decisión guardada puede ser de ANTES
    // de que el bot respondiera (se toma cuando llega el mensaje del cliente: "tibio esperando" →
    // frena todo). Con el turno prendido se vuelve a decidir AHORA, con los mensajes y notas de
    // este momento (sin efectos: no guarda ni manda nada). Si es turno del cliente, el motor dice
    // "esperar / ninguna" y el automático sale; las excepciones (caliente, formulario, cotización,
    // fecha cercana, "ya pagué") siguen frenando como hoy.
    // SOLO EXCEPCIONES: únicamente si lo guardado es una tarea activa de formulario / cotización se
    // vuelve a decidir AHORA (si ya no lo es, el automático sale). Para el resto ni se lee la ficha.
    const guardadaEsTareaDeExcepcion =
      soloExcepciones && activa && lead?.accion === "tarea_asesora" && esExcepcionQueActua(typeof datos?.motivo === "string" ? datos.motivo : null, config);
    const enVivo =
      conversationId && ((config.turno?.activo && motorActivo && activa) || guardadaEsTareaDeExcepcion) ? await decisionEnVivo(conversationId, config) : null;
    const motivo = enVivo ? enVivo.motivo : typeof datos?.motivo === "string" ? datos.motivo : null;
    return decidirConvivencia({
      motorActivo: (motorActivo || soloExcepciones) && activa,
      soloExcepciones,
      esExcepcion: esExcepcionQueActua(motivo, config),
      exteriorActivo: config.exterior.activo,
      esExterior: Boolean(lead?.exterior) || Boolean(leerMarcaExterior(contacto?.metadata)),
      accion: enVivo ? enVivo.accion : (lead?.accion ?? null),
      supresion: enVivo ? enVivo.supresion : typeof datos?.supresion === "string" ? datos.supresion : null,
      motivo,
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
