"use client";

import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { Fragment } from "react";
import type { Role } from "@prisma/client";
import { AppSidebar } from "@/components/app-sidebar";
import { ClientPlanBlockModal } from "@/components/client-plan-block-modal";
import { ClientPlanWarningBar } from "@/components/client-plan-warning-bar";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Navbar } from "@/components/navbar";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
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

export function AppShell({
  children,
  initialUser,
  brandName,
  adminModuleAccess,
  clientPlanAlert,
  clientPlanBlock,
}: AppShellProps) {
  const { data } = useSession();
  const pathname = usePathname();
  const user = data?.user ?? initialUser;
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
  const showClientPlanAlert = Boolean(user?.role === "CLIENTE" && pathname.startsWith("/cliente") && clientPlanAlert);
  const showClientPlanBlock = Boolean(user?.role === "CLIENTE" && pathname.startsWith("/cliente") && clientPlanBlock?.isExpired);
  const currentPage = pathname === "/"
    ? "Inicio"
    : pathname.startsWith("/admin/cotizaciones")
      ? "Cotizaciones"
    : pathname.startsWith("/cliente/marketing-ia/creativos") || pathname.startsWith("/cliente/marketing-ia/facebook-ads")
      ? "Creativos"
    : pathname.startsWith("/cliente/marketing-ia")
      ? "Marketing IA"
    : pathname.startsWith("/cliente/agentes")
      ? "Agentes"
    : pathname.startsWith("/admin/categorias")
      ? "Categorias"
    : pathname.startsWith("/admin/proveedores")
      ? "Proveedores"
    : pathname.startsWith("/admin/configuracion")
      ? "Configuracion"
      : pathname.startsWith("/admin/productos")
        ? "Productos"
        : pathname.startsWith("/profile")
          ? "Perfil"
          : "Dashboard";

  const breadcrumbItems = (() => {
    if (pathname.startsWith("/admin/configuracion/usuarios")) {
      return [
        { label: "Configuracion", href: "/admin/configuracion", isCurrent: false },
        { label: "Usuarios", href: "", isCurrent: true },
      ];
    }

    if (pathname.startsWith("/admin/configuracion/negocio")) {
      return [
        { label: "Configuracion", href: "/admin/configuracion", isCurrent: false },
        { label: "Configuracion negocio", href: "", isCurrent: true },
      ];
    }

    if (pathname.startsWith("/admin/configuracion/permisos")) {
      return [
        { label: "Configuracion", href: "/admin/configuracion", isCurrent: false },
        { label: "Control de modulos", href: "", isCurrent: true },
      ];
    }

    if (pathname.startsWith("/admin/configuracion/whatsapp")) {
      return [
        { label: "Configuracion", href: "/admin/configuracion", isCurrent: false },
        { label: "Configuracion WhatsApp", href: "", isCurrent: true },
      ];
    }

    if (pathname.startsWith("/cliente/agentes")) {
      return [{ label: "Agentes", href: "", isCurrent: true }];
    }

    if (pathname.startsWith("/cliente/marketing-ia/creativos") || pathname.startsWith("/cliente/marketing-ia/facebook-ads")) {
      return [
        { label: "Marketing IA", href: "/cliente/marketing-ia", isCurrent: false },
        { label: "Creativos", href: "", isCurrent: true },
      ];
    }

    if (pathname.startsWith("/cliente/marketing-ia")) {
      return [{ label: "Marketing IA", href: "", isCurrent: true }];
    }

    if (pathname.startsWith("/admin/productos/new")) {
      return [
        { label: "Productos", href: "/admin/productos", isCurrent: false },
        { label: "Nuevo", href: "", isCurrent: true },
      ];
    }

    if (pathname.startsWith("/admin/productos/")) {
      return [
        { label: "Productos", href: "/admin/productos", isCurrent: false },
        { label: "Producto", href: "", isCurrent: true },
      ];
    }

    if (pathname.startsWith("/admin/productos")) {
      return [{ label: "Productos", href: "", isCurrent: true }];
    }

    if (pathname.startsWith("/admin/categorias")) {
      return [{ label: "Categorias", href: "", isCurrent: true }];
    }

    if (pathname.startsWith("/admin/proveedores")) {
      return [{ label: "Proveedores", href: "", isCurrent: true }];
    }

    if (pathname.startsWith("/admin/cotizaciones")) {
      return [{ label: "Cotizaciones", href: "", isCurrent: true }];
    }

    return [{ label: currentPage, href: "", isCurrent: true }];
  })();

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
        <div className="admin-print-shell flex min-h-screen">
          <AppSidebar
            pathname={pathname}
            user={{
              name: user.name,
              email: user.email,
              image: user.image,
              role: user.role,
            }}
            brandName={brandName}
            adminModuleAccess={adminModuleAccess}
            className="admin-print-sidebar flex"
          />
          <SidebarInset className="admin-print-inset">
            <header className="admin-print-header flex h-12 shrink-0 items-center border-b border-[var(--line)] bg-white">
              <div className="flex items-center gap-2 px-4">
                <SidebarTrigger className="-ml-1" />
                <Separator
                  orientation="vertical"
                  className="mr-2 h-4"
                />
                <Breadcrumb>
                  <BreadcrumbList>
                    {breadcrumbItems.map((item, index) => (
                      <Fragment key={`${item.label}-${index}`}>
                        <BreadcrumbItem>
                          {item.isCurrent ? (
                            <BreadcrumbPage>{item.label}</BreadcrumbPage>
                          ) : (
                            <BreadcrumbLink href={item.href}>{item.label}</BreadcrumbLink>
                          )}
                        </BreadcrumbItem>
                        {index < breadcrumbItems.length - 1 ? <BreadcrumbSeparator /> : null}
                      </Fragment>
                    ))}
                  </BreadcrumbList>
                </Breadcrumb>
              </div>
            </header>
            <main
              className={cn(
                "admin-print-main flex flex-1 flex-col",
                isAgentWorkspacePath ? "min-h-0 overflow-hidden p-0 md:p-4" : "p-3 md:p-4",
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
