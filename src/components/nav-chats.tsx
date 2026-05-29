"use client";

import Link from "next/link";
import { useState } from "react";
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

type ChatSidebarItem = {
  title: string;
  url: string;
  helper?: string;
  kind?: "general" | "evolution" | "official";
};

export function NavChats({
  currentConnectionKey,
  isChatsRoute,
  chatSidebarItems,
}: {
  currentConnectionKey: string;
  isChatsRoute: boolean;
  chatSidebarItems: ChatSidebarItem[];
}) {
  const [manualOpen, setManualOpen] = useState(true);
  const mappedChatSidebarItems = chatSidebarItems.map((item) => {
    const itemConnection = new URL(item.url, "http://localhost").searchParams.get("connection")?.trim() || "";
    return {
      ...item,
      isActive: Boolean(currentConnectionKey) && currentConnectionKey === itemConnection,
    };
  });
  const isChatsGeneralActive = isChatsRoute && !currentConnectionKey;
  const open = Boolean(manualOpen || isChatsRoute);

  return (
    <SidebarGroup className="group-data-[collapsible=icon]/sidebar:hidden">
      <SidebarMenu>
        <Collapsible asChild open={open} onOpenChange={setManualOpen}>
          <SidebarMenuItem>
            <div className="relative">
              <SidebarMenuButton asChild isActive={isChatsRoute} className="pr-9">
                <Link href="/cliente/chats" prefetch>
                  <MessageSquareText className="h-4 w-4" />
                  <span>Chats</span>
                </Link>
              </SidebarMenuButton>

              <CollapsibleTrigger asChild>
                <SidebarMenuAction
                  className={`group-data-[collapsible=icon]/sidebar:hidden ${
                    manualOpen ? "hover:bg-muted/70" : ""
                  }`}
                >
                  <ChevronDown className={`h-4 w-4 transition ${manualOpen ? "rotate-180" : ""}`} />
                  <span className="sr-only">Abrir submenu de Chats</span>
                </SidebarMenuAction>
              </CollapsibleTrigger>
            </div>

            <CollapsibleContent className="group-data-[collapsible=icon]/sidebar:hidden">
              <div className="mt-1.5">
                <SidebarMenuSub className="ml-3 gap-1 border-l border-slate-200 pl-2">
                  <SidebarMenuSubItem key="general">
                    <SidebarMenuSubButton
                      asChild
                      isActive={isChatsGeneralActive}
                      className={`h-auto rounded-lg px-2.5 py-2 ${
                        isChatsGeneralActive ? "bg-muted text-foreground" : "hover:bg-slate-50"
                      }`}
                    >
                      <Link href="/cliente/chats" prefetch className="flex min-h-8 items-center gap-2.5">
                        <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-slate-500">
                          <MessageSquareText className="h-4 w-4" />
                        </span>
                        <span
                          className={`block flex-1 truncate text-[13px] font-medium ${
                            isChatsGeneralActive ? "text-foreground" : "text-slate-700"
                          }`}
                        >
                          Bandeja
                        </span>
                      </Link>
                    </SidebarMenuSubButton>
                  </SidebarMenuSubItem>

                  {mappedChatSidebarItems.map((item) => (
                    <SidebarMenuSubItem key={item.url}>
                      <SidebarMenuSubButton
                        asChild
                        isActive={Boolean(item.isActive)}
                        className={`h-auto rounded-lg px-2.5 py-2 ${
                          item.isActive ? "bg-muted text-foreground" : "hover:bg-slate-50"
                        }`}
                      >
                        <Link href={item.url} prefetch className="flex min-h-8 items-center gap-2.5">
                          <span
                            className={`inline-flex h-4 w-4 shrink-0 items-center justify-center ${
                              item.kind === "evolution"
                                ? "text-emerald-600"
                                : item.kind === "official"
                                  ? "text-sky-600"
                                  : "text-slate-500"
                            }`}
                          >
                            {item.kind === "official" ? (
                              <BadgeCheck className="h-4 w-4" />
                            ) : item.kind === "evolution" ? (
                              <WhatsAppGlyph className="h-4 w-4" />
                            ) : (
                              <MessageSquareText className="h-4 w-4" />
                            )}
                          </span>
                          <span
                            className={`block flex-1 truncate text-[13px] font-medium ${
                              item.isActive ? "text-foreground" : "text-slate-700"
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
