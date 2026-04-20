"use client";

import {
  Bot,
  Cable,
  FileText,
  LayoutDashboard,
  Megaphone,
  MessageSquareText,
  Package,
  Settings,
  Tag,
  Truck,
  Wallet,
} from "lucide-react";
import type { Role } from "@prisma/client";
import { NavMain, type NavMainItem } from "@/components/nav-main";
import { NavUser } from "@/components/nav-user";
import { TeamSwitcher } from "@/components/team-switcher";
import type { AdminModuleKey } from "@/lib/admin-module-access";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarRail,
} from "@/components/ui/sidebar";

const roleHome = {
  ADMIN: "/admin",
  EMPLEADO: "/empleado",
  CLIENTE: "/cliente",
} as const;

type AppSidebarProps = {
  pathname: string;
  brandName: string;
  adminModuleAccess: Record<AdminModuleKey, boolean>;
  chatSidebarItems: Array<{
    title: string;
    url: string;
    helper?: string;
    kind?: "general" | "whatsapp" | "official";
  }>;
  user: {
    name?: string | null;
    email?: string | null;
    image?: string | null;
    role?: Role;
  };
};

export function AppSidebar({ pathname, brandName, adminModuleAccess, chatSidebarItems, user, ...props }: AppSidebarProps & React.ComponentProps<typeof Sidebar>) {
  const dashboardHref = user.role ? roleHome[user.role] : "/";
  const isAdminConfigRoute = pathname.startsWith("/admin/configuracion");
  const isAdminCategoriesRoute = pathname.startsWith("/admin/categorias");
  const isAdminProductsRoute = pathname.startsWith("/admin/productos");
  const isAdminQuotesRoute = pathname.startsWith("/admin/cotizaciones");
  const isAdminSuppliersRoute = pathname.startsWith("/admin/proveedores");
  const isClientAgentsRoute = pathname.startsWith("/cliente/agentes");
  const isClientChatsRoute = pathname.startsWith("/cliente/chats");
  const isClientFlowsRoute = pathname.startsWith("/cliente/flujos");
  const isClientMarketingRoute = pathname.startsWith("/cliente/marketing-ia");
  const isClientFinanzasRoute = pathname.startsWith("/cliente/finanzas");
  const isClientConnectionRoute = pathname.startsWith("/cliente/conexion") || pathname.startsWith("/cliente/api-oficial");

  const navMain: NavMainItem[] = [
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
          !isClientFlowsRoute &&
          !isClientMarketingRoute &&
          !isClientFinanzasRoute &&
          !isClientConnectionRoute),
      items: [
        { title: "Vista general", url: dashboardHref },
      ],
    },
  ];

  if (user.role === "ADMIN") {
    const canSeeConfig =
      adminModuleAccess.config_users ||
      adminModuleAccess.config_business ||
      adminModuleAccess.config_permissions ||
      adminModuleAccess.config_whatsapp;

    if (canSeeConfig) {
      navMain.push({
        title: "Configuracion",
        url: "/admin/configuracion",
        icon: Settings,
        isActive: pathname.startsWith("/admin/configuracion"),
        items: [{ title: "Ajustes", url: "/admin/configuracion" }],
      });
    }

    if (adminModuleAccess.products) {
      navMain.push({
        title: "Productos",
        url: "/admin/productos",
        icon: Package,
        isActive: pathname.startsWith("/admin/productos"),
        items: [{ title: "Catalogo", url: "/admin/productos" }],
      });
    }

    if (adminModuleAccess.categories) {
      navMain.push({
        title: "Categorias",
        url: "/admin/categorias",
        icon: Tag,
        isActive: pathname.startsWith("/admin/categorias"),
        items: [{ title: "Gestion", url: "/admin/categorias" }],
      });
    }

    if (adminModuleAccess.suppliers) {
      navMain.push({
        title: "Proveedores",
        url: "/admin/proveedores",
        icon: Truck,
        isActive: pathname.startsWith("/admin/proveedores"),
        items: [{ title: "Gestion", url: "/admin/proveedores" }],
      });
    }

    if (adminModuleAccess.quotes) {
      navMain.push({
        title: "Cotizaciones",
        url: "/admin/cotizaciones",
        icon: FileText,
        isActive: pathname.startsWith("/admin/cotizaciones"),
        items: [{ title: "Listado", url: "/admin/cotizaciones" }],
      });
    }
  }

  if (user.role === "ADMIN" || user.role === "CLIENTE") {
    navMain.push({
      title: "Chats",
      url: "/cliente/chats",
      icon: MessageSquareText,
      isActive: pathname.startsWith("/cliente/chats"),
      expandable: true,
      items: [
        { title: "Bandeja", url: "/cliente/chats", helper: "General", kind: "general" },
        ...chatSidebarItems,
      ],
    });

    navMain.push({
      title: "Flujos",
      url: "/cliente/flujos",
      icon: FileText,
      isActive: pathname.startsWith("/cliente/flujos"),
      items: [{ title: "Builder", url: "/cliente/flujos" }],
    });

    navMain.push({
      title: "Marketing IA",
      url: "/cliente/marketing-ia",
      icon: Megaphone,
      isActive: pathname.startsWith("/cliente/marketing-ia"),
      items: [{ title: "Anuncios", url: "/cliente/marketing-ia" }],
    });

    navMain.push({
      title: "Finanzas",
      url: "/cliente/finanzas",
      icon: Wallet,
      isActive: pathname.startsWith("/cliente/finanzas"),
      items: [{ title: "Mis finanzas", url: "/cliente/finanzas" }],
    });

      navMain.push({
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

    navMain.push({
      title: "Agentes",
      url: "/cliente/agentes",
      icon: Bot,
      isActive: pathname.startsWith("/cliente/agentes"),
      items: [{ title: "Estudio", url: "/cliente/agentes" }],
    });
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

        <TeamSwitcher teams={teams} />

      <SidebarContent>
        <NavMain items={navMain} />
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
