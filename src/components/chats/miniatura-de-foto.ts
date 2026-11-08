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
export function miniaturaDeFoto(url: string): string {
  const limpia = url.trim();
  return limpia.startsWith("/uploads/")
    // q=75: Next 16 solo acepta las calidades configuradas, y por defecto es solo 75 (con 70 da 400).
    ? `/_next/image?url=${encodeURIComponent(limpia)}&w=96&q=75`
    : url;
}
