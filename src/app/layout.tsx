import type { Metadata, Viewport } from "next";
import type { CSSProperties } from "react";
import { cookies } from "next/headers";
import Script from "next/script";
import { Geist_Mono, Poppins, Geist } from "next/font/google";
import { auth } from "@/auth";
import { AppShell } from "@/components/app-shell";
import { Providers } from "@/components/providers";
import { getAdminModuleAccess } from "@/lib/admin-module-access";
import {
  canAccessClientModule,
  getClientWorkspaceAccessForUser,
  getVisibleClientModuleAccess,
} from "@/lib/client-workspace-access";
import { clientAssignableModuleKeys } from "@/lib/client-workspace-modules";
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
import "react-toastify/dist/ReactToastify.css";
import { cn } from "@/lib/utils";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 * El color de la barra del navegador va aca, NO en generateMetadata.
 *
 * Estando en metadata, Next avisa en CADA render de CADA pagina ("Unsupported metadata
 * themeColor..."). En produccion eso llenaba los logs del servidor: de 1749 lineas, 1724 eran
 * este aviso repetido. Cuando algo se rompia de verdad, el error quedaba enterrado y los logs
 * no servian para diagnosticar nada.
 */
export async function generateViewport(): Promise<Viewport> {
  return {
    themeColor: await getSystemPrimaryStrongColor(),
    /**
     * Sin esto, en iOS `env(safe-area-inset-*)` vale SIEMPRE 0 y todos los rellenos de area
     * segura que ya hay en el codigo no hacen nada: el compositor del chat quedaba al filo de la
     * barra de gestos del iPhone.
     *
     * Lo que NO se puede hacer es tapar eso con un margen fijo: en Android no hay barra que
     * esquivar y el compositor queda levantado sin motivo. El area segura da el numero correcto
     * en cada aparato —la altura real en iPhone, 0 en Android—, y por eso la respuesta es
     * informarla, no inventar un numero.
     *
     * Contrapartida: la pagina pasa a dibujarse de borde a borde, asi que TODO lo que quede
     * pegado a un borde necesita su relleno de area segura. Ver el encabezado de app-shell.
     */
    viewportFit: "cover",
  };
}

export async function generateMetadata(): Promise<Metadata> {
  const brandName = await getSystemBrandName();
  const description = "La mejor solucion para su empresa";
  const socialImageUrl = getSiteUrl("/opengraph-image");

  return {
    metadataBase: new URL(siteConfig.domain),
    manifest: "/manifest.webmanifest",
    title: {
      default: `${brandName} | La mejor solucion para su empresa`,
      template: `%s | ${brandName}`,
    },
    description,
    keywords: [brandName.toLowerCase(), ...siteConfig.coreKeywords.filter((keyword) => keyword !== "magilus")],
    applicationName: brandName,
    category: "shopping",
    appleWebApp: {
      capable: true,
      statusBarStyle: "default",
      title: brandName,
    },
    icons: {
      icon: [
        { url: "/icon?size=192", sizes: "192x192", type: "image/png" },
        { url: "/icon?size=512", sizes: "512x512", type: "image/png" },
      ],
      shortcut: "/icon?size=192",
      apple: "/apple-icon",
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
  // Persistir el estado del sidebar entre recargas: el SidebarProvider escribe la
  // cookie `sidebar_state` al colapsar/expandir; aquí la leemos en el server para que
  // el primer render ya respete ese estado (sin parpadeo de hidratación).
  const cookieStore = await cookies();
  const sidebarDefaultOpen = cookieStore.get("sidebar_state")?.value !== "false";
  const primaryWorkspace = session?.user?.id ? await getPrimaryWorkspaceForUser(session.user.id) : null;
  const isClientAreaRole = session?.user?.role === "CLIENTE" || session?.user?.role === "EMPLEADO";
  const clientWorkspace = isClientAreaRole ? primaryWorkspace : null;
  const [primaryColor, primaryStrongColor, brandName, baseAdminModuleAccess, clientAccess] = await Promise.all([
    getSystemPrimaryColor(),
    getSystemPrimaryStrongColor(),
    getSystemBrandName(),
    getAdminModuleAccess(session?.user?.id, session?.user?.role),
    session?.user?.id ? getClientWorkspaceAccessForUser(session.user.id) : Promise.resolve(null),
  ]);
  const adminModuleAccess = { ...baseAdminModuleAccess };

  if (clientAccess && isClientAreaRole) {
    const visibleClientModuleAccess = getVisibleClientModuleAccess(clientAccess);
    for (const key of clientAssignableModuleKeys) {
      adminModuleAccess[key] = visibleClientModuleAccess[key];
    }
    adminModuleAccess.client_team = canAccessClientModule(clientAccess, "client_team");
  }
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
          phoneNumber: true,
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
          helper:
            channel.phoneNumber?.trim() ||
            channel.agent?.name ||
            (channel.provider === "OFFICIAL_API" ? "WhatsApp API oficial" : "WhatsApp"),
          kind: (channel.provider === "OFFICIAL_API" ? "official" : "evolution") as "official" | "evolution",
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
    <html lang="es-CO" className={cn("font-sans", geist.variable)} suppressHydrationWarning>
      <body
        className={`${poppins.variable} ${geistMono.variable} antialiased`}
        style={
          {
            "--primary": primaryColor,
            "--primary-strong": primaryStrongColor,
          } as CSSProperties
        }
      >
        <Script id="theme-init" strategy="beforeInteractive">
          {`(() => {
            try {
              const storedTheme = localStorage.getItem("theme");
              const isDark = storedTheme === "dark" || (!storedTheme && window.matchMedia("(prefers-color-scheme: dark)").matches);
              document.documentElement.classList.toggle("dark", isDark);
              document.documentElement.style.colorScheme = isDark ? "dark" : "light";
            } catch (error) {}
          })();`}
        </Script>
        <Providers session={session}>
          <AppShell
            initialUser={session?.user ?? null}
            brandName={brandName}
            adminModuleAccess={adminModuleAccess}
            chatSidebarItems={chatSidebarItems}
            clientPlanAlert={clientPlanAlert}
            clientPlanBlock={clientPlanBlock}
            sidebarDefaultOpen={sidebarDefaultOpen}
          >
            {children}
          </AppShell>
        </Providers>
      </body>
    </html>
  );
}
