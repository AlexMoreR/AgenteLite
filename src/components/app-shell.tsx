"use client";

import Link from "next/link";
import { useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { CircleHelp } from "lucide-react";
import type { Role } from "@prisma/client";
import { AppSidebar } from "@/components/app-sidebar";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { useBreadcrumbLabel } from "@/components/breadcrumb-label-context";
import { ClientPlanBlockModal } from "@/components/client-plan-block-modal";
import { ClientPlanWarningBar } from "@/components/client-plan-warning-bar";
import { Navbar } from "@/components/navbar";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { ChatNotificationBell } from "@/components/ui/chat-notification-bell";
import { HelpCopilotWidget } from "@/components/help/help-copilot-widget";
import { ThemeToggleButton } from "@/components/ui/theme-toggle";
import type { AdminModuleKey } from "@/lib/admin-modules";
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
  // Estado inicial del sidebar leído de la cookie `sidebar_state` en el server,
  // para que persista entre recargas.
  sidebarDefaultOpen?: boolean;
};

const breadcrumbLabels: Record<string, string> = {
  admin: "Admin",
  agentes: "Agentes",
  api: "API",
  "api-oficial": "API oficial",
  automatizar: "Automatizar",
  canales: "Canales",
  cliente: "Cliente",
  configuracion: "Configuracion",
  contactos: "Contactos",
  cotizaciones: "Cotizaciones",
  crm: "CRM",
  dashboard: "Dashboard",
  entrenamiento: "Entrenamiento",
  finanzas: "Finanzas",
  flujos: "Flujos",
  informe: "Informe",
  kanban: "Kanban",
  "marketing-ia": "Marketing IA",
  negocio: "Negocio",
  onboarding: "Onboarding",
  perfil: "Perfil",
  profile: "Perfil",
  permisos: "Permisos",
  productos: "Productos",
  registro: "Registro",
  empleado: "Empleado",
  equipo: "Equipo",
  seguimientos: "Seguimientos",
  settings: "Settings",
  whatsapp: "WhatsApp",
  "whatsapp-business": "WhatsApp Business",
  usuarios: "Usuarios",
  avanzado: "Avanzado",
  chats: "Chats",
  chatbots: "Chatbots",
  conocimiento: "Conocimiento",
  acciones: "Acciones",
  general: "General",
  unauthorized: "Sin autorizacion",
};

