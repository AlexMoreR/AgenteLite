"use client";

import type { ComponentType } from "react";
import { useState } from "react";
import Link from "next/link";
import { BadgeCheck, ChevronDown, MessageSquareText } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { WhatsAppGlyph } from "@/components/icons/whatsapp-glyph";
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

type NavMainIcon = ComponentType<{ className?: string }>;

export type NavMainItem = {
  title: string;
  url: string;
  icon?: NavMainIcon;
  isActive?: boolean;
  expandable?: boolean;
  items?: {
    title: string;
    url: string;
    helper?: string;
    kind?: "general" | "evolution" | "official";
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
        <div className="relative">
          <SidebarMenuButton asChild isActive={item.isActive} className="pr-9">
            <Link href={item.url}>
              {item.icon ? <item.icon className="h-4 w-4" /> : null}
              <span className="group-data-[collapsible=icon]/sidebar:hidden">{item.title}</span>
            </Link>
          </SidebarMenuButton>

          <CollapsibleTrigger asChild>
            <SidebarMenuAction
              className={`group-data-[collapsible=icon]/sidebar:hidden ${
                open ? "text-white/90 hover:bg-white/15 hover:text-white" : ""
              }`}
            >
              <ChevronDown className={`h-4 w-4 transition ${open ? "rotate-180" : ""}`} />
              <span className="sr-only">Abrir submenu de {item.title}</span>
            </SidebarMenuAction>
          </CollapsibleTrigger>
        </div>

        <CollapsibleContent className="group-data-[collapsible=icon]/sidebar:hidden">
          <div className="mt-1.5">
            <SidebarMenuSub className="ml-3 gap-1 border-l border-slate-200 pl-2">
              {item.items.map((subitem) => (
                <SidebarMenuSubItem key={`${item.title}-${subitem.title}`}>
                  <SidebarMenuSubButton asChild className="h-auto rounded-lg px-2.5 py-2 hover:bg-slate-50">
                    <Link href={subitem.url} className="flex min-h-8 items-center gap-2.5">
                      <span
                        className={`inline-flex h-4 w-4 shrink-0 items-center justify-center ${
                          subitem.kind === "evolution"
                            ? "text-emerald-600"
                            : subitem.kind === "official"
                              ? "text-sky-600"
                              : "text-slate-500"
                        }`}
                      >
                        {subitem.kind === "official" ? (
                          <BadgeCheck className="h-4 w-4" />
                        ) : subitem.kind === "evolution" ? (
                          <WhatsAppGlyph className="h-4 w-4" />
                        ) : (
                          <MessageSquareText className="h-4 w-4" />
                        )}
                      </span>
                      <span className="block flex-1 truncate text-[13px] font-medium text-slate-700">{subitem.title}</span>
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
