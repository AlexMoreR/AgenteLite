import type { Metadata } from "next";
import type { CSSProperties } from "react";
import { Geist_Mono, Poppins } from "next/font/google";
import { auth } from "@/auth";
import { AppShell } from "@/components/app-shell";
import { Providers } from "@/components/providers";
import { getAdminModuleAccess } from "@/lib/admin-module-access";
import { getSiteUrl, siteConfig } from "@/lib/site";
import {
  getSystemBrandName,
  getSystemPrimaryColor,
  getSystemPrimaryStrongColor,
} from "@/lib/system-settings";
import "./globals.css";

const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const brandName = await getSystemBrandName();
  const description = `${brandName} ofrece sillas barberas e hidraulicas, camillas, tocadores, salas de espera y mobiliario profesional para peluqueria, barberia y salon de belleza, con envio a toda Colombia.`;
  const socialImageUrl = getSiteUrl("/opengraph-image");

  return {
    metadataBase: new URL(siteConfig.domain),
    title: {
      default: `${brandName} | Mobiliario profesional para peluqueria, barberia y salon de belleza`,
      template: `%s | ${brandName}`,
    },
    description,
    keywords: [brandName.toLowerCase(), ...siteConfig.coreKeywords.filter((keyword) => keyword !== "magilus")],
    applicationName: brandName,
    category: "shopping",
    icons: {
      icon: [
        { url: "/favicon.ico", sizes: "32x32", type: "image/x-icon" },
        { url: siteConfig.logoPath, type: "image/svg+xml" },
      ],
      shortcut: ["/favicon.ico"],
      apple: [siteConfig.logoPath],
    },
    alternates: {
      canonical: getSiteUrl("/"),
    },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        "max-image-preview": "large",
        "max-snippet": -1,
        "max-video-preview": -1,
      },
    },
    openGraph: {
      type: "website",
      locale: siteConfig.locale,
      url: getSiteUrl("/"),
      siteName: brandName,
      title: `${brandName} | Mobiliario profesional para peluqueria, barberia y salon de belleza`,
      description,
      images: [
        {
          url: socialImageUrl,
          alt: `${brandName} catalogo online`,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: `${brandName} | Mobiliario profesional para peluqueria, barberia y salon de belleza`,
      description,
      images: [socialImageUrl],
    },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await auth();
  const [primaryColor, primaryStrongColor, brandName, adminModuleAccess] = await Promise.all([
    getSystemPrimaryColor(),
    getSystemPrimaryStrongColor(),
    getSystemBrandName(),
    getAdminModuleAccess(session?.user?.id, session?.user?.role),
  ]);

  return (
    <html lang="es-CO">
      <body
        className={`${poppins.variable} ${geistMono.variable} antialiased`}
        style={
          {
            "--primary": primaryColor,
            "--primary-strong": primaryStrongColor,
          } as CSSProperties
        }
      >
        <Providers session={session}>
          <AppShell
            initialUser={session?.user ?? null}
            brandName={brandName}
            adminModuleAccess={adminModuleAccess}
          >
            {children}
          </AppShell>
        </Providers>
      </body>
    </html>
  );
}
