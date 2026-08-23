import { prisma } from "@/lib/prisma";

/**
 * WaCalls: las llamadas de WhatsApp que salen desde el CRM.
 *
 * El marcador vive en su propio servicio y se muestra EMBEBIDO dentro de la app. Para que eso
 * funcione, la dirección tiene que ser un subdominio del MISMO dominio que el CRM
 * (call.aizenbot.com junto a app.aizenbot.com): la sesión de WaCalls usa una cookie
 * `SameSite=Strict`, y desde un dominio ajeno el navegador no la manda, así que la asesora nunca
 * lograría quedar conectada dentro del recuadro.
 *
 * Sin `WACALLS_URL` configurada, el módulo simplemente no ofrece el marcador. No se rompe nada:
 * el registro de llamadas por webhook es independiente de esto.
 */

export function getWaCallsBaseUrl(): string | null {
  const url = process.env.WACALLS_URL?.trim();
  if (!url) {
    return null;
  }
  return url.replace(/\/+$/, "");
}

/**
 * La dirección del marcador, con el número ya puesto si lo hay.
 *
 * El `?to=` lo entiende nuestra imagen de WaCalls (parche propio, ver /opt/wacalls-build/parches).
 * Si algún día se usara una imagen sin ese parche, el marcador abre igual: solo que vacío.
 */
export function buildWaCallsDialerUrl(phone?: string | null): string | null {
  const base = getWaCallsBaseUrl();
  if (!base) {
    return null;
  }

  // Solo dígitos y el +: lo que llega es un teléfono guardado por otra gente, y va derecho a una
  // URL que se mete en un iframe.
  const limpio = (phone ?? "").replace(/[^0-9+]/g, "").slice(0, 20);
  return limpio ? `${base}/?to=${encodeURIComponent(limpio)}` : base;
}

/**
 * Una llamada a la API de WaCalls, hecha SIEMPRE desde el servidor.
 *
 * El token no puede viajar al navegador: con él se puede llamar a cualquier número desde la línea
 * del negocio. Por eso el marcador del CRM no habla con WaCalls directo, sino contra nuestras
 * rutas, que son las que ponen el token acá.
 *
 * `operadorId` viaja como `X-Client-Id` y es lo que WaCalls devuelve después en el webhook como
 * dueño de la llamada: es lo que permite registrar QUIÉN llamó, en vez de dejarlo en blanco.
 */
export async function waCallsRequest<T>(input: {
  path: string;
  method?: "GET" | "POST" | "DELETE";
  body?: unknown;
  operadorId?: string;
  timeoutMs?: number;
}): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string }> {
  const base = getWaCallsBaseUrl();
  const token = process.env.WACALLS_API_TOKEN?.trim();
  if (!base || !token) {
    return { ok: false, status: 503, error: "El servicio de llamadas no está configurado." };
  }

  try {
    const response = await fetch(`${base}${input.path}`, {
      method: input.method ?? "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(input.operadorId ? { "X-Client-Id": input.operadorId } : {}),
      },
      body: input.body === undefined ? undefined : JSON.stringify(input.body),
      cache: "no-store",
      // El intercambio de audio tarda más que una consulta cualquiera: la línea tiene que
      // negociar con WhatsApp antes de contestar.
      signal: AbortSignal.timeout(input.timeoutMs ?? 15000),
    });

    const texto = await response.text();
    const data = texto ? (JSON.parse(texto) as T) : ({} as T);
    if (!response.ok) {
      const mensaje =
        (data as { error?: string })?.error?.trim() || "El servicio de llamadas rechazó la operación.";
      return { ok: false, status: response.status, error: mensaje };
    }
    return { ok: true, data };
  } catch {
    return { ok: false, status: 504, error: "El servicio de llamadas no respondió." };
  }
}

/** Donde vive, en el metadata del canal, la linea de llamadas que le corresponde. */
export const WACALLS_SESSION_METADATA_KEY = "wacallsSessionId";

export function leerSesionDeLlamadas(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }
  const valor = (metadata as Record<string, unknown>)[WACALLS_SESSION_METADATA_KEY];
  return typeof valor === "string" && valor.trim() ? valor.trim() : null;
}

