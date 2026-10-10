import { Prisma } from "@prisma/client";

import { avisoSiNoSePuedeDescartar } from "@/features/crm/services/candado-descarte-sin-respuesta";
import type { EventoDelEmbudo } from "@/features/embudo/dominio/eventos";
import { enSegundoPlano, registrarEventos } from "@/features/embudo/servicios/eventos";
import { cancelarAutomaticosPendientesDelContacto, createFollow } from "@/features/seguimientos/services/follows";
import { getFlowReply } from "@/lib/agent-product-flow";
import { recordConversationActivity } from "@/lib/conversation-activity";
import { prisma } from "@/lib/prisma";

import { algoPrendido, type ConfigSeguimientoInteligente } from "../dominio/config";
import { evaluarLead, type Decision, type Evaluacion } from "../dominio/motor";
import { textoPermitido } from "../dominio/producto";
import { PREFIJO_FOLLOW_INTELIGENTE } from "./convivencia";
import { leerConfigSeguimiento, negociosConSeguimiento } from "./config";
import { leerFicha, type FichaConContexto } from "./ficha";
import { aplicarTopeDeTareas } from "./tope";

/**
 * EL MOTOR EN VIVO del seguimiento inteligente.
 *
 * - En cada mensaje del cliente (webhook) y en el barrido del reloj, mira el lead, lo califica (F2)
 *   y decide la siguiente acción con la regla pura de dominio/motor.ts.
 * - Registra en el embudo: TEMPERATURA (si cambió) y SIGUIENTE_ACCION (si cambió la decisión).
 * - Modo "sombra": solo registra lo que HARÍA. Modo "activo": agenda el mensaje útil (pasa por el
 *   motor de seguimientos, o sea por el anti-bloqueo y el freno de siempre) y deja la tarea visible
 *   en Mi día y en el Supervisor. Nunca le escribe al cliente directamente.
 * - Nada de esto lanza ni demora la respuesta al cliente.
 */

function anotarError(donde: string, error: unknown, extra: Record<string, unknown> = {}) {
  console.warn(`[seguimiento-inteligente] ${donde}`, { ...extra, error: error instanceof Error ? error.message : String(error) });
}

function modoDe(decision: Decision, config: ConfigSeguimientoInteligente): "sombra" | "activo" | "apagado" {
  if (decision.accion === "excluir_exterior") return config.exterior.activo ? "activo" : "apagado";
  if (decision.accion === "descartar") return config.cadencia.descarte;
  return config.motor.modo;
}

function datosDeLaDecision(decision: Decision, evaluacion: Evaluacion, modo: string): Record<string, unknown> {
  return {
    accion: decision.accion,
    motivo: decision.motivo,
    modo,
    prioridad: decision.prioridad,
    vence: decision.vence?.toISOString() ?? null,
    mensajeSugerido: decision.mensajeSugerido,
    mensajeUtil: decision.mensajeUtil ? { familia: decision.mensajeUtil.familia, resumen: decision.mensajeUtil.resumen } : null,
    programarPara: decision.programarPara?.toISOString() ?? null,
    supresion: decision.supresion,
    dormidoHasta: decision.dormidoHasta?.toISOString() ?? null,
    fechaCompra: decision.fechaCompra?.fecha.toISOString() ?? null,
    fechaComo: decision.fechaCompra?.como ?? null,
    fechaFragmento: decision.fechaCompra?.fragmento ?? null,
    toque: decision.toque,
    temperatura: evaluacion.calificacion.temperatura,
    temperaturaBase: evaluacion.calificacion.temperaturaBase,
    producto: evaluacion.familia,
    clave: decision.clave,
  };
}

/** Un flujo con "contraentrega" o "envío gratis" no sale como automático (política vigente). */
async function flujoPermitido(workspaceId: string, flowId: string): Promise<boolean> {
  const flujo = await getFlowReply({ workspaceId, flowId, includeOfficialApi: false }).catch(() => null);
  if (!flujo) return false;
  return flujo.steps.every((paso) => {
    const texto = paso.kind === "text" ? paso.content : "caption" in paso ? paso.caption ?? "" : "";
    return textoPermitido(texto ?? "");
  });
}

async function agendarMensajeUtil(ctx: FichaConContexto, decision: Decision): Promise<boolean> {
  const util = decision.mensajeUtil;
  if (!util) return false;
  for (const accion of util.acciones) {
    if (accion.flowId && !(await flujoPermitido(ctx.workspaceId, accion.flowId))) {
      anotarError("flujo no permitido para el mensaje util", null, { flowId: accion.flowId });
      return false;
    }
  }
  // Uno solo pendiente por contacto: si ya hay uno del motor esperando, no se agenda otro.
  const yaHay = await prisma.follow.count({
    where: { workspaceId: ctx.workspaceId, contactId: ctx.contactId, status: "PENDING", name: { startsWith: PREFIJO_FOLLOW_INTELIGENTE } },
  });
  if (yaHay > 0) return false;
  const primera = util.acciones[0];
  await createFollow({
    workspaceId: ctx.workspaceId,
    contactId: ctx.contactId,
    channelId: ctx.channelId,
    name: `${PREFIJO_FOLLOW_INTELIGENTE}${util.familia}${decision.toque ? ` · ${decision.toque}` : ""}`,
    timeType: "MINUTES",
    timeValue: 0,
    executeAt: decision.programarPara ?? new Date(),
    messageType: primera.messageType,
    content: primera.content,
    mediaUrl: primera.mediaUrl ?? null,
    actions: util.acciones.map((accion, order) => ({
      order,
      messageType: accion.messageType,
      content: accion.content,
      mediaUrl: accion.mediaUrl ?? null,
      flowId: accion.flowId ?? null,
    })),
    cancelOnActivity: true,
  });
  return true;
}

