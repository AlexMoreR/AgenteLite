import type { Metadata } from "next";
import type { CSSProperties } from "react";
import { Geist_Mono, Poppins } from "next/font/google";
import { auth } from "@/auth";
import { AppShell } from "@/components/app-shell";
import { Providers } from "@/components/providers";
import { getAdminModuleAccess } from "@/lib/admin-module-access";
import { CLIENT_PLAN_PAYMENT_HREF, getWorkspacePlanState } from "@/lib/plans";
import { prisma } from "@/lib/prisma";
import { getSiteUrl, siteConfig } from "@/lib/site";
import {
  getSystemBrandName,
  getSystemPrimaryColor,
  getSystemPrimaryStrongColor,
} from "@/lib/system-settings";
import { enforceWorkspacePlanAccess } from "@/lib/workspace-plan-access";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";
import "./globals.css";
import "@xyflow/react/dist/style.css";

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
  const description = "La mejor solucion para su empresa";
  const socialImageUrl = getSiteUrl("/opengraph-image");

  return {
    metadataBase: new URL(siteConfig.domain),
    title: {
      default: `${brandName} | La mejor solucion para su empresa`,
      template: `%s | ${brandName}`,
    },
    description,
    keywords: [brandName.toLowerCase(), ...siteConfig.coreKeywords.filter((keyword) => keyword !== "magilus")],
    applicationName: brandName,
    category: "shopping",
    icons: {
      icon: { url: siteConfig.iconPath, sizes: "512x512", type: "image/png" },
      shortcut: siteConfig.iconPath,
      apple: siteConfig.iconPath,
    },
    verification: {
      google: "2EMj69XiBfiLqnhIVRUaEhFbiNZ3t7V5piUczJabv3c",
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
      title: `${brandName} | La mejor solucion para su empresa`,
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
      title: `${brandName} | La mejor solucion para su empresa`,
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
  const primaryWorkspace = session?.user?.id ? await getPrimaryWorkspaceForUser(session.user.id) : null;
  const clientWorkspace = session?.user?.role === "CLIENTE" ? primaryWorkspace : null;
  const [primaryColor, primaryStrongColor, brandName, adminModuleAccess] = await Promise.all([
    getSystemPrimaryColor(),
    getSystemPrimaryStrongColor(),
    getSystemBrandName(),
    getAdminModuleAccess(session?.user?.id, session?.user?.role),
  ]);
  const chatSidebarItems = primaryWorkspace?.workspace.id
    ? await prisma.whatsAppChannel.findMany({
        where: {
          workspaceId: primaryWorkspace.workspace.id,
          provider: {
            in: ["EVOLUTION", "OFFICIAL_API"],
          },
        },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          name: true,
          provider: true,
          agent: {
            select: {
              name: true,
            },
          },
        },
        }).then((channels) =>
        channels.map((channel) => ({
          title: channel.name,
          url: `/cliente/chats?connection=${encodeURIComponent(`channel:${channel.id}`)}`,
          helper: channel.provider === "OFFICIAL_API" ? "API oficial" : channel.agent?.name || "WhatsApp",
          kind: channel.provider === "OFFICIAL_API" ? ("official" as const) : ("evolution" as const),
        })),
      )
    : [];
  const workspaceAccess = clientWorkspace?.workspace.id
    ? await enforceWorkspacePlanAccess(clientWorkspace.workspace.id)
    : null;
  const planExpiresAt = workspaceAccess?.workspace?.planExpiresAt ?? clientWorkspace?.workspace.planExpiresAt ?? null;
  const planState = getWorkspacePlanState(planExpiresAt);
  const expiresAtLabel = planExpiresAt
    ? new Intl.DateTimeFormat("es-CO", {
        day: "numeric",
        month: "short",
        year: "numeric",
      }).format(planExpiresAt)
    : "";
  const clientPlanAlert =
    planExpiresAt && planState.warning && planState.daysRemaining !== null
      ? {
          daysRemaining: planState.daysRemaining,
          isExpired: false,
          expiresAtLabel,
        }
      : null;
  const clientPlanBlock =
    planExpiresAt && planState.blockClientArea
      ? {
          isExpired: true as const,
          expiresAtLabel,
          paymentHref: CLIENT_PLAN_PAYMENT_HREF,
        }
      : null;

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
            chatSidebarItems={chatSidebarItems}
            clientPlanAlert={clientPlanAlert}
            clientPlanBlock={clientPlanBlock}
          >
            {children}
          </AppShell>
        </Providers>
      </body>
    </html>
  );
}
