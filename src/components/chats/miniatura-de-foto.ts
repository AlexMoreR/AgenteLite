/**
 * La foto de perfil achicada para la lista de chats (07-11-2026).
 *
 * Las fotos que guardamos nosotros (`/uploads/chat-media/<archivo>`, ver CHAT_MEDIA_PUBLIC_PREFIX en
 * src/lib/chat-media-storage.ts) llegan a pesar decenas de KB cada una; en la lista se ven de 48 px.
 * El optimizador de Next las devuelve de 96 px de ancho (doble densidad) y en WebP. Es el mismo
 * patron de `achicada` en src/components/admin/catalogo-de-productos.tsx.
 *
 * Cualquier otra direccion (`https://pps.whatsapp.net/...`, `data:`, vacia) queda igual: el
 * optimizador solo acepta las rutas locales y los origenes de next.config.ts.
 */
/*
  Los anchos que acepta el optimizador de Next (imageSizes + deviceSizes por defecto): con otro, 400.
*/
const ANCHOS_DEL_OPTIMIZADOR = [256, 384, 640, 750, 828, 1080] as const;

/**
 * La foto de una burbuja, achicada al tamaño en que se ve (velocidad de Chats, paso 5, 19-nov-2026).
 *
 * Las fotos del chat se bajaban en su tamaño original (32-301 KB cada una; medido en un chat de 6
 * fotos: 818 KB) aunque en la burbuja se ven de 120 a 360 px. Con el optimizador de Next salen en
 * WebP al doble del ancho en pantalla (nitidas en un celular): esas 6 pasaron a 137 KB. Al tocar la
 * foto, el visor y "Descargar" siguen usando la original.
 *
 * Solo las nuestras (`/uploads/...`) en jpg, png o webp; cualquier otra direccion (un GIF, `data:`,
 * `blob:` de una foto que se esta enviando, el proxy) queda igual. Si la achicada falla, la burbuja
 * vuelve a la original (ver chat-message-bubble).
 */
export function fotoParaLaBurbuja(url: string, anchoEnPantalla: number | null | undefined): string {
  const limpia = url.trim();
  if (!limpia.startsWith("/uploads/") || !/\.(jpe?g|png|webp)$/i.test(limpia.split("?")[0] ?? "")) {
    return url;
  }
  const ancho = typeof anchoEnPantalla === "number" && anchoEnPantalla > 0 ? anchoEnPantalla : 360;
  const necesario = ancho * 2;
  const w = ANCHOS_DEL_OPTIMIZADOR.find((opcion) => opcion >= necesario) ?? 1080;
  return `/_next/image?url=${encodeURIComponent(limpia)}&w=${w}&q=75`;
}

export function miniaturaDeFoto(url: string): string {
  const limpia = url.trim();
  return limpia.startsWith("/uploads/")
    // q=75: Next 16 solo acepta las calidades configuradas, y por defecto es solo 75 (con 70 da 400).
    ? `/_next/image?url=${encodeURIComponent(limpia)}&w=96&q=75`
    : url;
}
