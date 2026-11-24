import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { detectarOrigenWeb } from "@/lib/origen-de-venta";
import { leerMarcaExterior } from "@/features/seguimiento-inteligente/dominio/exterior";

/*
  ORIGEN WEB: los clientes que escriben desde el botón de WhatsApp de la página magilus.com.

  El botón abre el chat con un texto pre-llenado que dice "vengo de magilus.com". Cuando ese texto
  entra como PRIMER mensaje de un contacto, aca se le pone la etiqueta "Web" y se guarda
  Contact.metadata.origen = { canal: "web" } y crmOrigin = "web". Sin migracion: metadata es Json.

  Esos chats suelen entrar por la línea administrativa, que oculta del CRM los contactos nuevos
  (excludedFromCrm). Un cliente de la página web es un lead, así que aca se deja visible.

  No toca la etapa ni la asesora asignada, y NO manda ningún mensaje por WhatsApp.
  Es best-effort: se llama desde un after() del webhook y nunca tira error hacia afuera.
*/

const TAG_SLUG = "web";
const TAG_NOMBRE = "Web";
const TAG_COLOR = "#0ea5e9";

async function asegurarEtiqueta(workspaceId: string) {
  const existente = await prisma.tag.findFirst({
    where: { workspaceId, slug: TAG_SLUG },
    select: { id: true },
  });
  if (existente) return existente;
  try {
    return await prisma.tag.create({
      data: {
        id: randomUUID(),
        workspaceId,
        name: TAG_NOMBRE,
        slug: TAG_SLUG,
        color: TAG_COLOR,
        updatedAt: new Date(),
      },
      select: { id: true },
    });
  } catch (error) {
    // Dos mensajes a la vez crearon la misma etiqueta: se usa la que gano.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return prisma.tag.findFirst({ where: { workspaceId, slug: TAG_SLUG }, select: { id: true } });
    }
    throw error;
  }
}

/**
 * Lo que tienen en común el registro en vivo y el arreglo de los chats viejos: deja al contacto visible
 * en el CRM, le guarda el origen web (solo si no tenía uno) y le pone la etiqueta "Web".
 */
async function marcarComoClienteWeb(input: {
  workspaceId: string;
  contactId: string;
  channelId: string | null;
  metadata: Prisma.JsonValue | null;
  fecha: Date;
}) {
  const meta =
    input.metadata && typeof input.metadata === "object" && !Array.isArray(input.metadata)
      ? (input.metadata as Record<string, unknown>)
      : {};
  // El primer toque manda: no se re-escribe un origen ya guardado.
  const yaTeniaOrigen = Boolean(meta.origen);

  await prisma.contact.update({
    where: { id: input.contactId },
    data: {
      // Cliente de la página web: se ve en el CRM aunque haya entrado por la línea administrativa.
      excludedFromCrm: false,
      ...(yaTeniaOrigen
        ? {}
        : {
            metadata: {
              ...meta,
              // crmOrigin es lo PRIMERO que lee el origen del CRM. No se pisa si ya hay uno.
              ...(meta.crmOrigin ? {} : { crmOrigin: "web" }),
              origen: {
                canal: "web",
                fecha: input.fecha.toISOString(),
                ...(input.channelId ? { channelId: input.channelId } : {}),
              },
            } as Prisma.InputJsonValue,
          }),
    },
  });

  const etiqueta = await asegurarEtiqueta(input.workspaceId);
  if (etiqueta) {
    await prisma.contactTag.createMany({
      data: [{ contactId: input.contactId, tagId: etiqueta.id, workspaceId: input.workspaceId }],
      skipDuplicates: true,
    });
  }

  return { yaTeniaOrigen };
}

/**
 * Marca al contacto como lead de la página web si este es su primer mensaje.
 * `contactoRecienCreado`: la ficha nacio con este mismo mensaje (primer mensaje seguro).
 * Si la ficha ya existia, solo cuenta como primero si no tiene mas de un mensaje entrante.
 */
