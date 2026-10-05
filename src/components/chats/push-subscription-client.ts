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

/*
  UNA vez por sesion, no en cada tecla.

  Esto corria con cada clic y cada tecla de cualquier pantalla: dos peticiones al servidor por
  tecla (la llave publica y el guardado). Medido el 05-10-2026: 3.900 registros en una mañana desde
  la oficina, y como cada uno ocupa una de las 10 conexiones a la base, el servidor entero se
  trababa en rafagas -abrir un chat llego a tardar 20 s-.

  La direccion de la suscripcion casi nunca cambia. Se guarda en el servidor la primera vez de
  cada sesion del navegador, y despues solo si cambia.
*/
const CLAVE_YA_GUARDADA = "push:direccion-guardada";

function direccionYaGuardada(): string | null {
  try {
    return sessionStorage.getItem(CLAVE_YA_GUARDADA);
  } catch {
    return null;
  }
}

function anotarDireccionGuardada(direccion: string) {
  try {
    sessionStorage.setItem(CLAVE_YA_GUARDADA, direccion);
  } catch {
    // Sin almacenamiento solo se pierde el atajo: se vuelve a guardar en la proxima sesion.
  }
}

/**
 * Crea/renueva la suscripción push del dispositivo y la guarda en el servidor.
 * Asume que el permiso YA está concedido (Notification.permission === "granted").
 * Con `forzar` se guarda aunque ya se haya guardado en esta sesion (el interruptor de Ajustes).
 */
export async function subscribeToPush(opciones: { forzar?: boolean } = {}): Promise<PushActionResult> {
  if (!isPushSupported()) {
    return { ok: false, reason: "unsupported" };
  }
  if (Notification.permission !== "granted") {
    return { ok: false, reason: "denied" };
  }

  try {
    const registration = await navigator.serviceWorker.ready;

    const existente = await registration.pushManager.getSubscription();
    if (existente && !opciones.forzar && direccionYaGuardada() === existente.endpoint) {
      return { ok: true };
    }

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

    let subscription = existente;
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

    if (json.endpoint) {
      anotarDireccionGuardada(json.endpoint);
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

  // Lo pidio la persona (el interruptor, el aviso o el primer permiso): se guarda siempre.
  return subscribeToPush({ forzar: true });
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
    try {
      sessionStorage.removeItem(CLAVE_YA_GUARDADA);
    } catch {
      // nada que limpiar
    }
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
