import type { MetadataRoute } from "next";

/**
 * Esto es un CRM privado: no se indexa.
 *
 * Antes decia `allow: "/"` con una lista de carpetas prohibidas, y apuntaba a un sitemap que
 * publicaba los productos en Google. Venia copiado de otro proyecto que si tenia tienda publica
 * (Alex, 28-09-2026): acá dentro no hay nada que un buscador deba ver, y la lista de permitidos
 * era una invitación a que se colara lo que no estuviera en la lista de prohibidos.
 *
 * Se invierte: se prohibe todo. Lo unico que queda afuera del CRM es la portada y las paginas
 * legales, que son las que alguien puede necesitar encontrar.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/$", "/privacy", "/privacy-policy", "/terms", "/terms-of-service"],
      disallow: "/",
    },
  };
}
