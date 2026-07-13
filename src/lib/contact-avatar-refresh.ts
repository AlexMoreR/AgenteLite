import { after } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { fetchEvolutionProfilePictureUrl } from "@/lib/evolution";

// Cache "on-demand" de las fotos de perfil de WhatsApp por contacto.
// Las URLs de foto de Evolution/WhatsApp son temporales (expiran), por eso guardamos
// cuándo se pidió la última vez en Contact.metadata.avatarFetchedAt y refrescamos por TTL.
const AVATAR_TTL_MS = 12 * 60 * 60 * 1000; // con foto: refresca cada 12h (las URLs de Meta expiran)
const AVATAR_RETRY_MS = 3 * 60 * 60 * 1000; // sin foto todavía / fallo: reintenta cada 3h
const MAX_PER_RUN = 4; // pocas por ejecución: Evolution GO es sensible a la carga en su Postgres
// Cooldown global (por instancia del server): aunque la lista se refresque muy seguido, el
// refresco de avatares corre como máximo una vez cada 5 min para no saturar a evogo.
const GLOBAL_COOLDOWN_MS = 5 * 60 * 1000;

let lastAvatarRunAt = 0;

// Cortacircuitos: evogo puede tardar ~75s y devolver 500 en /user/avatar cuando WhatsApp
// limita las consultas de foto (GetProfilePictureInfo "info query timed out"). Cortamos
// nuestras peticiones a los FETCH_TIMEOUT_MS y, si fallan varias seguidas, pausamos TODO el
// refresco de avatares un rato para no seguir golpeando a evogo.
const FETCH_TIMEOUT_MS = 8000;
const CIRCUIT_FAILURE_THRESHOLD = 3;
const CIRCUIT_PAUSE_MS = 30 * 60 * 1000;
let avatarConsecutiveFailures = 0;
let avatarCircuitPausedUntil = 0;

// ok=false = la petición falló/expiró (evogo/WhatsApp); distinto de ok=true con url=null
// (el contacto simplemente no tiene foto).
async function fetchAvatarWithTimeout(
  target: ContactAvatarTarget,
): Promise<{ ok: boolean; url: string | null }> {
  try {
    const url = await Promise.race([
      fetchEvolutionProfilePictureUrl({ instanceName: target.instanceName, phoneNumber: target.phoneNumber }),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("avatar-timeout")), FETCH_TIMEOUT_MS);
      }),
    ]);
    return { ok: true, url };
  } catch {
    return { ok: false, url: null };
  }
}

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

  // No saturar a evogo: como máximo una corrida cada GLOBAL_COOLDOWN_MS por instancia.
  const now = Date.now();
  if (now - lastAvatarRunAt < GLOBAL_COOLDOWN_MS) {
    return;
  }
  lastAvatarRunAt = now;

  after(async () => {
    try {
      await refreshContactAvatars(targets);
    } catch {
      // silencioso a propósito: es un mejor-esfuerzo en segundo plano
    }
  });
}

// Al abrir un chat reintentamos la foto de ESE contacto sin esperar el TTL largo, para que
// aparezca pronto (es un solo contacto, bajo costo para evogo).
const SINGLE_NO_PHOTO_RETRY_MS = 15 * 60 * 1000;

/**
 * Refresca la foto de UN contacto (el de la conversación abierta) SALTANDO el cooldown global.
 * Bajo costo (un solo contacto) y con TTL corto para que la foto se vea pronto en el CRM.
 */
export function scheduleSingleContactAvatarRefresh(target: ContactAvatarTarget) {
  if (!target.contactId || !target.phoneNumber || !target.instanceName) {
    return;
  }

  after(async () => {
    try {
      await refreshContactAvatars([target], { noPhotoRetryMs: SINGLE_NO_PHOTO_RETRY_MS, maxPerRun: 1 });
    } catch {
      // best-effort
    }
  });
}

async function refreshContactAvatars(
  targets: ContactAvatarTarget[],
  options: { noPhotoRetryMs?: number; maxPerRun?: number } = {},
) {
  const noPhotoRetryMs = options.noPhotoRetryMs ?? AVATAR_RETRY_MS;
  const maxPerRun = options.maxPerRun ?? MAX_PER_RUN;
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

  // Cortacircuitos: si evogo viene fallando en /user/avatar, no insistimos por un rato.
  if (Date.now() < avatarCircuitPausedUntil) {
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
      // Si ya tiene foto, refrescamos cada 12h; si aún no, según el TTL de reintento.
      const ttl = contact.avatarUrl ? AVATAR_TTL_MS : noPhotoRetryMs;
      return now - fetchedAt > ttl;
    })
    .slice(0, maxPerRun);

  for (const contact of stale) {
    const target = byId.get(contact.id);
    if (!target) {
      continue;
    }

    const result = await fetchAvatarWithTimeout(target);

    if (!result.ok) {
      // Falla/timeout de evogo: NO marcamos fetchedAt (para reintentar cuando reabra el
      // circuito) y contamos para el cortacircuitos.
      avatarConsecutiveFailures += 1;
      if (avatarConsecutiveFailures >= CIRCUIT_FAILURE_THRESHOLD) {
        avatarConsecutiveFailures = 0;
        avatarCircuitPausedUntil = Date.now() + CIRCUIT_PAUSE_MS;
        break; // evogo está fallando: dejamos de insistir por un rato
      }
      continue;
    }

    avatarConsecutiveFailures = 0;
    const meta = readMetadataObject(contact.metadata);
    const nextMetadata = { ...meta, avatarFetchedAt: new Date(now).toISOString() };

    await prisma.contact.update({
      where: { id: contact.id },
      // Solo sobreescribimos la foto si conseguimos una nueva; si no (sin foto), mantenemos la
      // anterior y solo marcamos el intento para respetar el TTL.
      data: result.url
        ? { avatarUrl: result.url, metadata: nextMetadata as Prisma.InputJsonValue }
        : { metadata: nextMetadata as Prisma.InputJsonValue },
    });
  }
}
