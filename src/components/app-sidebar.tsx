"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  AlarmClock,
  Send,
  Bot,
  BriefcaseBusiness,
  Cable,
  Blocks,
  FileText,
  GraduationCap,
  Home,
  KanbanSquare,
  Megaphone,
  MessageSquare,
  MessageSquareMore,
  Network,
  Package,
  PhoneCall,
  BookOpen,
  Share2,
  Tags,
  Truck,
  UserCog,
  Users,
  Users2,
  Video,
  Wallet,
  Workflow,
} from "lucide-react"

import { NavChats } from "@/components/nav-chats"
import { NavCrm } from "@/components/nav-crm"
import { NavUser } from "@/components/nav-user"
import { TeamSwitcher } from "@/components/team-switcher"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar"
import {
  adminModuleDefinitions,
  type AdminModuleKey,
} from "@/lib/admin-modules"

const moduleIconMap: Record<AdminModuleKey, React.ComponentType> = {
  config_users: Users,
  config_business: BriefcaseBusiness,
  config_permissions: UserCog,
  config_whatsapp: MessageSquareMore,
  products: Package,
  categories: Tags,
  suppliers: Truck,
  quotes: Blocks,
  chats: MessageSquare,
  contacts: Users2,
  crm: KanbanSquare,
  flows: FileText,
  seguimientos: AlarmClock,
  campanas: Send,
  marketing_ia: Megaphone,
  finanzas: Wallet,
  connection: Cable,
  agents: Bot,
  agents_v2: Workflow,
  products_v2: Package,
  llamadas: PhoneCall,
  diagramas: Share2,
  tableros_inteligentes: Network,
  reuniones: Video,
  client_official_api: MessageSquare,
  client_team: Users,
}

type AppSidebarProps = React.ComponentProps<typeof Sidebar> & {
  adminModuleAccess?: Record<AdminModuleKey, boolean>
  brandName?: string
  user?: {
    name?: string | null
    email?: string | null
    image?: string | null
    role?: string | null
  }
  currentConnectionKey?: string
  /** Dueño, administrador o supervisora: le aparece el Tablero del equipo dentro de CRM. */
  puedeSupervisarElEquipo?: boolean
  /** Dueño o administrador: le aparece el Supervisor dentro de CRM. */
  esJefeDelNegocio?: boolean
  /** Dueño, administrador o la supervisora del Supervisor accionable: le aparece Recuperación. */
  veRecuperacion?: boolean
  chatSidebarItems?: Array<{
    title: string
    url: string
    helper?: string
    kind?: "general" | "evolution" | "official"
  }>
}

