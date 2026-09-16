"use client";

import Link from "next/link";
import { useState } from "react";
import { BookOpen, ChartNoAxesCombined, ChevronDown, FileText, Gauge, KanbanSquare, Sun, type LucideIcon } from "lucide-react";
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

type CrmView = "mi-dia" | "registro" | "kanban" | "informe" | "tablero" | "guiones";

const crmViews: Array<{
  title: string;
  view: CrmView;
  icon: LucideIcon;
  soloJefes?: boolean;
}> = [
  { title: "Mi día", view: "mi-dia", icon: Sun },
  { title: "Registro", view: "registro", icon: FileText },
  { title: "Kanban", view: "kanban", icon: KanbanSquare },
  { title: "Informe", view: "informe", icon: ChartNoAxesCombined },
  // Solo para quien supervisa: es como viene CADA asesora, no el trabajo de una.
  { title: "Tablero", view: "tablero", icon: Gauge, soloJefes: true },
  { title: "Guiones", view: "guiones", icon: BookOpen },
];

export function NavCrm({
  currentView,
  isCrmRoute,
  puedeSupervisar = false,
}: {
  currentView: CrmView;
  isCrmRoute: boolean;
  /** Dueño, administrador o supervisora: a ellos se les muestra el Tablero del equipo. */
  puedeSupervisar?: boolean;
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
              .filter((item) => !item.soloJefes || puedeSupervisar)
              .map((item) => (
              <SidebarMenuSubItem key={item.view}>
                <SidebarMenuSubButton
                  render={<Link href={`/cliente/crm/${item.view}`} prefetch />}
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
