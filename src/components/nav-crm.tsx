"use client";

import Link from "next/link";
import { useState } from "react";
import { ChartNoAxesCombined, ChevronDown, FileText, KanbanSquare, type LucideIcon } from "lucide-react";
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

type CrmView = "registro" | "kanban" | "informe";

const crmViews: Array<{
  title: string;
  view: CrmView;
  icon: LucideIcon;
}> = [
  { title: "Registro", view: "registro", icon: FileText },
  { title: "Kanban", view: "kanban", icon: KanbanSquare },
  { title: "Informe", view: "informe", icon: ChartNoAxesCombined },
];

export function NavCrm({ currentView, isCrmRoute }: { currentView: CrmView; isCrmRoute: boolean }) {
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
            {crmViews.map((item) => (
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
