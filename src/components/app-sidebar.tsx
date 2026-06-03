"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  AlarmClock,
  Bot,
  BriefcaseBusiness,
  Cable,
  Blocks,
  FileText,
  KanbanSquare,
  Megaphone,
  MessageSquare,
  MessageSquareMore,
  Package,
  Tags,
  Truck,
  UserCog,
  Users,
  Users2,
  Wallet,
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
  marketing_ia: Megaphone,
  finanzas: Wallet,
  connection: Cable,
  agents: Bot,
  client_official_api: MessageSquare,
}

type AppSidebarProps = React.ComponentProps<typeof Sidebar> & {
  adminModuleAccess?: Record<AdminModuleKey, boolean>
  brandName?: string
  user?: {
    name?: string | null
    email?: string | null
    image?: string | null
  }
  currentConnectionKey?: string
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
                  pathname.startsWith("/cliente/crm/informe")
                    ? "informe"
                    : pathname.startsWith("/cliente/crm/kanban")
                      ? "kanban"
                      : "registro"
                }
                isCrmRoute={pathname.startsWith("/cliente/crm")}
              />
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
        />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