export async function registrarOrigenWeb(input: {
  workspaceId: string;
  contactId: string;
  channelId: string;
  texto: string | null | undefined;
  contactoRecienCreado: boolean;
}) {
  try {
    if (!detectarOrigenWeb(input.texto)) return;

    const contacto = await prisma.contact.findUnique({
      where: { id: input.contactId },
      select: { metadata: true, bloqueadoEn: true },
    });
    if (!contacto) return;
    // Un contacto bloqueado sigue fuera del CRM: no se le cambia nada.
    if (contacto.bloqueadoEn) return;

    if (!input.contactoRecienCreado) {
      const entrantes = await prisma.message.count({
        where: { contactId: input.contactId, direction: "INBOUND" },
      });
      if (entrantes > 1) return;
    }

    const { yaTeniaOrigen } = await marcarComoClienteWeb({
      workspaceId: input.workspaceId,
      contactId: input.contactId,
      channelId: input.channelId,
      metadata: contacto.metadata,
      fecha: new Date(),
    });

    console.log("[ORIGEN] web", { contactId: input.contactId, yaTeniaOrigen });
  } catch (error) {
    console.warn("[ORIGEN] web_failed", {
      contactId: input.contactId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/*
  ARREGLO DE UNA SOLA VEZ (parte 4): los chats web que la línea administrativa ocultó antes de que
  existiera registrarOrigenWeb. Busca los contactos ocultos del CRM (excludedFromCrm), no bloqueados,
  cuyo PRIMER mensaje entrante por una línea Admin de Evolution es del 16-sep-2026 en adelante y dice
  "vengo de magilus.com". Salta a los marcados como de fuera de Colombia. A cada uno lo deja visible con el origen y la etiqueta "Web", igual que en vivo.

  Lo llama el reloj de cada minuto (api/cron/follows). Al terminar deja la marca `arreglo_chats_web_60d`
  en AppSetting con { fecha, cantidad, contactIds } y desde ahí no vuelve a hacer nada. No borra nada,
  no toca la etapa ni la asesora y NO manda ningún mensaje. Si la búsqueda falla, no deja la marca y se
  reintenta en la vuelta siguiente (es idempotente: la etiqueta no se duplica y el origen no se pisa).
*/

export const CLAVE_ARREGLO_CHATS_WEB = "arreglo_chats_web_60d";

/** Desde el 16-sep-2026 00:00 en Colombia (05:00 UTC): los últimos 60 días. */
export const DESDE_ARREGLO_CHATS_WEB = new Date("2026-09-16T05:00:00.000Z");

const MENSAJE_ENTRANTE_POR_LINEA_ADMIN = {
  direction: "INBOUND",
  channel: { is: { purpose: "ADMIN", provider: "EVOLUTION" } },
} satisfies Prisma.MessageWhereInput;

export type ResultadoArregloChatsWeb = { fecha: string; cantidad: number; contactIds: string[] };

/** Corre el arreglo si no se corrió nunca. Nunca lanza. */
export async function arreglarChatsWebViejos(ahora = new Date()): Promise<ResultadoArregloChatsWeb | null> {
  try {
    const marca = await prisma.appSetting.findUnique({ where: { key: CLAVE_ARREGLO_CHATS_WEB }, select: { key: true } });
    if (marca) return null;

    // El primer mensaje entrante por la línea Admin de cada contacto oculto; solo los que empezaron desde el 16-sep.
    const primeros = await prisma.message.groupBy({
      by: ["contactId"],
      where: {
        ...MENSAJE_ENTRANTE_POR_LINEA_ADMIN,
        contactId: { not: null },
        contact: { is: { excludedFromCrm: true, bloqueadoEn: null } },
      },
      _min: { createdAt: true },
      having: { createdAt: { _min: { gte: DESDE_ARREGLO_CHATS_WEB } } },
    });

    const contactIds: string[] = [];
    for (const fila of primeros) {
      const contactId = fila.contactId;
      const desde = fila._min?.createdAt;
      if (!contactId || !desde) continue;
      try {
        const primero = await prisma.message.findFirst({
          where: { ...MENSAJE_ENTRANTE_POR_LINEA_ADMIN, contactId, createdAt: { gte: desde } },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: { content: true, channelId: true, workspaceId: true, createdAt: true },
        });
        if (!primero || !detectarOrigenWeb(primero.content)) continue;

        // Se vuelve a leer la ficha: pudo cambiar entre la búsqueda y ahora.
        const contacto = await prisma.contact.findUnique({
          where: { id: contactId },
          select: { metadata: true, bloqueadoEn: true, excludedFromCrm: true },
        });
        if (!contacto || contacto.bloqueadoEn || !contacto.excludedFromCrm) continue;
        // Un cliente de fuera de Colombia se ocultó a propósito (no se le escribe): sigue oculto.
        if (leerMarcaExterior(contacto.metadata)) continue;

        await marcarComoClienteWeb({
          workspaceId: primero.workspaceId,
          contactId,
          channelId: primero.channelId,
          metadata: contacto.metadata,
          fecha: primero.createdAt,
        });
        contactIds.push(contactId);
      } catch (error) {
        console.warn("[ORIGEN] arreglo_web_contacto_failed", {
          contactId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const resultado: ResultadoArregloChatsWeb = { fecha: ahora.toISOString(), cantidad: contactIds.length, contactIds };
    const value = JSON.stringify(resultado);
    // upsert: si dos vueltas corrieron a la vez, la segunda solo reescribe la misma marca.
    await prisma.appSetting.upsert({
      where: { key: CLAVE_ARREGLO_CHATS_WEB },
      create: { key: CLAVE_ARREGLO_CHATS_WEB, value },
      update: { value },
    });
    console.log("[ORIGEN] arreglo_web", { cantidad: resultado.cantidad, revisados: primeros.length });
    return resultado;
  } catch (error) {
    console.warn("[ORIGEN] arreglo_web_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
