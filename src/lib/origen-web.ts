import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { detectarOrigenWeb } from "@/lib/origen-de-venta";

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
 * Lo que comparten el registro en vivo y el arreglo de una sola vez: deja al contacto visible en el
 * CRM, guarda el origen web (solo si no tenía uno) y le pone la etiqueta "Web". Devuelve si ya tenía origen.
 */
async function marcarComoWeb(input: {
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
  return yaTeniaOrigen;
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

    const yaTeniaOrigen = await marcarComoWeb({
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
  ARREGLO DE UNA SOLA VEZ (parte 4): los chats web que entraron por la línea administrativa ANTES de
  que existiera registrarOrigenWeb quedaron ocultos del CRM (excludedFromCrm) y sin etiqueta.

  Busca los contactos ocultos y no bloqueados cuyo PRIMER mensaje entrante en una línea ADMIN de
  Evolution es del 16-sep-2026 en adelante y trae el texto de la página web. A cada uno lo deja
  visible, con la etiqueta "Web" y el origen web (solo si no tenía origen). No toca la etapa ni la
  asesora, no borra nada y NO manda ningún mensaje.

  Lo llama el reloj de cada minuto (api/cron/follows). Al terminar deja la marca
  `arreglo_chats_web_60d` en AppSetting con { fecha, cantidad, contactIds }: con la marca puesta,
  cada vuelta es una sola lectura y sale. Nunca tira error hacia afuera.
*/

export const CLAVE_ARREGLO_CHATS_WEB = "arreglo_chats_web_60d";

/** Desde el 16-sep-2026 00:00 en Colombia (05:00 UTC): unos 60 días antes del arreglo. */
export const DESDE_ARREGLO_CHATS_WEB = new Date("2026-09-16T05:00:00.000Z");

type PrimerMensajeAdmin = {
  contactId: string;
  workspaceId: string;
  channelId: string | null;
  content: string | null;
  createdAt: Date;
  metadata: Prisma.JsonValue | null;
};

// En el mismo proceso, dos vueltas del reloj no corren el arreglo a la vez.
let arregloCorriendo = false;

export async function arreglarChatsWebViejos(): Promise<{ cantidad: number; contactIds: string[] } | null> {
  if (arregloCorriendo) return null;
  arregloCorriendo = true;
  try {
    const marca = await prisma.appSetting.findUnique({
      where: { key: CLAVE_ARREGLO_CHATS_WEB },
      select: { key: true },
    });
    if (marca) return null;

    // El primer mensaje entrante de cada contacto oculto en una línea ADMIN de Evolution.
    const primeros = await prisma.$queryRaw<PrimerMensajeAdmin[]>`
      SELECT DISTINCT ON (m."contactId")
        m."contactId", m."workspaceId", m."channelId", m."content", m."createdAt", c."metadata"
      FROM "Message" m
      JOIN "WhatsAppChannel" w ON w."id" = m."channelId"
      JOIN "Contact" c ON c."id" = m."contactId"
      WHERE m."direction" = 'INBOUND'
        AND w."purpose" = 'ADMIN'
        AND w."provider" = 'EVOLUTION'
        AND c."excludedFromCrm" = true
        AND c."bloqueadoEn" IS NULL
      ORDER BY m."contactId", m."createdAt" ASC
    `;

    const candidatos = primeros.filter(
      (fila) => new Date(fila.createdAt) >= DESDE_ARREGLO_CHATS_WEB && detectarOrigenWeb(fila.content),
    );

    const contactIds: string[] = [];
    for (const fila of candidatos) {
      try {
        await marcarComoWeb({
          workspaceId: fila.workspaceId,
          contactId: fila.contactId,
          channelId: fila.channelId,
          metadata: fila.metadata,
          fecha: new Date(fila.createdAt),
        });
        contactIds.push(fila.contactId);
      } catch (error) {
        // Uno que falla no frena a los demás.
        console.warn("[ORIGEN] arreglo_web_contacto_failed", {
          contactId: fila.contactId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const resultado = { fecha: new Date().toISOString(), cantidad: contactIds.length, contactIds };
    try {
      await prisma.appSetting.create({
        data: { key: CLAVE_ARREGLO_CHATS_WEB, value: JSON.stringify(resultado) },
      });
    } catch (error) {
      // Otra vuelta ya la escribió (clave única): queda la primera.
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
    }

    console.log("[ORIGEN] arreglo_web", { cantidad: contactIds.length, revisados: primeros.length });
    return { cantidad: contactIds.length, contactIds };
  } catch (error) {
    console.warn("[ORIGEN] arreglo_web_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  } finally {
    arregloCorriendo = false;
  }
}