function formatBreadcrumbLabel(segment: string) {
  return breadcrumbLabels[segment] ?? segment.replace(/-/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

// Detecta segmentos que son ids generados (ej. "workflow-1777415953671-wnbel",
// cuids/uuids) para no mostrarlos crudos en el breadcrumb.
function isIdLikeSegment(segment: string) {
  if (breadcrumbLabels[segment]) {
    return false;
  }
  return /^workflow-/.test(segment) || (/\d/.test(segment) && segment.length >= 12);
}

// Etiqueta del ultimo segmento: usa el override de la pagina (nombre real) si
// existe; si el segmento es un id generado, cae al label del segmento padre.
function resolveLastLabel(segments: string[], overrideLabel: string | null) {
  const lastSegment = segments[segments.length - 1];
  if (overrideLabel) {
    return overrideLabel;
  }
  if (isIdLikeSegment(lastSegment) && segments.length >= 2) {
    return formatBreadcrumbLabel(segments[segments.length - 2]);
  }
  return formatBreadcrumbLabel(lastSegment);
}

function AppBreadcrumb({ pathname }: { pathname: string }) {
  const overrideLabel = useBreadcrumbLabel();
  const segments = pathname.split("/").filter(Boolean);

  if (segments.length === 0) {
    return null;
  }

  if (segments.length === 1) {
    return (
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbPage>{resolveLastLabel(segments, overrideLabel)}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
    );
  }

  if (segments[0] === "cliente") {
    return (
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbPage>{resolveLastLabel(segments, overrideLabel)}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
    );
  }

  const firstSegment = segments[0];

  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem className="hidden md:block">
          <BreadcrumbLink asChild>
            <Link href={`/${firstSegment}`}>{formatBreadcrumbLabel(firstSegment)}</Link>
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator className="hidden md:block" />
        <BreadcrumbItem>
          <BreadcrumbPage>{resolveLastLabel(segments, overrideLabel)}</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );
}

export function AppShell({
  children,
  initialUser,
  brandName,
  adminModuleAccess,
  chatSidebarItems,
  clientPlanAlert,
  clientPlanBlock,
  sidebarDefaultOpen = true,
}: AppShellProps) {
  const { data } = useSession();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [helpOpen, setHelpOpen] = useState(false);
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
  const isChatWorkspacePath = pathname.startsWith("/cliente/chats");
  const hasActiveChatConversation = Boolean(isChatWorkspacePath && searchParams.get("chatKey")?.trim());
  const isClientPlanRole = user?.role === "CLIENTE" || user?.role === "EMPLEADO";
  const showClientPlanAlert = Boolean(isClientPlanRole && pathname.startsWith("/cliente") && clientPlanAlert);
  const showClientPlanBlock = Boolean(isClientPlanRole && pathname.startsWith("/cliente") && clientPlanBlock?.isExpired);

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
              : "px-4 pt-3 pb-8 md:px-6 md:pt-4 md:pb-10",
          )}
        >
          {children}
        </main>
      </>
    );
  }

  if (user) {
    return (
      <SidebarProvider defaultOpen={sidebarDefaultOpen}>
        <AppSidebar
          adminModuleAccess={adminModuleAccess}
          brandName={brandName}
          user={{
            name: user.name,
            email: user.email,
            image: user.image,
            role: user.role,
          }}
          currentConnectionKey={currentConnectionKey}
          chatSidebarItems={chatSidebarItems}
        />
        <SidebarInset
          className={cn(
            "flex min-h-screen w-full min-w-0 flex-col",
            isChatWorkspacePath && "h-[100dvh] overflow-hidden",
            isAgentWorkspacePath && "bg-[#F1F5F9]",
          )}
        >
          <header
            className={cn(
              "flex h-12 shrink-0 items-center gap-1.5 border-b border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12",
              hasActiveChatConversation && "hidden md:flex",
            )}
          >
            <div className="flex w-full items-center gap-1.5 px-1.5">
              <SidebarTrigger className="-ml-1" />
              <Separator orientation="vertical"/>
              {!isChatWorkspacePath ? <AppBreadcrumb pathname={pathname} /> : null}
              <div className="ml-auto flex items-center gap-0.5">
                <ChatNotificationBell />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="¿Necesitas ayuda?"
                  onClick={() => setHelpOpen(true)}
                >
                  <CircleHelp data-icon="inline-start" />
                </Button>
                <ThemeToggleButton />
              </div>
            </div>
          </header>
          <main
            className={cn(
              "flex w-full min-w-0 flex-1 min-h-0 flex-col gap-4 pt-0",
              isChatWorkspacePath && "overflow-hidden",
              isAgentWorkspacePath && "bg-transparent",
            )}
          >
            {showClientPlanAlert && clientPlanAlert ? <ClientPlanWarningBar {...clientPlanAlert} /> : null}
            {children}
          </main>
          {showClientPlanBlock && clientPlanBlock ? <ClientPlanBlockModal {...clientPlanBlock} /> : null}
        </SidebarInset>
        <HelpCopilotWidget open={helpOpen} onClose={() => setHelpOpen(false)} />
      </SidebarProvider>
    );
  }

  return (
    <>
      <main
        className={cn(
          "w-full min-h-screen",
          isAuthPath ? "px-0" : "px-4 md:px-6 py-8 md:py-10",
        )}
      >
        {children}
      </main>
    </>
  );
}
