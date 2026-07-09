// Lógica cliente compartida para suscribir/desuscribir este dispositivo a Web Push.
// La usan tanto PushSubscriptionManager (automático, tras un gesto) como el interruptor
// visible en Ajustes (NotificationPermissionToggle).

export type PushActionResult = {
  ok: boolean;
  // Motivo de fallo, para mostrar un mensaje útil al usuario.
  reason?: "unsupported" | "denied" | "dismissed" | "not-configured" | "server" | "error";
};

export function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    typeof Notification !== "undefined"
  );
}

// Convierte la llave pública VAPID (base64url) al Uint8Array que exige
// pushManager.subscribe como applicationServerKey.
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * Crea/renueva la suscripción push del dispositivo y la guarda en el servidor.
 * Asume que el permiso YA está concedido (Notification.permission === "granted").
 */
export async function subscribeToPush(): Promise<PushActionResult> {
  if (!isPushSupported()) {
    return { ok: false, reason: "unsupported" };
  }
  if (Notification.permission !== "granted") {
    return { ok: false, reason: "denied" };
  }

  try {
    const registration = await navigator.serviceWorker.ready;

    const keyResponse = await fetch("/api/push/public-key", {
      credentials: "same-origin",
      cache: "no-store",
    });
    const keyData = (await keyResponse.json().catch(() => null)) as
      | { ok?: boolean; configured?: boolean; publicKey?: string | null }
      | null;
    if (!keyData?.ok || !keyData.configured || !keyData.publicKey) {
      return { ok: false, reason: "not-configured" };
    }

    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(keyData.publicKey) as BufferSource,
      });
    }

    const json = subscription.toJSON();
    const saveResponse = await fetch("/api/push/subscribe", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
    });
    if (!saveResponse.ok) {
      return { ok: false, reason: "server" };
    }

    return { ok: true };
  } catch {
    return { ok: false, reason: "error" };
  }
}

/**
 * Pide permiso de notificaciones (si hace falta) y luego suscribe. Debe llamarse desde
 * un gesto del usuario (clic), como exigen los navegadores móviles.
 */
export async function requestPermissionAndSubscribe(): Promise<PushActionResult> {
  if (!isPushSupported()) {
    return { ok: false, reason: "unsupported" };
  }

  let permission = Notification.permission;
  if (permission === "default") {
    try {
      permission = await Notification.requestPermission();
    } catch {
      return { ok: false, reason: "error" };
    }
  }

  if (permission !== "granted") {
    return { ok: false, reason: permission === "denied" ? "denied" : "dismissed" };
  }

  return subscribeToPush();
}

/** Elimina la suscripción de este dispositivo (local y en el servidor). */
export async function unsubscribeFromPush(): Promise<void> {
  if (!isPushSupported()) {
    return;
  }
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      return;
    }
    const json = subscription.toJSON();
    await fetch("/api/push/subscribe", {
      method: "DELETE",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: json.endpoint }),
    }).catch(() => undefined);
    await subscription.unsubscribe().catch(() => undefined);
  } catch {
    // best-effort
  }
}

/** Indica si este dispositivo ya tiene una suscripción push activa. */
export async function getIsSubscribed(): Promise<boolean> {
  if (!isPushSupported()) {
    return false;
  }
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    return Boolean(subscription);
  } catch {
    return false;
  }
}
