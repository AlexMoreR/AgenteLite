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
