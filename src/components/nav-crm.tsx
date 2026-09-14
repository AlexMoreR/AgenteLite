"use client";

import Link from "next/link";
import { useState } from "react";
import { BookOpen, ChartNoAxesCombined, ChevronDown, FileText, KanbanSquare, Sun, Workflow, type LucideIcon } from "lucide-react";
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

type CrmView = "mi-dia" | "registro" | "kanban" | "informe" | "guiones" | "automatizaciones";

const crmViews: Array<{
  title: string;
  view: CrmView;
  icon: LucideIcon;
}> = [
  { title: "Mi día", view: "mi-dia", icon: Sun },
  { title: "Registro", view: "registro", icon: FileText },
  { title: "Kanban", view: "kanban", icon: KanbanSquare },
  { title: "Informe", view: "informe", icon: ChartNoAxesCombined },
  { title: "Guiones", view: "guiones", icon: BookOpen },
  { title: "Automatizaciones", view: "automatizaciones", icon: Workflow },
];

export function NavCrm({
  currentView,
  isCrmRoute,
  mostrarAutomatizaciones = false,
}: {
  currentView: CrmView;
  isCrmRoute: boolean;
  /** Solo para quien puede usarlas (dueño o administrador): a una asesora le llevaria a un aviso. */
  mostrarAutomatizaciones?: boolean;
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
            {crmViews.filter((item) => mostrarAutomatizaciones || item.view !== "automatizaciones").map((item) => (
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
