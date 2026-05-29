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
  SidebarGroup,
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
  const [manualOpen, setManualOpen] = useState(true);

  return (
    <SidebarGroup className="group-data-[collapsible=icon]/sidebar:hidden">
      <SidebarMenu>
        <Collapsible asChild open={manualOpen} onOpenChange={setManualOpen}>
          <SidebarMenuItem>
            <div className="relative">
              <SidebarMenuButton asChild isActive={isCrmRoute} className="pr-9">
                <Link href="/cliente/crm/registro" prefetch>
                  <ChartNoAxesCombined className="h-4 w-4" />
                  <span>CRM</span>
                </Link>
              </SidebarMenuButton>

              <CollapsibleTrigger asChild>
                <SidebarMenuAction
                  className={`group-data-[collapsible=icon]/sidebar:hidden ${
                    manualOpen ? "hover:bg-muted/70" : ""
                  }`}
                >
                  <ChevronDown className={`h-4 w-4 transition ${manualOpen ? "rotate-180" : ""}`} />
                  <span className="sr-only">Abrir submenu de CRM</span>
                </SidebarMenuAction>
              </CollapsibleTrigger>
            </div>

            <CollapsibleContent className="group-data-[collapsible=icon]/sidebar:hidden">
              <div className="mt-1.5">
                <SidebarMenuSub className="ml-3 gap-1 border-l border-slate-200 pl-2">
                  {crmViews.map((item) => (
                    <SidebarMenuSubItem key={item.view}>
                      <SidebarMenuSubButton
                        asChild
                        isActive={currentView === item.view}
                        className={`h-auto rounded-lg px-2.5 py-2 ${
                          currentView === item.view ? "bg-muted text-foreground" : "hover:bg-slate-50"
                        }`}
                      >
                        <Link href={`/cliente/crm/${item.view}`} prefetch className="flex min-h-8 items-center gap-2.5">
                          <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-slate-500">
                            <item.icon className="h-4 w-4" />
                          </span>
                          <span
                            className={`block flex-1 truncate text-[13px] font-medium ${
                              currentView === item.view ? "text-foreground" : "text-slate-700"
                            }`}
                          >
                            {item.title}
                          </span>
                        </Link>
                      </SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                  ))}
                </SidebarMenuSub>
              </div>
            </CollapsibleContent>
          </SidebarMenuItem>
        </Collapsible>
      </SidebarMenu>
    </SidebarGroup>
  );
}
