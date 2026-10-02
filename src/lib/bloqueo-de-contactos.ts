import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { readGatewayConnection } from "@/lib/evolution";
import { WAHA_GATEWAY_KIND, bloquearContactoWaha } from "@/lib/waha";

/**
 * BLOQUEAR UN CONTACTO desde la bandeja (pedido de Alex, 02-10-2026). Solo dueño y admin.
 *
 * Bloquear hace tres cosas:
 *  1. Lo bloquea en WhatsApp, en CADA línea donde tiene chat: ya no puede escribir ni llamar.
 *  2. Lo saca de la bandeja (`bloqueadoEn`) y del CRM, Llamadas y Campañas (`excludedFromCrm`, la
 *     marca de "oculto" que esas pantallas ya respetan).
 *  3. Pausa el agente en sus chats: nada automático le sale a alguien bloqueado.
 *
 * Desbloquear deshace las tres, y devuelve cada cosa a como estaba ANTES: si el contacto ya
 * estaba oculto del CRM (un proveedor) o tenía un chat pausado a mano, sigue así. Para eso se
 * guarda en `metadata.bloqueo` lo que había.
 *
 * Si WhatsApp falla en una línea, el contacto se bloquea igual en el CRM y la respuesta dice en
 * qué línea no se pudo: es preferible sacarlo de la vista ya que dejar todo a medias.
 */

type DatosDelBloqueo = {
  en: string;
  porUserId: string;
  porNombre: string | null;
  /** Estaba oculto del CRM antes de bloquearlo: al desbloquear sigue oculto. */
  ocultoAntes: boolean;
  /** Chats que pausamos al bloquear (los que ya estaban pausados no se tocan al desbloquear). */
  chatsPausados: string[];
  /** Líneas donde quedó bloqueado en WhatsApp, para desbloquear en las mismas. */
  lineas: string[];
};

export type ResultadoDeBloqueo = {
  /** Líneas donde WhatsApp lo bloqueó (o desbloqueó). */
  lineasOk: string[];
  /** Líneas donde no se pudo, con el motivo. */
  lineasConError: Array<{ linea: string; error: string }>;
  /** Los chats del contacto (en todas sus líneas), para que la bandeja los saque o los traiga. */
  chatIds: string[];
};

function leerMetadata(metadata: unknown): Record<string, unknown> {
  return metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? { ...(metadata as Record<string, unknown>) }
    : {};
}

async function chatsConSuLinea(workspaceId: string, contactId: string) {
  return prisma.conversation.findMany({
    where: { workspaceId, contactId },
    select: {
      id: true,
      automationPaused: true,
      channel: { select: { id: true, name: true, evolutionInstanceName: true, metadata: true } },
    },
  });
}

async function cambiarEnWhatsApp(input: {
  chats: Awaited<ReturnType<typeof chatsConSuLinea>>;
  telefono: string;
  bloquear: boolean;
  soloLineas?: string[];
}): Promise<ResultadoDeBloqueo> {
  const resultado: ResultadoDeBloqueo = {
    lineasOk: [],
    lineasConError: [],
    chatIds: input.chats.map((chat) => chat.id),
  };
  const vistas = new Set<string>();

  for (const chat of input.chats) {
    const canal = chat.channel;
    if (!canal || vistas.has(canal.id)) {
      continue;
    }
    vistas.add(canal.id);
    if (input.soloLineas && !input.soloLineas.includes(canal.id)) {
      continue;
    }

    const conexion = readGatewayConnection(canal.metadata);
    const sesion = canal.evolutionInstanceName?.trim();
    if (!conexion || conexion.kind !== WAHA_GATEWAY_KIND || !sesion) {
      resultado.lineasConError.push({
        linea: canal.name,
        error: "Esta línea no permite bloquear desde el CRM.",
      });
      continue;
    }

    try {
      await bloquearContactoWaha({
        connection: { baseUrl: conexion.baseUrl, apiToken: conexion.apiToken },
        sesion,
        telefono: input.telefono,
        bloquear: input.bloquear,
      });
      resultado.lineasOk.push(canal.id);
    } catch (error) {
      console.error("[bloqueo] WhatsApp no respondio", {
        linea: canal.name,
        bloquear: input.bloquear,
        error: error instanceof Error ? error.message : String(error),
      });
      resultado.lineasConError.push({
        linea: canal.name,
        error: "WhatsApp no respondió.",
      });
    }
  }

  return resultado;
}

