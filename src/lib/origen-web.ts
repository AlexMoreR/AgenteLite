import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { detectarOrigenWeb } from "@/lib/origen-de-venta";

/*
  ORIGEN WEB: chats que llegan del botón de WhatsApp de la página magilus.com.

  El botón abre el chat con un texto que dice "vengo de magilus.com". Cuando ese texto entra como
  PRIMER mensaje de un contacto que no está bloqueado, aca se le pone la etiqueta "Web", se guarda
  Contact.metadata.origen = { canal: "web" } y crmOrigin = "web" (solo si no habia un origen
  guardado) y se deja excludedFromCrm = false: aunque entre por la linea Admin, el chat se ve en el
  CRM. Sin migracion: metadata es Json.

  No toca crmStage ni assignedToUserId y no manda ningun mensaje: solo marca la ficha.
  Es best-effort: se llama desde un after() del webhook y nunca tira error hacia afuera.
  Misma forma que registrarOrigenMarketplace (src/lib/origen-marketplace.ts).
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
 * Marca al contacto como lead de la página web si este es su primer mensaje y trae
 * "vengo de magilus.com".
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
    // Un contacto bloqueado desde la bandeja no vuelve a aparecer por traer el texto de la web.
    if (contacto.bloqueadoEn) return;

    if (!input.contactoRecienCreado) {
      const entrantes = await prisma.message.count({
        where: { contactId: input.contactId, direction: "INBOUND" },
      });
      if (entrantes > 1) return;
    }

    const meta =
      contacto.metadata && typeof contacto.metadata === "object" && !Array.isArray(contacto.metadata)
        ? (contacto.metadata as Record<string, unknown>)
        : {};
    // El primer toque manda: no se re-escribe un origen ya guardado.
    const guardarOrigen = !meta.origen;

    await prisma.contact.update({
      where: { id: input.contactId },
      data: {
        // Visible en el CRM aunque haya entrado por la linea Admin.
        excludedFromCrm: false,
        ...(guardarOrigen
          ? {
              metadata: {
                ...meta,
                // crmOrigin es lo PRIMERO que lee el origen del CRM. No se pisa si ya hay uno.
                ...(meta.crmOrigin ? {} : { crmOrigin: "web" }),
                origen: { canal: "web" },
              } as Prisma.InputJsonValue,
            }
          : {}),
      },
    });

    const etiqueta = await asegurarEtiqueta(input.workspaceId);
    if (etiqueta) {
      await prisma.contactTag.createMany({
        data: [{ contactId: input.contactId, tagId: etiqueta.id, workspaceId: input.workspaceId }],
        skipDuplicates: true,
      });
    }

    console.log("[ORIGEN] web", { contactId: input.contactId, origenGuardado: guardarOrigen });
  } catch (error) {
    console.warn("[ORIGEN] web_failed", {
      contactId: input.contactId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
