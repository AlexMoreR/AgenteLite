import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { registrarCambioDeEtapa } from "@/lib/historial-etapa";
import { recordConversationActivity } from "@/lib/conversation-activity";
import { recordOfficialApiStageActivity } from "@/lib/official-api-crm-stage";
import { createFollowsFromRulesForSource } from "@/features/seguimientos/services/follows";
import { claveDeEtapaAutomatica, resolverChat } from "@/lib/etapa-automatica-crm";
import {
  HORAS_DE_RESPETO_A_LA_PERSONA,
  PREGUNTA_PARA_LA_IA,
  clasificarPorFrases,
  decidirEtapaPorLectura,
  descarteClaro,
  ETIQUETA_DE_ETAPA,
  intencionDeLaIa,
  metadataConDescarte,
  metadataConRecontacto,
  valeLaPenaPreguntar,
  type IntencionDelCliente,
  type MetodoDeLectura,
} from "@/features/crm/domain/intencion-del-cliente";
import type { CrmStage } from "@/features/crm/types";

/**
 * LA ETAPA POR LECTURA: después de cada mensaje del cliente, el sistema lee qué dijo y mueve la
 * etapa (Caliente, Tibio o Descartado) aunque las asesoras no lo hagan. Las frases y las reglas
 * viven en domain/intencion-del-cliente.ts; aquí van las protecciones y lo que toca la base.
 *
 * Complementa a la etapa automática de asignar/cotizar (src/lib/etapa-automatica-crm.ts) y reutiliza
 * su interruptor, su búsqueda del chat y su formato de nota.
 *
 * Protecciones: nunca baja (salvo a Descartado con frase clara); no toca Ganado, Perdido, "fuera del
 * CRM" ni la línea administrativa; si una persona movió la etapa a mano en las últimas 24 horas no
 * cambia nada; si alguien cambió la etapa en el medio, no se pisa.
 *
 * NO cambia lo que el bot le contesta al cliente ni manda mensajes: solo etapa, nota y fecha de
 * recontacto. NUNCA lanza: el mensaje del cliente ya se guardó y no se puede romper por esto.
 *
 * Interruptores (AppSetting, `off` apaga; vienen prendidos):
 *  - `crm:etapa-por-lectura:<negocio>`: todo esto (además del general `crm:etapa-automatica:<negocio>`);
 *  - `crm:etapa-por-lectura-descarte:<negocio>`: solo el descarte automático.
 */

export function claveDeEtapaPorLectura(workspaceId: string): string {
  return `crm:etapa-por-lectura:${workspaceId}`;
}

export function claveDeDescarteAutomaticoPorLectura(workspaceId: string): string {
  return `crm:etapa-por-lectura-descarte:${workspaceId}`;
}

/** Cómo quedó anotada cada decisión en el historial: `lectura:frase: …` o `lectura:ia: …`. */
export function notaDeHistorial(metodo: MetodoDeLectura, razon: string): string {
  return `lectura:${metodo}: ${razon}`;
}

export type ResultadoPorLectura = {
  /** La etapa nueva, o null si no se movió. */
  etapa: CrmStage | null;
  /** true si se guardó una fecha de recontacto. */
  recontacto: boolean;
  metodo: MetodoDeLectura | null;
};

const SIN_CAMBIO: ResultadoPorLectura = { etapa: null, recontacto: false, metodo: null };

async function prendido(clave: string): Promise<boolean> {
  const fila = await prisma.appSetting.findUnique({ where: { key: clave }, select: { value: true } });
  return fila?.value?.trim().toLowerCase() !== "off";
}