/** Nombres de línea a partir de sus ids, para los mensajes a la persona. */
export async function nombresDeLineas(ids: string[]): Promise<string[]> {
  if (ids.length === 0) {
    return [];
  }
  const lineas = await prisma.whatsAppChannel.findMany({ where: { id: { in: ids } }, select: { name: true } });
  return lineas.map((linea) => linea.name);
}

export async function bloquearContacto(input: {
  workspaceId: string;
  contactId: string;
  userId: string;
  userName: string | null;
}): Promise<ResultadoDeBloqueo | { error: string }> {
  const contacto = await prisma.contact.findFirst({
    where: { id: input.contactId, workspaceId: input.workspaceId },
    select: { id: true, phoneNumber: true, excludedFromCrm: true, bloqueadoEn: true, metadata: true },
  });
  if (!contacto) {
    return { error: "Contacto no encontrado" };
  }
  if (contacto.bloqueadoEn) {
    return { error: "Este contacto ya está bloqueado." };
  }

  const chats = await chatsConSuLinea(input.workspaceId, contacto.id);
  const resultado = await cambiarEnWhatsApp({ chats, telefono: contacto.phoneNumber, bloquear: true });

  const chatsAPausar = chats.filter((chat) => !chat.automationPaused).map((chat) => chat.id);
  const datos: DatosDelBloqueo = {
    en: new Date().toISOString(),
    porUserId: input.userId,
    porNombre: input.userName,
    ocultoAntes: contacto.excludedFromCrm,
    chatsPausados: chatsAPausar,
    lineas: resultado.lineasOk,
  };

  await prisma.$transaction([
    prisma.contact.update({
      where: { id: contacto.id },
      data: {
        bloqueadoEn: new Date(),
        excludedFromCrm: true,
        metadata: { ...leerMetadata(contacto.metadata), bloqueo: datos } as Prisma.InputJsonValue,
      },
    }),
    prisma.conversation.updateMany({
      where: { id: { in: chatsAPausar } },
      data: { automationPaused: true, automationPausedAt: new Date() },
    }),
  ]);

  return resultado;
}

export async function desbloquearContacto(input: {
  workspaceId: string;
  contactId: string;
}): Promise<ResultadoDeBloqueo | { error: string }> {
  const contacto = await prisma.contact.findFirst({
    where: { id: input.contactId, workspaceId: input.workspaceId },
    select: { id: true, phoneNumber: true, bloqueadoEn: true, metadata: true },
  });
  if (!contacto) {
    return { error: "Contacto no encontrado" };
  }
  if (!contacto.bloqueadoEn) {
    return { error: "Este contacto no está bloqueado." };
  }

  const metadata = leerMetadata(contacto.metadata);
  const datos = (metadata.bloqueo ?? null) as Partial<DatosDelBloqueo> | null;
  const chats = await chatsConSuLinea(input.workspaceId, contacto.id);

  // Se desbloquea en las líneas donde se bloqueó; si no quedó registro, en todas las suyas.
  const resultado = await cambiarEnWhatsApp({
    chats,
    telefono: contacto.phoneNumber,
    bloquear: false,
    soloLineas: Array.isArray(datos?.lineas) && datos.lineas.length > 0 ? datos.lineas : undefined,
  });

  delete metadata.bloqueo;
  const chatsAReanudar = Array.isArray(datos?.chatsPausados) ? datos.chatsPausados : [];

  await prisma.$transaction([
    prisma.contact.update({
      where: { id: contacto.id },
      data: {
        bloqueadoEn: null,
        excludedFromCrm: Boolean(datos?.ocultoAntes),
        metadata: metadata as Prisma.InputJsonValue,
      },
    }),
    prisma.conversation.updateMany({
      where: { id: { in: chatsAReanudar }, contactId: contacto.id },
      data: { automationPaused: false, automationPausedAt: null },
    }),
  ]);

  return resultado;
}