export const MOTIVO_DESCARTE_CADENCIA = "sin_respuesta";

/**
 * Descarte por la cadencia: PERDIDO con motivo "Sin respuesta", por la misma puerta y con la misma
 * nota que el descarte automático del CRM (sin autor, a la vista). Respeta el candado de la
 * cotización y no pisa un GANADO/PERDIDO. No le escribe nada al cliente.
 */
async function descartarPorCadencia(ctx: FichaConContexto, dias: number[]): Promise<boolean> {
  const aviso = await avisoSiNoSePuedeDescartar({ contactId: ctx.contactId, lostReason: MOTIVO_DESCARTE_CADENCIA }).catch(
    (error) => `no se pudo revisar el candado: ${error instanceof Error ? error.message : String(error)}`,
  );
  if (aviso) {
    console.log("[seguimiento-inteligente] descarte frenado por el candado", { conversationId: ctx.ficha.conversationId, aviso: aviso.slice(0, 200) });
    return false;
  }
  const movidos = await prisma.$executeRaw(Prisma.sql`
    UPDATE "Contact"
    SET "crmStage" = 'PERDIDO', "lostReason" = ${MOTIVO_DESCARTE_CADENCIA}, "wonAt" = NULL, "wonQuoteRef" = NULL, "updatedAt" = NOW()
    WHERE "id" = ${ctx.contactId} AND "crmStage"::text NOT IN ('GANADO', 'PERDIDO')
  `);
  if (movidos === 0) return false;
  await recordConversationActivity({
    workspaceId: ctx.workspaceId,
    conversationId: ctx.ficha.conversationId,
    channelId: ctx.channelId,
    contactId: ctx.contactId,
    kind: "stage_changed",
    actorUserId: null,
    origen: "seguimiento-inteligente",
    text: `Descartado automáticamente: sin respuesta tras 3 seguimientos (días ${dias.join(", ")} después de la asesora). Motivo: Sin respuesta.`,
  }).catch((error) => anotarError("no se pudo dejar la nota del descarte", error));
  await cancelarAutomaticosPendientesDelContacto({ workspaceId: ctx.workspaceId, contactId: ctx.contactId, motivo: "etapa_cerrada" });
  return true;
}

/**
 * Mira un lead: califica, decide, registra y (en modo activo) ejecuta. Nunca lanza.
 * Devuelve la evaluación (para pruebas y para el barrido).
 */
