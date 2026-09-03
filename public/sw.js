const CACHE_NAME = "agente-lite-v5";
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
/*
  Una sola notificacion para todos los chats, como WhatsApp.

  Antes cada chat traia su propia tarjeta y a las 12 de la noche la pantalla de bloqueo quedaba
  con cinco o seis tarjetas iguales de app.aizenbot.com, una debajo de la otra. WhatsApp junta
  todo en una que dice "66 mensajes de 15 chats" y muestra las ultimas lineas; esto hace lo mismo.

  El navegador no tiene "grupos" de notificaciones como Android: lo que si se puede es guardar la
  cuenta DENTRO de la notificacion que ya esta en pantalla (data), leerla al llegar la siguiente y
  volver a mostrar UNA sola con el resumen actualizado. Si la asesora la desliza, se pierde la
  cuenta y vuelve a empezar de cero, que es exactamente lo que hace WhatsApp.
*/
const TAG_DEL_GRUPO = "chats-magilus";
const LINEAS_VISIBLES = 5;
const MAXIMO_DE_CHATS = 40;
// El salto de renglon entre una linea y otra del resumen.
const SALTO_DE_LINEA = String.fromCharCode(10);

/** El resumen que se muestra, a partir de lo acumulado. */
function armarResumen(mensajes, total) {
  if (mensajes.length === 1 && total === 1) {
    // Un solo mensaje: se ve igual que antes, con el nombre arriba y el texto abajo.
    return { titulo: mensajes[0].titulo, cuerpo: mensajes[0].cuerpo };
  }

  const chats = mensajes.length;
  const titulo =
    chats === 1
      ? `${total} mensajes de ${mensajes[0].titulo}`
      : `${total} mensajes de ${chats} chats`;

  /*
    Se muestran las ultimas, no las primeras.

    Con la pantalla llena de avisos lo que importa es lo ultimo que entro; lo viejo ya se vio o ya
    no alcanza a leerse.
  */
  const cuerpo = mensajes
    .slice(-LINEAS_VISIBLES)
    .map((mensaje) => `${mensaje.titulo}: ${mensaje.cuerpo}`.trim())
    .join(SALTO_DE_LINEA);

  return { titulo, cuerpo };
}

/** Suma el mensaje nuevo a lo que ya estaba en pantalla. */
async function acumularMensaje(entrada) {
  let mensajes = [];
  let total = 0;

  try {
    const enPantalla = await self.registration.getNotifications({ tag: TAG_DEL_GRUPO });
    const anterior = enPantalla[0] && enPantalla[0].data;
    if (anterior && Array.isArray(anterior.mensajes)) {
      mensajes = anterior.mensajes;
      total = typeof anterior.total === "number" ? anterior.total : mensajes.length;
    }

    /*
      Se cierran las anteriores a mano.

      El mismo tag deberia REEMPLAZAR la tarjeta que ya estaba, y en Android asi es. En el iPhone
      (probado en iOS 18) no: la vieja se queda y la nueva se apila debajo, asi que quedaban dos
      tarjetas -"2 mensajes de X" y arriba "3 mensajes de 2 chats"- diciendo lo mismo dos veces.
      Cerrarlas explicitamente deja UNA sola en cualquier telefono, que es lo que se pidio.
    */
    for (const notificacion of enPantalla) {
      notificacion.close();
    }
  } catch (error) {
    // Si no se puede leer lo anterior, se arranca de cero: mejor una notificacion suelta que ninguna.
  }

  // Un chat ocupa UN renglon: si el mismo cliente manda tres mensajes, se ve el ultimo, pero
  // los tres cuentan para el numero de arriba. Igual que WhatsApp.
  mensajes = mensajes.filter((mensaje) => mensaje.chat !== entrada.chat);
  mensajes.push(entrada);
  total += 1;

  // Un techo, para que la lista no crezca sin fin viajando adentro de la notificacion. Pasados
  // 40 chats sin leer el numero exacto ya no le dice nada a nadie.
  if (mensajes.length > MAXIMO_DE_CHATS) {
    mensajes = mensajes.slice(-MAXIMO_DE_CHATS);
  }

  return { mensajes, total };
}

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (error) {
    // Si el cuerpo no es JSON válido, lo tratamos como texto plano del body.
    payload = { body: event.data ? event.data.text() : "" };
  }

  const entrada = {
    // El tag que manda el servidor identifica el chat: es lo que hace que dos mensajes del mismo
    // cliente no ocupen dos renglones.
    chat: payload.tag || "chat",
    titulo: payload.title || "Nuevo mensaje",
    cuerpo: payload.body || "",
  };
  const url = payload.url || "/cliente/chats";
  const icon = payload.icon || "/icon?size=192";
  const badge = payload.badge || "/icon?size=192";

  /**
   * Si la app esta ABIERTA Y A LA VISTA, no se muestra la notificacion del sistema.
   *
   * Sonaba doble: la pagina reproduce su propio sonido al llegar el mensaje y ademas el Service
   * Worker mostraba la notificacion, que suena por su cuenta. Con la app en la mano eso es ruido
   * (ya estas viendo el mensaje llegar); con la app en segundo plano o cerrada, la notificacion
   * es lo unico que avisa, y ahi si tiene que salir.
   *
   * Se mira visibilityState y no si hay clientes: una pestaña abierta pero tapada por WhatsApp
   * no esta a la vista, y ahi la asesora SI necesita el aviso.
   */
  const mostrar = async () => {
    const clientList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    if (clientList.some((client) => client.visibilityState === "visible")) {
      return undefined;
    }

    const { mensajes, total } = await acumularMensaje(entrada);
    const { titulo, cuerpo } = armarResumen(mensajes, total);

    return self.registration.showNotification(titulo, {
      body: cuerpo,
      // UN solo tag para todos los chats: cada mensaje nuevo REEMPLAZA la tarjeta anterior con el
      // resumen al dia, en vez de apilar una tarjeta por cliente.
      tag: TAG_DEL_GRUPO,
      renotify: true,
      icon,
      badge,
      // Vibración tipo mensajería (patrón corto) en dispositivos que la soportan.
      vibrate: [120, 60, 120],
      data: { url, mensajes, total },
    });
  };

  event.waitUntil(mostrar().catch(() => undefined));
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
