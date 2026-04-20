"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, type LucideIcon } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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

export type NavMainItem = {
  title: string;
  url: string;
  icon?: LucideIcon;
  isActive?: boolean;
  expandable?: boolean;
  items?: {
    title: string;
    url: string;
    helper?: string;
  }[];
};

export function NavMain({ items }: { items: NavMainItem[] }) {
  return (
    <SidebarGroup>
      <SidebarMenu>
        {items.map((item) => (
          <NavMainMenuItem key={item.title} item={item} />
        ))}
      </SidebarMenu>
    </SidebarGroup>
  );
}

function NavMainMenuItem({ item }: { item: NavMainItem }) {
  const [manualOpen, setManualOpen] = useState(false);
  const open = Boolean(item.isActive || manualOpen);

  if (!item.expandable || !item.items?.length) {
    return (
      <SidebarMenuItem>
        <SidebarMenuButton asChild isActive={item.isActive}>
          <Link href={item.url}>
            {item.icon ? <item.icon className="h-4 w-4" /> : null}
            <span className="group-data-[collapsible=icon]/sidebar:hidden">{item.title}</span>
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  }

  return (
    <Collapsible asChild open={open} onOpenChange={setManualOpen}>
      <SidebarMenuItem>
        <SidebarMenuButton asChild isActive={item.isActive} className="pr-9">
          <Link href={item.url}>
            {item.icon ? <item.icon className="h-4 w-4" /> : null}
            <span className="group-data-[collapsible=icon]/sidebar:hidden">{item.title}</span>
          </Link>
        </SidebarMenuButton>

        <CollapsibleTrigger asChild>
          <SidebarMenuAction className="group-data-[collapsible=icon]/sidebar:hidden">
            <ChevronDown className={`h-4 w-4 transition ${open ? "rotate-180" : "rotate-0"}`} />
            <span className="sr-only">Abrir submenu de {item.title}</span>
          </SidebarMenuAction>
        </CollapsibleTrigger>

        <CollapsibleContent className="group-data-[collapsible=icon]/sidebar:hidden">
          <div className="mt-1.5">
            <SidebarMenuSub className="ml-5 gap-1 border-l border-slate-200 pl-3">
              {item.items.map((subitem) => (
                <SidebarMenuSubItem key={`${item.title}-${subitem.title}`}>
                  <SidebarMenuSubButton asChild className="h-auto rounded-lg px-2.5 py-2 hover:bg-slate-50">
                    <Link href={subitem.url} className="flex min-h-8 flex-col items-start">
                      <span className="block truncate text-[13px] font-medium text-slate-700">{subitem.title}</span>
                      {subitem.helper ? (
                        <span className="block truncate text-[11px] text-slate-400">{subitem.helper}</span>
                      ) : null}
                    </Link>
                  </SidebarMenuSubButton>
                </SidebarMenuSubItem>
              ))}
            </SidebarMenuSub>
          </div>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  );
}
