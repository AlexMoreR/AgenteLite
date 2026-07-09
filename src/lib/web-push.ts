// Envío de notificaciones Web Push (VAPID) del lado servidor.
//
// Permite que la PWA suene/vibre y muestre el mensaje "tipo WhatsApp" AUNQUE esté
// cerrada o en segundo plano, algo que la notificación del navegador (new Notification)
// no puede hacer porque su JavaScript queda congelado. Aquí el servidor empuja la
// notificación al Service Worker de cada dispositivo suscrito.
//
// Requiere las variables VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY y VAPID_SUBJECT.
import webpush from "web-push";
import { prisma } from "@/lib/prisma";

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY?.trim() || "";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY?.trim() || "";
// `mailto:` o URL de contacto que exige el estándar VAPID. Fallback razonable.
const VAPID_SUBJECT = process.env.VAPID_SUBJECT?.trim() || "mailto:soporte@agentelite.app";

let vapidConfigured = false;

export function isWebPushConfigured(): boolean {
  return Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
}

export function getVapidPublicKey(): string {
  return VAPID_PUBLIC_KEY;
}

function ensureVapidConfigured(): boolean {
  if (!isWebPushConfigured()) {
    return false;
  }
  if (!vapidConfigured) {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    vapidConfigured = true;
  }
  return true;
}

export type WebPushNotificationPayload = {
  title: string;
  body: string;
  // Agrupa notificaciones del mismo chat (reemplaza la anterior en vez de apilar).
  tag?: string;
  // Ruta a abrir al tocar la notificación (p. ej. /cliente/chats).
  url?: string;
  icon?: string;
  badge?: string;
};

type StoredSubscription = { id: string; endpoint: string; p256dh: string; auth: string };

// Envía el payload a una lista de suscripciones y poda las caducadas (404/410).
async function deliverToSubscriptions(
  subscriptions: StoredSubscription[],
  payload: WebPushNotificationPayload,
): Promise<number> {
  if (subscriptions.length === 0) {
    return 0;
  }

  const body = JSON.stringify(payload);
  const staleSubscriptionIds: string[] = [];
  let delivered = 0;

  await Promise.all(
    subscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          },
          body,
          { TTL: 60 },
        );
        delivered += 1;
      } catch (error) {
        const statusCode =
          error && typeof error === "object" && "statusCode" in error
            ? (error as { statusCode?: number }).statusCode
            : undefined;
        // 404/410 = suscripción caducada o revocada por el navegador → eliminarla.
        if (statusCode === 404 || statusCode === 410) {
          staleSubscriptionIds.push(subscription.id);
        } else {
          console.warn("[web-push] send_failed", {
            endpoint: subscription.endpoint.slice(0, 48),
            statusCode: statusCode ?? null,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }),
  );

  if (staleSubscriptionIds.length > 0) {
    await prisma.webPushSubscription
      .deleteMany({ where: { id: { in: staleSubscriptionIds } } })
      .catch(() => undefined);
  }

  return delivered;
}

/**
 * Envía una notificación push a TODOS los dispositivos suscritos de un workspace.
 * Es best-effort: nunca lanza. Devuelve cuántos envíos tuvieron éxito.
 */
export async function sendChatPushToWorkspace(input: {
  workspaceId: string;
  payload: WebPushNotificationPayload;
  // Opcional: no notificar a este usuario (p. ej. quien envió el mensaje saliente).
  excludeUserId?: string | null;
}): Promise<number> {
  if (!ensureVapidConfigured()) {
    return 0;
  }

  const subscriptions = await prisma.webPushSubscription.findMany({
    where: {
      workspaceId: input.workspaceId,
      ...(input.excludeUserId ? { userId: { not: input.excludeUserId } } : {}),
    },
    select: { id: true, endpoint: true, p256dh: true, auth: true },
  });

  return deliverToSubscriptions(subscriptions, input.payload);
}

/**
 * Envía una notificación push solo a los dispositivos de UN usuario. Se usa para el
 * botón "Probar" del interruptor de notificaciones. Devuelve cuántos envíos hubo.
 */
export async function sendPushToUser(input: {
  userId: string;
  payload: WebPushNotificationPayload;
}): Promise<number> {
  if (!ensureVapidConfigured()) {
    return 0;
  }

  const subscriptions = await prisma.webPushSubscription.findMany({
    where: { userId: input.userId },
    select: { id: true, endpoint: true, p256dh: true, auth: true },
  });

  return deliverToSubscriptions(subscriptions, input.payload);
}
