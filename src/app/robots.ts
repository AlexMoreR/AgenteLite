import type { MetadataRoute } from "next";
import { getSiteUrl, siteConfig } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin", "/empleado", "/cliente", "/profile", "/login", "/register", "/api/"],
    },
    sitemap: getSiteUrl("/sitemap.xml"),
    host: siteConfig.domain,
  };
}
