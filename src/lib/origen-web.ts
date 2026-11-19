import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { detectarOrigenWeb } from "@/lib/origen-de-venta";

/*
  ORIGEN WEB: los clientes que llegan desde el botón de WhatsApp de la página magilus.com.

  El botón abre el chat con un texto pre-llenado que dice "vengo de magilus.com". Ese botón apunta
  a la línea administrativa, y los contactos que nacen en una línea ADMIN quedan ocultos del CRM
  (excludedFromCrm). Por eso, cuando ese texto entra como PRIMER mensaje de un contacto, aca:
    - se le pone la etiqueta "Web",
    - se guarda Contact.metadata.origen = { canal: "web" } y crmOrigin = "web" (si no había origen),
    - se deja excludedFromCrm = false, para que el chat se vea en el CRM.

  No toca la etapa (crmStage) ni la asesora asignada (assignedToUserId), y no manda nada por
  WhatsApp. Sin migracion: metadata es Json.

  Es best-effort: se llama desde un after() del webhook y nunca tira error hacia afuera.
*/

const TAG_SLUG = "web";
const TAG_NOMBRE = "Web";
const TAG_COLOR = "#0f766e";

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
 * Marca al contacto como lead de la página web si este es su primer mensaje y dice
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
    // Un contacto bloqueado se queda fuera del CRM: no se le cambia nada.
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
    const yaTeniaOrigen = Boolean(meta.origen);

    await prisma.contact.update({
      where: { id: input.contactId },
      data: {
        // Nació en la línea Admin pero es un cliente de la web: tiene que verse en el CRM.
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
                  fecha: new Date().toISOString(),
                  channelId: input.channelId,
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

    console.log("[ORIGEN] web", { contactId: input.contactId, yaTeniaOrigen });
  } catch (error) {
    console.warn("[ORIGEN] web_failed", {
      contactId: input.contactId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