export function AppSidebar({
  adminModuleAccess = {} as Record<AdminModuleKey, boolean>,
  brandName = "Workspace",
  user,
  currentConnectionKey = "",
  esJefeDelNegocio = false,
  chatSidebarItems = [],
  ...props
}: AppSidebarProps) {
  const pathname = usePathname()
  const visibleModules = adminModuleDefinitions.filter((module) => adminModuleAccess[module.key])
  const visibleModulesWithoutChats = visibleModules.filter(
    (module) => module.key !== "chats" && module.key !== "crm" && module.key !== "config_business" && module.key !== "config_permissions" && module.key !== "config_whatsapp",
  )
  const topModules = visibleModulesWithoutChats.filter((module) =>
    module.key === "products" || module.key === "categories" || module.key === "suppliers",
  )
  const contactsModule = visibleModulesWithoutChats.find((module) => module.key === "contacts") ?? null
  const ContactsIcon = contactsModule ? moduleIconMap[contactsModule.key] : null
  const remainingModules = visibleModulesWithoutChats.filter(
    (module) => module.key !== "products" && module.key !== "categories" && module.key !== "suppliers" && module.key !== "contacts",
  )
  const businessHref = user?.role === "CLIENTE" || user?.role === "ADMIN" ? "/cliente/negocio" : null

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader className="p-1.5">
        <TeamSwitcher
          teams={[
            {
              name: brandName,
              logo: <Bot />,
              plan: "Workspace",
            },
          ]}
        />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup >
          <SidebarGroupContent className="flex flex-col">
            <SidebarMenu>
              {topModules.map((module) => {
                const Icon = moduleIconMap[module.key]
                const isActive = pathname === module.path || pathname.startsWith(`${module.path}/`)

                return (
                  <SidebarMenuItem key={module.key}>
                    <SidebarMenuButton render={<Link href={module.path} />} isActive={isActive}>
                      <Icon />
                      <span>{module.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
            {/* "Inicio" y aparte del CRM a proposito: el CRM es la herramienta del negocio y esta
                pantalla es como viene UNA persona —es lo primero que abre en el dia—. Metida
                adentro del CRM se leia como una vista mas del informe general, que es justo lo
                que no es. */}
            {adminModuleAccess.crm ? (
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    render={<Link href="/cliente/mi-tablero" />}
                    isActive={pathname.startsWith("/cliente/mi-tablero")}
                  >
                    <Home />
                    <span>Inicio</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            ) : null}
            {adminModuleAccess.chats ? (
              <NavChats
                currentConnectionKey={currentConnectionKey}
                isChatsRoute={pathname.startsWith("/cliente/chats")}
                chatSidebarItems={chatSidebarItems}
              />
            ) : null}
            {adminModuleAccess.crm ? (
              <NavCrm
                currentView={
                  pathname.startsWith("/cliente/crm/tablero")
                    ? "tablero"
                    : pathname.startsWith("/cliente/crm/informe")
                      ? "informe"
                    : pathname.startsWith("/cliente/crm/supervisor")
                      ? "supervisor"
                    : pathname.startsWith("/cliente/crm/agente-de-ventas")
                      ? "agente-de-ventas"
                      : pathname.startsWith("/cliente/crm/agente-de-marketing")
                        ? "agente-de-marketing"
                      : pathname.startsWith("/cliente/crm/agente-de-sistemas")
                        ? "agente-de-sistemas"
                    : pathname.startsWith("/cliente/crm/pauta")
                      ? "pauta"
                    : pathname.startsWith("/cliente/crm/comparar-embudos")
                      ? "comparar-embudos"
                    : pathname.startsWith("/cliente/crm/embudo")
                      ? "embudo"
                    : pathname.startsWith("/cliente/crm/recuperacion")
                      ? "recuperacion"
                    : pathname.startsWith("/cliente/crm/kanban")
                      ? "kanban"
                      : pathname.startsWith("/cliente/crm/registro")
                        ? "registro"
                        : pathname.startsWith("/cliente/crm/guiones")
                          ? "guiones"
                          : "mi-dia"
                }
                isCrmRoute={pathname.startsWith("/cliente/crm")}
                esJefe={esJefeDelNegocio}
              />
            ) : null}
            {/* El coach de ventas: el jefe ve al equipo; cada asesora, solo lo suyo. */}
            {adminModuleAccess.crm ? (
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    render={<Link href="/cliente/equipo/coach" />}
                    isActive={pathname.startsWith("/cliente/equipo/coach")}
                  >
                    <GraduationCap />
                    <span>Coach</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            ) : null}
            {/*
              Automatizaciones va SOLA, fuera del CRM: es administrativa (mover leads en cantidad) y no
              una vista de trabajo. A una asesora no se le muestra; la pagina igual exige ser dueño o
              administrador del negocio.
            */}
            {esJefeDelNegocio ? (
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    render={<Link href="/cliente/automatizaciones" />}
                    isActive={pathname.startsWith("/cliente/automatizaciones")}
                  >
                    <Workflow />
                    <span>Automatizaciones</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                {/* El libro de reglas del V3: se dicta por Claude y aca se mira lo que quedo. */}
                <SidebarMenuItem>
                  <SidebarMenuButton
                    render={<Link href="/cliente/agente-v3" />}
                    isActive={pathname.startsWith("/cliente/agente-v3")}
                  >
                    <BookOpen />
                    <span>Agente V3</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                {/* Conectar Claude por MCP ahora es una pestaña de Negocio (/cliente/negocio/claude). */}
              </SidebarMenu>
            ) : null}
            {contactsModule ? (
              <SidebarMenu>
                <SidebarMenuItem key={contactsModule.key}>
                  <SidebarMenuButton
                    render={<Link href={contactsModule.path} />}
                    isActive={pathname === contactsModule.path || pathname.startsWith(`${contactsModule.path}/`)}
                  >
                    {ContactsIcon ? <ContactsIcon /> : null}
                    <span>{contactsModule.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            ) : null}
            <SidebarMenu>
              {remainingModules.map((module) => {
                const Icon = moduleIconMap[module.key]
                const isActive = pathname === module.path || pathname.startsWith(`${module.path}/`)

                return (
                  <SidebarMenuItem key={module.key}>
                    <SidebarMenuButton render={<Link href={module.path} />} isActive={isActive}>
                      <Icon />
                      <span>{module.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="p-1.5">
        <NavUser
          user={{
            name: user?.name ?? "Usuario",
            email: user?.email ?? "usuario@example.com",
            avatar: user?.image ?? "/avatars/shadcn.jpg",
          }}
          businessHref={businessHref}
        />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
