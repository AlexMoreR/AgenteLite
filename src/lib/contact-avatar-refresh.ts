import { after } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { fetchEvolutionProfilePictureUrl } from "@/lib/evolution";

// Cache "on-demand" de las fotos de perfil de WhatsApp por contacto.
// Las URLs de foto de Evolution/WhatsApp son temporales (expiran), por eso guardamos
// cuándo se pidió la última vez en Contact.metadata.avatarFetchedAt y refrescamos por TTL.
const AVATAR_TTL_MS = 12 * 60 * 60 * 1000; // con foto: refresca cada 12h (las URLs de Meta expiran)
const AVATAR_RETRY_MS = 60 * 60 * 1000; // sin foto todavía / fallo: reintenta cada 1h
const MAX_PER_RUN = 12; // como máximo una página de contactos por ejecución

export type ContactAvatarTarget = {
  contactId: string;
  phoneNumber: string;
  instanceName: string;
};

function readMetadataObject(value: Prisma.JsonValue | null): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Programa (en segundo plano, tras enviar la respuesta) el refresco de avatares para los
 * contactos visibles que no tengan foto o cuya foto esté vencida. Es best-effort: si algo
 * falla, se ignora silenciosamente y la UI sigue mostrando el avatar genérico.
 */
export function scheduleContactAvatarRefresh(targets: ContactAvatarTarget[]) {
  if (!targets.length) {
    return;
  }

  after(async () => {
    try {
      await refreshContactAvatars(targets);
    } catch {
      // silencioso a propósito: es un mejor-esfuerzo en segundo plano
    }
  });
}

async function refreshContactAvatars(targets: ContactAvatarTarget[]) {
  const byId = new Map<string, ContactAvatarTarget>();
  for (const target of targets) {
    if (target.contactId && target.phoneNumber && target.instanceName && !byId.has(target.contactId)) {
      byId.set(target.contactId, target);
    }
  }

  const ids = Array.from(byId.keys());
  if (!ids.length) {
    return;
  }

  const contacts = await prisma.contact.findMany({
    where: { id: { in: ids } },
    select: { id: true, avatarUrl: true, metadata: true },
  });

  const now = Date.now();
  const stale = contacts
    .filter((contact) => {
      const meta = readMetadataObject(contact.metadata);
      const fetchedAtRaw = meta.avatarFetchedAt;
      const fetchedAt = typeof fetchedAtRaw === "string" ? Date.parse(fetchedAtRaw) : NaN;
      if (Number.isNaN(fetchedAt)) {
        return true; // nunca se intentó
      }
      // Si ya tiene foto, refrescamos cada 12h; si aún no, reintentamos cada 1h.
      const ttl = contact.avatarUrl ? AVATAR_TTL_MS : AVATAR_RETRY_MS;
      return now - fetchedAt > ttl;
    })
    .slice(0, MAX_PER_RUN);

  for (const contact of stale) {
    const target = byId.get(contact.id);
    if (!target) {
      continue;
    }

    let url: string | null = null;
    try {
      url = await fetchEvolutionProfilePictureUrl({
        instanceName: target.instanceName,
        phoneNumber: target.phoneNumber,
      });
    } catch {
      url = null;
    }

    const meta = readMetadataObject(contact.metadata);
    const nextMetadata = { ...meta, avatarFetchedAt: new Date(now).toISOString() };

    await prisma.contact.update({
      where: { id: contact.id },
      // Solo sobreescribimos la foto si conseguimos una nueva; si no, mantenemos la anterior
      // y solo marcamos el intento para respetar el TTL.
      data: url
        ? { avatarUrl: url, metadata: nextMetadata as Prisma.InputJsonValue }
        : { metadata: nextMetadata as Prisma.InputJsonValue },
    });
  }
}