export async function revisarLead(conversationId: string, opciones: { ahora?: Date } = {}): Promise<Evaluacion | null> {
  try {
    const ctx = await leerFicha(conversationId);
    if (!ctx) return null;
    const config = await leerConfigSeguimiento(ctx.workspaceId);
    if (!algoPrendido(config)) return null;
    const ahora = opciones.ahora ?? new Date();
    const evaluacion = evaluarLead(ctx.ficha, config, ahora);
    const { calificacion, decision } = evaluacion;
    const eventos: EventoDelEmbudo[] = [];

    if (config.calificacion.activo || config.motor.modo !== "apagado") {
      const cambio =
        ctx.lead?.temperatura !== calificacion.temperatura ||
        ctx.lead?.puntaje !== calificacion.puntaje ||
        (ctx.lead?.productoInteres ?? null) !== evaluacion.familia;
      if (cambio) {
        eventos.push({
          tipo: "TEMPERATURA",
          origen: "motor",
          producto: null,
          createdAt: ahora,
          datos: {
            temperatura: calificacion.temperatura,
            puntaje: calificacion.puntaje,
            puntajeBase: calificacion.puntajeBase,
            motivo: calificacion.motivo,
            productoInteres: evaluacion.familia,
            senales: calificacion.senales.slice(0, 6).map((s) => ({ tipo: s.tipo, fragmento: s.fragmento.slice(0, 80) })),
          },
        });
      }
    }

    const modoPropio = modoDe(decision, config);
    // Un descarte con su interruptor apagado se anota igual con el modo del motor (si está en sombra).
    const modo = modoPropio === "apagado" && decision.accion === "descartar" ? "apagado" : modoPropio;
    const registrarDecision = modo !== "apagado" || (config.motor.modo !== "apagado" && decision.accion === "descartar");
    const modoAnotado = modo === "apagado" ? config.motor.modo : modo;
    // Nueva si cambió la decisión o el modo (al pasar de sombra a activo se vuelve a registrar y ejecutar).
    const decisionNueva =
      registrarDecision && (ctx.lead?.accionDatos?.clave !== decision.clave || ctx.lead?.accionDatos?.modo !== modoAnotado);
    if (decisionNueva) {
      eventos.push({ tipo: "SIGUIENTE_ACCION", origen: "motor", createdAt: ahora, datos: datosDeLaDecision(decision, evaluacion, modoAnotado) });
    }
    if (decision.accion === "excluir_exterior" && config.exterior.activo && !ctx.lead?.exterior) {
      eventos.push({ tipo: "EXTERIOR", origen: "motor", claveUnica: `EXTERIOR:${conversationId}`, createdAt: ahora, datos: { pais: ctx.ficha.pais } });
    }

    // Ejecutar (solo en modo activo y solo cuando la decisión es nueva: así no se repite).
    if (decisionNueva && modo === "activo" && decision.accion === "mensaje_util_producto") {
      const agendado = await agendarMensajeUtil(ctx, decision).catch((error) => {
        anotarError("no se pudo agendar el mensaje util", error, { conversationId });
        return false;
      });
      if (agendado) eventos.push({ tipo: "MENSAJE_UTIL", origen: "motor", createdAt: ahora, datos: { familia: decision.mensajeUtil?.familia, toque: decision.toque } });
    }
    if (decision.accion === "descartar" && modo !== "apagado") {
      if (modo === "activo") {
        const hecho = await descartarPorCadencia(ctx, config.cadencia.dias).catch((error) => {
          anotarError("no se pudo descartar", error, { conversationId });
          return false;
        });
        if (hecho) eventos.push({ tipo: "DESCARTE_CADENCIA", origen: "motor", claveUnica: `DESCARTE:${conversationId}:${ahora.toISOString().slice(0, 10)}`, createdAt: ahora, datos: { modo } });
      } else {
        eventos.push({ tipo: "DESCARTE_CADENCIA", origen: "motor", claveUnica: `DESCARTE-SOMBRA:${conversationId}`, createdAt: ahora, datos: { modo, habriaDescartado: true } });
      }
    }

    if (eventos.length) {
      await registrarEventos({ workspaceId: ctx.workspaceId, conversationId, contactId: ctx.contactId, channelId: ctx.channelId }, eventos);
    }
    await prisma.embudoLead.updateMany({ where: { conversationId }, data: { revisarEn: decision.revisarEn } }).catch(() => undefined);
    return evaluacion;
  } catch (error) {
    anotarError("no se pudo revisar el lead", error, { conversationId });
    return null;
  }
}

/** Desde el webhook, al llegar un mensaje del cliente: en segundo plano, sin demorar nada. */
export function revisarLeadAlEscribir(input: { workspaceId: string; conversationId: string }): void {
  if (!input.workspaceId || !input.conversationId) return;
  enSegundoPlano(async () => {
    const config = await leerConfigSeguimiento(input.workspaceId);
    if (!algoPrendido(config)) return;
    await revisarLead(input.conversationId);
  });
}

let barriendo = false;
const POR_VUELTA = 60;

/**
 * EL BARRIDO (reloj de cada minuto): los leads a los que les toca revisión (`revisarEn` vencido o
 * nunca revisados), de a 60 por negocio. Así cae la temperatura por silencio, vencen las tareas,
 * salen los mensajes útiles y avanza la cadencia aunque el cliente no escriba.
 */
export async function barrerSeguimientoInteligente(ahora = new Date()): Promise<{ negocios: number; revisados: number }> {
  if (barriendo) return { negocios: 0, revisados: 0 };
  barriendo = true;
  try {
    const negocios = await negociosConSeguimiento();
    let revisados = 0;
    for (const workspaceId of negocios) {
      const config = await leerConfigSeguimiento(workspaceId);
      const ventanaDias = Math.max(config.motor.diasDeSeguimiento, Math.max(...config.cadencia.dias) + config.cadencia.horasDeGracia / 24 + 3, config.cotizacion.diasVigente);
      const leads = await prisma.embudoLead.findMany({
        where: {
          workspaceId,
          exterior: false,
          OR: [{ revisarEn: null }, { revisarEn: { lte: ahora } }],
          AND: [{ OR: [{ ultimoClienteEn: { gte: new Date(ahora.getTime() - ventanaDias * 86_400_000) } }, { dormidoHasta: { not: null } }] }],
        },
        orderBy: { revisarEn: { sort: "asc", nulls: "first" } },
        take: POR_VUELTA,
        select: { conversationId: true },
      });
      for (const lead of leads) {
        await revisarLead(lead.conversationId, { ahora });
        revisados += 1;
      }
      // Tope de tareas por asesora al día (reparte el excedente o lo pospone; nunca se pierde).
      await aplicarTopeDeTareas(workspaceId, config, ahora);
    }
    return { negocios: negocios.length, revisados };
  } catch (error) {
    anotarError("fallo el barrido", error);
    return { negocios: 0, revisados: 0 };
  } finally {
    barriendo = false;
  }
}