/**
 * La linea de llamadas de UN canal.
 *
 * Cada canal tiene la suya, vinculada con su propio QR, para que la llamada salga del MISMO
 * numero con el que el cliente viene chateando. Con una sola linea global, alguien que hablaba
 * con Ventas 1 recibia la llamada desde el administrativo y no reconocia quien lo llamaba.
 */
export async function getWaCallsSessionIdForChannel(channelId: string | null): Promise<string | null> {
  if (!channelId) {
    return null;
  }
  const canal = await prisma.whatsAppChannel
    .findUnique({ where: { id: channelId }, select: { metadata: true } })
    .catch(() => null);
  return leerSesionDeLlamadas(canal?.metadata ?? null);
}

/**
 * El id de una linea cualquiera, para cuando no se sabe de que canal viene la llamada.
 *
 * Es el ultimo recurso —marcar desde un lugar que no conoce el canal— y no el camino normal.
 */
export async function getWaCallsSessionId(): Promise<string | null> {
  const respuesta = await waCallsRequest<{ sessions?: Array<{ id?: string; paired?: boolean }> }>({
    path: "/api/sessions",
    timeoutMs: 5000,
  });
  if (!respuesta.ok) {
    return null;
  }
  const sesion = respuesta.data.sessions?.find((s) => s.paired !== false) ?? respuesta.data.sessions?.[0];
  return sesion?.id?.trim() || null;
}

/** El estado de la linea de llamadas de un canal, para dibujarlo en su pantalla. */
export async function getEstadoDeCanal(channelId: string): Promise<WaCallsEstado | null> {
  const sid = await getWaCallsSessionIdForChannel(channelId);
  if (!sid) {
    return null;
  }
  const respuesta = await waCallsRequest<{
    sessions?: Array<{ id?: string; name?: string; jid?: string; state?: string; paired?: boolean }>;
  }>({ path: "/api/sessions", timeoutMs: 4000 });
  if (!respuesta.ok) {
    return null;
  }
  const sesion = respuesta.data.sessions?.find((s) => s.id === sid);
  if (!sesion) {
    return null;
  }
  return {
    numero: sesion.jid?.split(/[:@]/)[0]?.trim() || null,
    nombre: sesion.name?.trim() || null,
    conectado: sesion.state === "open" && sesion.paired !== false,
  };
}

export type WaCallsEstado = {
  /** El número de WhatsApp vinculado, listo para mostrar. */
  numero: string | null;
  nombre: string | null;
  conectado: boolean;
};

/**
 * El estado de la línea de llamadas, para mostrarlo junto a las demás conexiones.
 *
 * Ante CUALQUIER problema devuelve null y la tarjeta no se dibuja. Es a propósito: esto es un
 * adorno informativo dentro de la pantalla de Conexión, y un servicio de llamadas caído no puede
 * llevarse puesta la pantalla desde la que se arreglan las conexiones de WhatsApp.
 */
export async function getWaCallsEstado(): Promise<WaCallsEstado | null> {
  const base = getWaCallsBaseUrl();
  const token = process.env.WACALLS_API_TOKEN?.trim();
  if (!base || !token) {
    return null;
  }

  try {
    const response = await fetch(`${base}/api/sessions`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      // La pantalla de Conexión no puede quedarse esperando a un servicio que no responde.
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as {
      sessions?: Array<{ name?: string; jid?: string; state?: string; paired?: boolean }>;
    };
    /**
     * Sin ninguna línea creada la tarjeta se muestra IGUAL, vacía y con el botón de vincular.
     *
     * Devolver null acá la escondía, y entonces no había desde dónde vincular la primera línea:
     * el único lugar para hacerlo desaparecía justo cuando hacía falta.
     */
    const sesion = payload.sessions?.[0];
    if (!sesion) {
      return { numero: null, nombre: null, conectado: false };
    }

    // El jid viene como "573046481994:24@s.whatsapp.net": el número es lo de antes de los dos
    // puntos. Mostrarlo entero parecía un dato roto.
    const numero = sesion.jid?.split(/[:@]/)[0]?.trim() || null;

    return {
      numero,
      nombre: sesion.name?.trim() || null,
      conectado: sesion.state === "open" && sesion.paired !== false,
    };
  } catch {
    return null;
  }
}