/** La pregunta corta y barata a la IA del CRM. Devuelve su respuesta de una palabra, o null si falla. */
export async function preguntarALaIaDelCrm(texto: string): Promise<string | null> {
  const clave = process.env.OPENAI_API_KEY?.trim();
  if (!clave) return null;
  try {
    const respuesta = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${clave}` },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        temperature: 0,
        max_tokens: 5,
        messages: [
          { role: "system", content: PREGUNTA_PARA_LA_IA },
          { role: "user", content: texto.slice(0, 500) },
        ],
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!respuesta.ok) return null;
    const datos = (await respuesta.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return datos.choices?.[0]?.message?.content?.trim() ?? null;
  } catch {
    return null;
  }
}

/** ¿Una persona movió la etapa de este contacto a mano en las últimas 24 horas? */
async function laMovioUnaPersona(contactId: string, ahora: Date): Promise<boolean> {
  const desde = new Date(ahora.getTime() - HORAS_DE_RESPETO_A_LA_PERSONA * 3_600_000);
  const fila = await prisma.historialEtapa.findFirst({
    where: { contactId, origen: { in: ["ASESORA", "MCP"] }, creadoEn: { gte: desde } },
    select: { id: true },
  });
  return Boolean(fila);
}

export async function aplicarEtapaPorLectura(input: {
  workspaceId: string;
  conversationId: string;
  linea: "agent" | "official";
  /** Lo que escribió el cliente (en audios, la transcripción si ya la hay). */
  texto: string | null | undefined;
  cuando?: Date;
  /** Para pruebas: reemplaza la llamada a la IA. */
  preguntarALaIa?: (texto: string) => Promise<string | null>;
}): Promise<ResultadoPorLectura> {
  try {
    const texto = (input.texto ?? "").trim();
    if (!texto) return SIN_CAMBIO;
    const ahora = input.cuando ?? new Date();

    const [general, lectura, descarteActivo] = await Promise.all([
      prendido(claveDeEtapaAutomatica(input.workspaceId)),
      prendido(claveDeEtapaPorLectura(input.workspaceId)),
      prendido(claveDeDescarteAutomaticoPorLectura(input.workspaceId)),
    ]);
    if (!general || !lectura) return SIN_CAMBIO;

    const chat = await resolverChat(input);
    if (!chat || chat.lineaAdministrativa) return SIN_CAMBIO;

    const contacto = await prisma.contact.findFirst({
      where: { id: chat.contactId, workspaceId: input.workspaceId },
      select: { crmStage: true, excludedFromCrm: true, metadata: true },
    });
    if (!contacto || contacto.excludedFromCrm) return SIN_CAMBIO;
    const etapaActual = contacto.crmStage as CrmStage;
    // Ganado y Perdido los cierra una persona: no se lee ni se gasta IA.
    if (etapaActual === "GANADO" || etapaActual === "PERDIDO") return SIN_CAMBIO;

    // Con el interruptor del descarte apagado, esas frases no hacen nada (ni siquiera van a la IA).
    if (!descarteActivo && descarteClaro(texto)) return SIN_CAMBIO;

    if (await laMovioUnaPersona(chat.contactId, ahora)) return SIN_CAMBIO;

    let intencion: IntencionDelCliente | null = clasificarPorFrases(texto, ahora);
    if (!intencion && valeLaPenaPreguntar(texto)) {
      const respuesta = await (input.preguntarALaIa ?? preguntarALaIaDelCrm)(texto).catch(() => null);
      intencion = intencionDeLaIa(respuesta, texto, ahora);
    }
    if (!intencion) return SIN_CAMBIO;

    const destino = decidirEtapaPorLectura({
      etapaActual,
      intencion,
      fueraDelCrm: contacto.excludedFromCrm,
      descarteActivo,
    });
    const conRecontacto =
      intencion.etapa === "PROPUESTA" && intencion.recontacto
        ? metadataConRecontacto(contacto.metadata, intencion.recontacto, ahora)
        : null;
    if (!destino && !conRecontacto) return SIN_CAMBIO;

    if (!destino) {
      // Ya estaba más arriba (o es Tibio igual): solo se anota la fecha para el seguimiento.
      await prisma.contact.updateMany({
        where: { id: chat.contactId, workspaceId: input.workspaceId },
        data: { metadata: conRecontacto as Prisma.InputJsonValue },
      });
      return { etapa: null, recontacto: true, metodo: intencion.metodo };
    }

    let metadata: Record<string, unknown> | null = conRecontacto;
    if (destino === "PERDIDO") {
      metadata = metadataConDescarte(contacto.metadata, {
        frase: intencion.frase ?? texto.slice(0, 200),
        motivo: intencion.motivoDePerdida ?? "otro",
        en: ahora,
      });
    }

    // Solo se guarda si el lead sigue en la etapa que se leyó: si una persona lo movió en el medio,
    // gana la persona.
    const guardado = await prisma.contact.updateMany({
      where: { id: chat.contactId, workspaceId: input.workspaceId, crmStage: etapaActual },
      data: {
        crmStage: destino,
        ...(destino === "PERDIDO" ? { lostReason: intencion.motivoDePerdida ?? "otro" } : {}),
        ...(metadata ? { metadata: metadata as Prisma.InputJsonValue } : {}),
      },
    });
    if (guardado.count === 0) return SIN_CAMBIO;

    await registrarCambioDeEtapa({
      workspaceId: input.workspaceId,
      contactId: chat.contactId,
      conversationId: input.conversationId,
      etapaAnterior: etapaActual,
      etapaNueva: destino,
      origen: "AUTOMATICO",
      nota: notaDeHistorial(intencion.metodo, intencion.razon),
    });

    // Las mismas consecuencias que mover la tarjeta a mano (reglas de seguimiento por etapa).
    await createFollowsFromRulesForSource({
      workspaceId: input.workspaceId,
      contactId: chat.contactId,
      sourceType: "CRM_STAGE",
      sourceId: destino,
    }).catch(() => {});

    const etiqueta = ETIQUETA_DE_ETAPA[intencion.etapa];
    const nota = `Etapa movida por el sistema: ${etiqueta} (${intencion.razon})`;
    if (input.linea === "official") {
      if (chat.configId) {
        await recordOfficialApiStageActivity({
          configId: chat.configId,
          conversationId: input.conversationId,
          stageLabel: etiqueta,
          texto: nota,
        }).catch(() => {});
      }
    } else {
      await recordConversationActivity({
        workspaceId: input.workspaceId,
        conversationId: input.conversationId,
        channelId: chat.channelId,
        contactId: chat.contactId,
        kind: "stage_changed",
        text: nota,
      });
    }
    return { etapa: destino, recontacto: Boolean(conRecontacto), metodo: intencion.metodo };
  } catch (error) {
    console.warn("[etapa-por-lectura] no se pudo leer el mensaje", {
      conversationId: input.conversationId,
      error: error instanceof Error ? error.message : String(error),
    });
    return SIN_CAMBIO;
  }
}
