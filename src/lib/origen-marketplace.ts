import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/*
  ORIGEN MARKETPLACE: cuantos clientes de Facebook Marketplace llegan a WhatsApp y cuantos compran.

  La extension NETMAGI (repo messenger-basic) responde en Marketplace y, cuando el bot le pasa el
  numero de WhatsApp al comprador, agrega un enlace wa.me con el texto pre-llenado
  "Hola, vengo de Marketplace 🛒 (ref MK-XXXXX)". MK-XXXXX es un hash corto de la cuenta de
  Facebook que lo atendio (no es el id ni el nombre).

  Cuando ese texto entra como PRIMER mensaje de un contacto, aca se le pone la etiqueta
  "Marketplace" y se guarda Contact.metadata.origen = { canal, cuenta, fecha }. Sin migracion:
  metadata es Json. La venta se mide con lo que ya existe (crmStage = GANADO + wonAt).

  Es best-effort: se llama desde un after() del webhook y nunca tira error hacia afuera.
*/

const TAG_SLUG = "marketplace";
const TAG_NOMBRE = "Marketplace";
const TAG_COLOR = "#1877f2";

const REF_RE = /\bref\s*:?\s*(MK-[A-Z0-9]{3,10})\b/i;
const VENGO_RE = /vengo\s+de(l)?\s+marketplace/i;

export type OrigenMarketplace = { cuenta: string | null };

/** Lee el texto entrante. Devuelve null si no es el mensaje pre-llenado de Marketplace. */
export function detectarOrigenMarketplace(texto: string | null | undefined): OrigenMarketplace | null {
  const t = String(texto ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "");
  if (!t.trim()) return null;
  const ref = t.match(REF_RE);
  if (!ref && !VENGO_RE.test(t)) return null;
  return { cuenta: ref ? ref[1].toUpperCase() : null };
}

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
 * Marca al contacto como lead de Marketplace si este es su primer mensaje.
 * `contactoRecienCreado`: la ficha nacio con este mismo mensaje (primer mensaje seguro).
 * Si la ficha ya existia, solo cuenta como primero si no tiene mas de un mensaje entrante.
 */
export async function registrarOrigenMarketplace(input: {
  workspaceId: string;
  contactId: string;
  channelId: string;
  origen: OrigenMarketplace;
  contactoRecienCreado: boolean;
}) {
  try {
    const contacto = await prisma.contact.findUnique({
      where: { id: input.contactId },
      select: { metadata: true },
    });
    if (!contacto) return;
    const meta =
      contacto.metadata && typeof contacto.metadata === "object" && !Array.isArray(contacto.metadata)
        ? (contacto.metadata as Record<string, unknown>)
        : {};
    // El primer toque manda: no se re-escribe un origen ya guardado.
    if (meta.origen) return;

    if (!input.contactoRecienCreado) {
      const entrantes = await prisma.message.count({
        where: { contactId: input.contactId, direction: "INBOUND" },
      });
      if (entrantes > 1) return;
    }

    await prisma.contact.update({
      where: { id: input.contactId },
      data: {
        metadata: {
          ...meta,
          // crmOrigin es lo PRIMERO que lee el origen del CRM (getCrmData / getResumenDia): con
          // "marketplace" el lead cae en el balde MARKETPLACE que ya existe. No se pisa si ya hay uno.
          ...(meta.crmOrigin ? {} : { crmOrigin: "marketplace" }),
          origen: {
            canal: "marketplace",
            cuenta: input.origen.cuenta,
            fecha: new Date().toISOString(),
            channelId: input.channelId,
          },
        } as Prisma.InputJsonValue,
      },
    });

    const etiqueta = await asegurarEtiqueta(input.workspaceId);
    if (etiqueta) {
      await prisma.contactTag.createMany({
        data: [{ contactId: input.contactId, tagId: etiqueta.id, workspaceId: input.workspaceId }],
        skipDuplicates: true,
      });
    }

    console.log("[ORIGEN] marketplace", { contactId: input.contactId, cuenta: input.origen.cuenta });
  } catch (error) {
    console.warn("[ORIGEN] marketplace_failed", {
      contactId: input.contactId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
