import type { MetadataRoute } from "next";
import { getSystemBrandName, getSystemPrimaryColor } from "@/lib/system-settings";

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const [brandName, primaryColor] = await Promise.all([
    getSystemBrandName(),
    getSystemPrimaryColor(),
  ]);

  return {
    name: brandName,
    short_name: brandName,
    description: "Panel de trabajo para chats, CRM, contactos y gestion comercial.",
    start_url: "/cliente/chats",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: primaryColor,
    lang: "es-CO",
    categories: ["business", "productivity"],
    icons: [
      {
        src: "/icon?size=192",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icon?size=512",
        sizes: "512x512",
        type: "image/png",
      },
      {
        src: "/icon?size=512",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
