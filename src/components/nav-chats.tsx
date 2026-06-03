"use client"

import Link from "next/link"
import { useState } from "react"
import { BadgeCheck, ChevronDown, MessageSquareText } from "lucide-react"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { WhatsAppGlyph } from "@/components/icons/whatsapp-glyph"
import {
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar"

type ChatSidebarItem = {
  title: string
  url: string
  helper?: string
  kind?: "general" | "evolution" | "official"
}

export function NavChats({
  currentConnectionKey,
  isChatsRoute,
  chatSidebarItems,
}: {
  currentConnectionKey: string
  isChatsRoute: boolean
  chatSidebarItems: ChatSidebarItem[]
}) {
  const [manualOpen, setManualOpen] = useState(false)
  const open = manualOpen || isChatsRoute

  const mappedChatSidebarItems = chatSidebarItems.map((item) => {
    const itemConnection = new URL(item.url, "http://localhost").searchParams.get("connection")?.trim() || ""

    return {
      ...item,
      isActive: Boolean(currentConnectionKey) && currentConnectionKey === itemConnection,
    }
  })

  return (
    <SidebarMenu>
      <Collapsible open={open} onOpenChange={setManualOpen} render={<SidebarMenuItem />}>
        <div>
          <CollapsibleTrigger render={<SidebarMenuButton isActive={isChatsRoute} />}>
            <MessageSquareText />
            <span>Chats</span>
          </CollapsibleTrigger>
          <CollapsibleTrigger render={<SidebarMenuAction />}>
            <ChevronDown />
          </CollapsibleTrigger>
        </div>

        <CollapsibleContent>
          <SidebarMenuSub>
            <SidebarMenuSubItem key="general">
              <SidebarMenuSubButton
                render={<Link href="/cliente/chats" prefetch />}
                isActive={isChatsRoute && !currentConnectionKey}
              >
                <MessageSquareText />
                <span>Bandeja</span>
              </SidebarMenuSubButton>
            </SidebarMenuSubItem>

            {mappedChatSidebarItems.map((item) => (
              <SidebarMenuSubItem key={item.url}>
                <SidebarMenuSubButton
                  render={<Link href={item.url} prefetch />}
                  isActive={Boolean(item.isActive)}
                >
                  {item.kind === "official" ? (
                    <BadgeCheck />
                  ) : item.kind === "evolution" ? (
                    <WhatsAppGlyph />
                  ) : (
                    <MessageSquareText />
                  )}
                  <span>{item.title}</span>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            ))}
          </SidebarMenuSub>
        </CollapsibleContent>
      </Collapsible>
    </SidebarMenu>
  )
}
