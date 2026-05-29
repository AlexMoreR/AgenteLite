"use client";

import {
  AlarmClock,
  Bot,
  Cable,
  FileText,
  LayoutDashboard,
  Megaphone,
  Package,
  Tag,
  Truck,
  Users2,
  Wallet,
} from "lucide-react";
import type { Role } from "@prisma/client";
import { NavChats } from "@/components/nav-chats";
import { NavMain, type NavMainItem } from "@/components/nav-main";
import { NavCrm } from "@/components/nav-crm";
import { NavUser } from "@/components/nav-user";
import { TeamSwitcher } from "@/components/team-switcher";
import type { AdminModuleKey } from "@/lib/admin-module-access";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";

const roleHome = {
  ADMIN: "/admin",
  EMPLEADO: "/empleado",
  CLIENTE: "/cliente",
} as const;

type AppSidebarProps = {
  pathname: string;
  currentConnectionKey?: string;
  brandName: string;
  adminModuleAccess: Record<AdminModuleKey, boolean>;
  chatSidebarItems: Array<{
    title: string;
    url: string;
    helper?: string;
    kind?: "general" | "evolution" | "official";
  }>;
  user: {
    name?: string | null;
    email?: string | null;
    image?: string | null;
    role?: Role;
  };
};

export function AppSidebar({
  pathname,
  currentConnectionKey = "",
  brandName,
  adminModuleAccess,
  chatSidebarItems,
  user,
  ...props
}: AppSidebarProps & React.ComponentProps<typeof Sidebar>) {
  const { openDesktop } = useSidebar();
  const dashboardHref = user.role ? roleHome[user.role] : "/";
  const isAdminConfigRoute = pathname.startsWith("/admin/configuracion");
  const isAdminCategoriesRoute = pathname.startsWith("/admin/categorias");
  const isAdminProductsRoute = pathname.startsWith("/admin/productos");
  const isAdminQuotesRoute = pathname.startsWith("/admin/cotizaciones");
  const isAdminSuppliersRoute = pathname.startsWith("/admin/proveedores");
  const isClientAgentsRoute = pathname.startsWith("/cliente/agentes");
  const isClientChatsRoute = pathname.startsWith("/cliente/chats");
  const isClientContactsRoute = pathname.startsWith("/cliente/contactos");
  const isClientCrmRoute = pathname.startsWith("/cliente/crm");
  const isClientFlowsRoute = pathname.startsWith("/cliente/flujos");
  const isClientSeguimientosRoute = pathname.startsWith("/cliente/seguimientos");
  const isClientMarketingRoute = pathname.startsWith("/cliente/marketing-ia");
  const isClientFinanzasRoute = pathname.startsWith("/cliente/finanzas");
  const isClientConnectionRoute = pathname.startsWith("/cliente/conexion") || pathname.startsWith("/cliente/api-oficial");
  const canAccessSidebarModule = (moduleKey: AdminModuleKey) => user.role === "ADMIN" ? adminModuleAccess[moduleKey] : true;
  const canSeeChats = canAccessSidebarModule("chats");
  const canSeeCrm = canAccessSidebarModule("crm");
  const currentCrmView = pathname.startsWith("/cliente/crm/informe")
    ? "informe"
    : pathname.startsWith("/cliente/crm/kanban")
      ? "kanban"
      : "registro";

  const navMainTop: NavMainItem[] = [
    {
      title: "Dashboard",
      url: dashboardHref,
      icon: LayoutDashboard,
      isActive:
        pathname === dashboardHref ||
        (pathname.startsWith(`${dashboardHref}/`) &&
          !isAdminConfigRoute &&
          !isAdminCategoriesRoute &&
          !isAdminProductsRoute &&
          !isAdminQuotesRoute &&
          !isAdminSuppliersRoute &&
          !isClientAgentsRoute &&
          !isClientChatsRoute &&
          !isClientContactsRoute &&
          !isClientCrmRoute &&
          !isClientFlowsRoute &&
          !isClientSeguimientosRoute &&
          !isClientMarketingRoute &&
          !isClientFinanzasRoute &&
          !isClientConnectionRoute),
      items: [
        { title: "Vista general", url: dashboardHref },
      ],
    },
  ];

  if (user.role === "ADMIN") {
    if (canAccessSidebarModule("products")) {
      navMainTop.push({
        title: "Productos",
        url: "/admin/productos",
        icon: Package,
        isActive: pathname.startsWith("/admin/productos"),
        items: [{ title: "Catalogo", url: "/admin/productos" }],
      });
    }

    if (canAccessSidebarModule("categories")) {
      navMainTop.push({
        title: "Categorias",
        url: "/admin/categorias",
        icon: Tag,
        isActive: pathname.startsWith("/admin/categorias"),
        items: [{ title: "Gestion", url: "/admin/categorias" }],
      });
    }

    if (canAccessSidebarModule("suppliers")) {
      navMainTop.push({
        title: "Proveedores",
        url: "/admin/proveedores",
        icon: Truck,
        isActive: pathname.startsWith("/admin/proveedores"),
        items: [{ title: "Gestion", url: "/admin/proveedores" }],
      });
    }

    if (canAccessSidebarModule("quotes")) {
      navMainTop.push({
        title: "Cotizaciones",
        url: "/admin/cotizaciones",
        icon: FileText,
        isActive: pathname.startsWith("/admin/cotizaciones"),
        items: [{ title: "Listado", url: "/admin/cotizaciones" }],
      });
    }
  }

  const navMainBottom: NavMainItem[] = [];

  if (user.role === "ADMIN" || user.role === "CLIENTE") {
    if (canAccessSidebarModule("contacts")) {
      navMainBottom.push({
        title: "Contactos",
        url: "/cliente/contactos",
        icon: Users2,
        isActive: pathname.startsWith("/cliente/contactos"),
        items: [{ title: "Base", url: "/cliente/contactos" }],
      });
    }

    if (canAccessSidebarModule("flows")) {
      navMainBottom.push({
        title: "Flujos",
        url: "/cliente/flujos",
        icon: FileText,
        isActive: pathname.startsWith("/cliente/flujos"),
        items: [{ title: "Builder", url: "/cliente/flujos" }],
      });
    }

    if (canAccessSidebarModule("seguimientos")) {
      navMainBottom.push({
        title: "Seguimientos",
        url: "/cliente/seguimientos",
        icon: AlarmClock,
        isActive: pathname.startsWith("/cliente/seguimientos"),
        items: [{ title: "Reglas y colas", url: "/cliente/seguimientos" }],
      });
    }

    if (canAccessSidebarModule("marketing_ia")) {
      navMainBottom.push({
        title: "Marketing IA",
        url: "/cliente/marketing-ia",
        icon: Megaphone,
        isActive: pathname.startsWith("/cliente/marketing-ia"),
        items: [{ title: "Anuncios", url: "/cliente/marketing-ia" }],
      });
    }

    if (canAccessSidebarModule("finanzas")) {
      navMainBottom.push({
        title: "Finanzas",
        url: "/cliente/finanzas",
        icon: Wallet,
        isActive: pathname.startsWith("/cliente/finanzas"),
        items: [{ title: "Mis finanzas", url: "/cliente/finanzas" }],
      });
    }

    if (canAccessSidebarModule("connection") || adminModuleAccess.client_official_api) {
      navMainBottom.push({
        title: "Conexion",
        url: "/cliente/conexion",
        icon: Cable,
        isActive: pathname.startsWith("/cliente/conexion") || pathname.startsWith("/cliente/api-oficial"),
        items: [
          { title: "Resumen", url: "/cliente/conexion" },
          ...(user.role === "ADMIN" || adminModuleAccess.client_official_api
            ? [{ title: "API oficial", url: "/cliente/api-oficial" }]
            : []),
        ],
      });
    }

    if (canAccessSidebarModule("agents")) {
      navMainBottom.push({
        title: "Agentes",
        url: "/cliente/agentes",
        icon: Bot,
        isActive: pathname.startsWith("/cliente/agentes"),
        items: [{ title: "Estudio", url: "/cliente/agentes" }],
      });
    }
  }

  const teams = [
    { name: brandName, plan: "Cumpliendo suenos" },
  ];

  const canAccessConfig =
    adminModuleAccess.config_users ||
    adminModuleAccess.config_business ||
    adminModuleAccess.config_permissions ||
    adminModuleAccess.config_whatsapp;

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader className="relative gap-2 px-3 pr-2 md:px-4 md:pr-2">
        <div className="min-w-0 flex-1">
          <TeamSwitcher teams={teams} />
        </div>
        <SidebarTrigger
          compact={!openDesktop}
          className="hidden md:inline-flex absolute right-[-12px] top-1/2 z-10 -translate-y-1/2"
        />
      </SidebarHeader>

      <SidebarContent>
        <NavMain items={navMainTop} />
        {canSeeChats ? (
          <NavChats
            currentConnectionKey={currentConnectionKey}
            isChatsRoute={isClientChatsRoute}
            chatSidebarItems={chatSidebarItems}
          />
        ) : null}
        {canSeeCrm ? <NavCrm currentView={currentCrmView} isCrmRoute={isClientCrmRoute} /> : null}
        <NavMain items={navMainBottom} />
      </SidebarContent>
      <SidebarFooter className="border-t-0 !p-0">
        <NavUser
          user={{
            name: user.name ?? "Usuario",
            email: user.email ?? "m@example.com",
            avatar: user.image ?? "",
            role: user.role,
          }}
          canAccessConfig={canAccessConfig}
        />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
