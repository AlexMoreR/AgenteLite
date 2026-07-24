const CACHE_NAME = "agente-lite-v4";
const APP_SHELL = ["/", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(() => undefined),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
          return Promise.resolve();
        }),
      ),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  // Nunca interceptar/cachear la API: son datos dinámicos (chats, mensajes, contadores).
  // Con cache-first el Service Worker servía respuestas viejas para siempre y dejaba la
  // UI congelada (el polling recibía la primera respuesta cacheada y el realtime "no
  // aparecía" hasta recargar). Dejamos que estas peticiones vayan directo a la red.
  if (url.pathname.startsWith("/api/")) {
    return;
  }

  // /_next/static/ son archivos con HASH en el nombre: inmutables (el hash cambia en cada deploy).
  // Ahí cache-first es correcto Y rápido, y nunca sirve una versión vieja porque el HTML nuevo
  // referencia hashes nuevos.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) {
          return cached;
        }
        return fetch(request).then((response) => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone)).catch(() => undefined);
          }
          return response;
        });
      }),
    );
    return;
  }

  // TODO lo demás (HTML/navegación y assets sin hash): NETWORK-FIRST. Siempre trae la última
  // versión desplegada; el cache es SOLO respaldo offline. Antes esto era cache-first y el
  // Service Worker servía JS/HTML viejos para SIEMPRE aunque se desplegara: el equipo quedaba
  // corriendo código viejo ("los cambios no salen") con bugs ya arreglados sin enterarse.
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone)).catch(() => undefined);
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) {
          return cached;
        }
        if (request.mode === "navigate") {
          return caches.match("/");
        }
        return Response.error();
      }),
  );
});

// --- Web Push: notificaciones "tipo WhatsApp" con la app cerrada o en segundo plano ---
// El servidor (src/lib/web-push.ts) empuja un JSON con { title, body, tag, url, icon }.
// Aquí el Service Worker muestra la notificación del sistema, que suena/vibra de forma
// NATIVA aunque el JavaScript de la página esté congelado.
self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (error) {
    // Si el cuerpo no es JSON válido, lo tratamos como texto plano del body.
    payload = { body: event.data ? event.data.text() : "" };
  }

  const title = payload.title || "Nuevo mensaje";
  const options = {
    body: payload.body || "",
    // Mismo tag = reemplaza la notificación anterior del mismo chat en vez de apilar.
    tag: payload.tag || "chat",
    renotify: true,
    icon: payload.icon || "/icon?size=192",
    badge: payload.badge || "/icon?size=192",
    // Vibración tipo mensajería (patrón corto) en dispositivos que la soportan.
    vibrate: [120, 60, 120],
    data: { url: payload.url || "/cliente/chats" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Al tocar la notificación: enfoca una pestaña abierta de la app o abre una nueva
// en la ruta indicada (por defecto, el módulo de chats).
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "/cliente/chats";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) {
          client.focus();
          if ("navigate" in client) {
            client.navigate(targetUrl).catch(() => undefined);
          }
          return undefined;
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
      return undefined;
    }),
  );
});
