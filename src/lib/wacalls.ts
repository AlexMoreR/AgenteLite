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
    const sesion = payload.sessions?.[0];
    if (!sesion) {
      return null;
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
