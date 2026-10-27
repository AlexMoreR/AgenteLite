"use client";

import Link from "next/link";
import { useState } from "react";
import { BookOpen, ChartNoAxesCombined, ChevronDown, Gauge, KanbanSquare, Sun, type LucideIcon } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";

type CrmView = "mi-dia" | "registro" | "kanban" | "tablero" | "guiones";

const crmViews: Array<{
  title: string;
  view: CrmView;
  icon: LucideIcon;
  /** Solo dueño o administrador del negocio (Alex, 26-10-2026): ni supervisoras ni asesoras. */
  soloJefes?: boolean;
}> = [
  { title: "Mi día", view: "mi-dia", icon: Sun },
  // Registro ya no está en el menú (Alex, 26-10-2026): la pantalla y los datos siguen, solo se esconde el botón.
  { title: "Kanban", view: "kanban", icon: KanbanSquare },
  // Tablero y Guiones: solo dueño o administrador; las demás cuentas ven solo Mi día y Kanban.
  // Solo para quien supervisa: es como viene CADA asesora, no el trabajo de una.
  { title: "Tablero", view: "tablero", icon: Gauge, soloJefes: true },
  { title: "Guiones", view: "guiones", icon: BookOpen, soloJefes: true },
];

export function NavCrm({
  currentView,
  isCrmRoute,
  esJefe = false,
}: {
  currentView: CrmView;
  isCrmRoute: boolean;
  /** Dueño o administrador del negocio: los únicos que ven los apartados de jefe. */
  esJefe?: boolean;
}) {
  const [manualOpen, setManualOpen] = useState(false);
  const open = manualOpen || isCrmRoute;

  return (
    <SidebarMenu>
      <Collapsible open={open} onOpenChange={setManualOpen} render={<SidebarMenuItem />}>
        <div>
          <CollapsibleTrigger render={<SidebarMenuButton isActive={isCrmRoute} />}>
            <ChartNoAxesCombined />
            <span>CRM</span>
          </CollapsibleTrigger>
          <CollapsibleTrigger render={<SidebarMenuAction />}>
            <ChevronDown />
          </CollapsibleTrigger>
        </div>

        <CollapsibleContent>
          <SidebarMenuSub>
            {crmViews
              .filter((item) => !item.soloJefes || esJefe)
              .map((item) => (
              <SidebarMenuSubItem key={item.view}>
                {/* Sin `prefetch`: eran seis vistas del CRM pedidas enteras desde cualquier pantalla. */}
                <SidebarMenuSubButton
                  render={<Link href={`/cliente/crm/${item.view}`} />}
                  isActive={currentView === item.view}
                >
                  <item.icon />
                  <span>{item.title}</span>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
              ))}
          </SidebarMenuSub>
        </CollapsibleContent>
      </Collapsible>
    </SidebarMenu>
  );
}
