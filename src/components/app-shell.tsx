"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import type { Role } from "@prisma/client";
import { AppSidebar } from "@/components/app-sidebar";
import { ClientPlanBlockModal } from "@/components/client-plan-block-modal";
import { ClientPlanWarningBar } from "@/components/client-plan-warning-bar";
import { Navbar } from "@/components/navbar";
import { SidebarInset, SidebarProvider, SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import type { AdminModuleKey } from "@/lib/admin-module-access";
import { cn } from "@/lib/utils";

type InitialUser = {
  name?: string | null;
  email?: string | null;
  image?: string | null;
  role?: Role;
};

type AppShellProps = {
  children: React.ReactNode;
  initialUser: InitialUser | null;
  brandName: string;
  adminModuleAccess: Record<AdminModuleKey, boolean>;
  chatSidebarItems: Array<{
    title: string;
    url: string;
    helper?: string;
    kind?: "general" | "evolution" | "official";
  }>;
  clientPlanAlert: {
    daysRemaining: number;
    expiresAtLabel: string;
    isExpired: boolean;
  } | null;
  clientPlanBlock: {
    isExpired: true;
    expiresAtLabel: string;
    paymentHref: string;
  } | null;
};

function MobileSidebarTrigger() {
  const { openMobile } = useSidebar();

  if (openMobile) {
    return null;
  }

  return <SidebarTrigger compact className="fixed left-3 top-3 z-50 md:hidden" />;
}

export function AppShell({
  children,
  initialUser,
  brandName,
  adminModuleAccess,
  chatSidebarItems,
  clientPlanAlert,
  clientPlanBlock,
}: AppShellProps) {
  const { data } = useSession();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const user = data?.user ?? initialUser;
  const currentConnectionKey = searchParams.get("connection")?.trim() || "";
  const firstSegment = pathname.split("/").filter(Boolean)[0] ?? "";
  const reservedStoreSegments = new Set([
    "admin",
    "api",
    "cliente",
    "cotizaciones",
    "empleado",
    "login",
    "profile",
    "register",
    "robots.txt",
    "sitemap.xml",
    "unauthorized",
    "verify-email",
    "favicon.ico",
  ]);
  const isCategoryStorefrontPath = Boolean(firstSegment) && !reservedStoreSegments.has(firstSegment);
  const showTopMenu = pathname === "/" || pathname.startsWith("/productos") || pathname.startsWith("/categorias") || isCategoryStorefrontPath;
  const isMarketingHome = pathname === "/";
  const isAuthPath = pathname === "/login" || pathname === "/register";
  const isAgentWorkspacePath = pathname.startsWith("/cliente/agentes/");
  const isAgentCopilotPath = /^\/cliente\/agentes\/[^/]+$/.test(pathname);
  const isChatWorkspacePath = pathname.startsWith("/cliente/chats");
  const isFlowsWorkspacePath = pathname.startsWith("/cliente/flujos");
  const isFinanzasPath = pathname.startsWith("/cliente/finanzas");
  const isViewportLockedWorkspacePath = isChatWorkspacePath || isFinanzasPath || isAgentCopilotPath;
  const isFullHeightWorkspacePath = isAgentWorkspacePath || isChatWorkspacePath || isFlowsWorkspacePath || isFinanzasPath;
  const showClientPlanAlert = Boolean(user?.role === "CLIENTE" && pathname.startsWith("/cliente") && clientPlanAlert);
  const showClientPlanBlock = Boolean(user?.role === "CLIENTE" && pathname.startsWith("/cliente") && clientPlanBlock?.isExpired);

  if (showTopMenu) {
    return (
      <>
        <Navbar
          initialUser={initialUser}
          brandName={brandName}
          adminModuleAccess={adminModuleAccess}
        />
        <main
          className={cn(
            "w-full",
            isMarketingHome
              ? "min-h-[calc(100vh-4.5rem)] px-0 pt-0 pb-0"
              : "mx-auto max-w-6xl px-4 pt-3 pb-8 md:px-6 md:pt-4 md:pb-10",
          )}
        >
          {children}
        </main>
      </>
    );
  }

  if (user) {
    return (
      <SidebarProvider>
        <div
          className={cn(
            "admin-print-shell flex min-h-screen",
            isViewportLockedWorkspacePath && "chat-app-frame min-h-dvh h-dvh overflow-hidden md:min-h-screen md:h-dvh",
          )}
        >
          <AppSidebar
            pathname={pathname}
            currentConnectionKey={currentConnectionKey}
            user={{
              name: user.name,
              email: user.email,
              image: user.image,
              role: user.role,
            }}
            brandName={brandName}
            adminModuleAccess={adminModuleAccess}
            chatSidebarItems={chatSidebarItems}
            className="admin-print-sidebar flex"
          />
          <SidebarInset
            className={cn(
              "admin-print-inset rounded-none",
              isAgentWorkspacePath && "bg-[#F1F5F9]",
              isViewportLockedWorkspacePath && "chat-app-shell min-h-dvh h-dvh overflow-hidden md:min-h-0 md:h-dvh",
            )}
          >
            <MobileSidebarTrigger />
            <main
              className={cn(
                "admin-print-main flex flex-1 flex-col rounded-none",
                isFullHeightWorkspacePath
                  ? cn(
                      "min-h-0 overflow-hidden p-0",
                      isFinanzasPath ? "md:p-2" : "md:p-4",
                    )
                  : "p-3 md:p-4",
                isAgentWorkspacePath && "bg-transparent",
                isViewportLockedWorkspacePath && "chat-app-main",
              )}
            >
              {showClientPlanAlert && clientPlanAlert ? <ClientPlanWarningBar {...clientPlanAlert} /> : null}
              {children}
            </main>
            {showClientPlanBlock && clientPlanBlock ? <ClientPlanBlockModal {...clientPlanBlock} /> : null}
          </SidebarInset>
        </div>
      </SidebarProvider>
    );
  }

  return (
    <>
      <main
        className={cn(
          isAuthPath
            ? "w-full min-h-screen"
            : "mx-auto w-full max-w-6xl px-4 md:px-6 min-h-screen py-8 md:py-10",
        )}
      >
        {children}
      </main>
    </>
  );
}
