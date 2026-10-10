import { Prisma } from "@prisma/client";

import { esNumeroDelEquipo } from "@/features/agente-v3/servicios/avisos";
import { registrarEnSegundoPlano } from "@/features/embudo/servicios/eventos";
import { prisma } from "@/lib/prisma";
import { isMarkedAsLid, readDiscoveredPhone } from "@/lib/whatsapp-lid";

import { leerMarcaExterior, mencionaColombia, paisDelTelefono } from "../dominio/exterior";
import { leerConfigSeguimiento } from "./config";

/**
 * FUERA DE COLOMBIA en el webhook (interruptor `exterior.activo`, apagado por defecto).
 *
 * Decisión de Alexander: solo vendemos en Colombia. Si el teléfono es de otro país (y se puede
 * saber: un LID sin teléfono real NO se decide), el bot contesta UNA vez con amabilidad, no activa
 * producto, no pasa el chat a una asesora, no hay seguimientos y el contacto queda marcado
 * (`metadata.fueraDeColombia`) y oculto del CRM (`excludedFromCrm`, igual que un contacto de una
 * línea administrativa), así que sale de las métricas, Llamadas, Mi día y campañas.
 *
 * Deshacer a mano: borrar `fueraDeColombia` del metadata y volver `excludedFromCrm` a su valor
 * anterior (queda guardado en `fueraDeColombia.ocultoAntes`).
 */

export type DecisionExterior = { excluir: boolean; responder: boolean; texto: string };

const NADA: DecisionExterior = { excluir: false, responder: false, texto: "" };

export async function revisarExteriorEnWebhook(input: {
  workspaceId: string;
  contactId: string;
  conversationId: string;
  channelId: string;
  telefono: string | null;
  /** El número que llegó es el LID (no se pudo resolver el teléfono real). */
  esLidSinResolver: boolean;
  /** Lo que acaba de escribir (si nombra una ciudad de Colombia, NO es del exterior). */
  texto?: string | null;
}): Promise<DecisionExterior> {
  try {
    const config = await leerConfigSeguimiento(input.workspaceId);
    if (!config.exterior.activo) return NADA;
    const contacto = await prisma.contact.findUnique({
      where: { id: input.contactId },
      select: { metadata: true, excludedFromCrm: true, phoneNumber: true },
    });
    if (!contacto) return NADA;
    const marca = leerMarcaExterior(contacto.metadata);
    if (marca) {
      // "Estoy en Pereira": era un cliente en Colombia con número extranjero. Se desmarca y se
      // atiende normal desde este mensaje.
      if (mencionaColombia(input.texto)) {
        await desmarcarExterior(input.contactId);
        return NADA;
      }
      return { excluir: true, responder: !marca.respuestaEnviada, texto: config.exterior.texto };
    }

    // Si ya nombró un lugar de Colombia en esta charla (o ahora), no se decide por el teléfono.
    const anteriores = await prisma.message.findMany({
      where: { conversationId: input.conversationId, direction: "INBOUND", type: { not: "SYSTEM" } },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { content: true, transcripcion: true },
    });
    if (mencionaColombia(input.texto) || anteriores.some((m) => mencionaColombia(m.transcripcion || m.content))) return NADA;

    const pais = paisDelTelefono({
      telefono: input.telefono ?? contacto.phoneNumber,
      esLid: input.esLidSinResolver || isMarkedAsLid(contacto.metadata),
      telefonoDescubierto: readDiscoveredPhone(contacto.metadata),
    });
    if (pais.pais !== "EXTERIOR") return NADA;
    // Alguien del equipo (Génesis escribe desde +58) nunca es "cliente del exterior".
    if (await esNumeroDelEquipo(input.workspaceId, input.telefono ?? contacto.phoneNumber).catch(() => true)) return NADA;

    const metadata = {
      ...((contacto.metadata && typeof contacto.metadata === "object" && !Array.isArray(contacto.metadata) ? contacto.metadata : {}) as Record<string, unknown>),
      fueraDeColombia: { en: new Date().toISOString(), prefijo: pais.prefijo, respuestaEnviada: false, ocultoAntes: contacto.excludedFromCrm },
    };
    await prisma.contact.update({
      where: { id: input.contactId },
      data: { metadata: metadata as Prisma.InputJsonValue, excludedFromCrm: true },
    });
    registrarEnSegundoPlano(
      { workspaceId: input.workspaceId, conversationId: input.conversationId, contactId: input.contactId, channelId: input.channelId },
      [{ tipo: "EXTERIOR", origen: "webhook", claveUnica: `EXTERIOR:${input.conversationId}`, datos: { prefijo: pais.prefijo } }],
    );
    console.log("[seguimiento-inteligente] cliente fuera de Colombia", { conversationId: input.conversationId, prefijo: pais.prefijo });
    return { excluir: true, responder: true, texto: config.exterior.texto };
  } catch (error) {
    console.warn("[seguimiento-inteligente] fallo la revision de exterior; se atiende como siempre", {
      conversationId: input.conversationId,
      error: error instanceof Error ? error.message : String(error),
    });
    return NADA;
  }
}

/** Quita la marca y devuelve `excludedFromCrm` a como estaba (queda el rastro en `fueraDeColombiaRevertido`). */
export async function desmarcarExterior(contactId: string): Promise<void> {
  const contacto = await prisma.contact.findUnique({ where: { id: contactId }, select: { metadata: true } });
  const meta = (contacto?.metadata && typeof contacto.metadata === "object" && !Array.isArray(contacto.metadata) ? contacto.metadata : {}) as Record<string, unknown>;
  const marca = (meta.fueraDeColombia && typeof meta.fueraDeColombia === "object" ? meta.fueraDeColombia : {}) as Record<string, unknown>;
  const resto = Object.fromEntries(Object.entries(meta).filter(([clave]) => clave !== "fueraDeColombia"));
  await prisma.contact.update({
    where: { id: contactId },
    data: {
      metadata: { ...resto, fueraDeColombiaRevertido: { ...marca, revertidoEn: new Date().toISOString() } } as Prisma.InputJsonValue,
      excludedFromCrm: marca.ocultoAntes === true,
    },
  });
  await prisma.embudoLead.updateMany({ where: { contactId }, data: { exterior: false } }).catch(() => undefined);
  console.log("[seguimiento-inteligente] cliente desmarcado de fuera de Colombia (nombró una ciudad de Colombia)", { contactId });
}

/** Deja anotado que ya se le contestó (una sola vez). */
export async function marcarRespuestaExteriorEnviada(contactId: string): Promise<void> {
  const contacto = await prisma.contact.findUnique({ where: { id: contactId }, select: { metadata: true } });
  const meta = (contacto?.metadata && typeof contacto.metadata === "object" && !Array.isArray(contacto.metadata) ? contacto.metadata : {}) as Record<string, unknown>;
  const marca = (meta.fueraDeColombia && typeof meta.fueraDeColombia === "object" ? meta.fueraDeColombia : {}) as Record<string, unknown>;
  await prisma.contact.update({
    where: { id: contactId },
    data: { metadata: { ...meta, fueraDeColombia: { ...marca, respuestaEnviada: true, respondidoEn: new Date().toISOString() } } as Prisma.InputJsonValue },
  });
}
