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
        {/*
          "Chats" ES la bandeja: tocarlo lleva a todas las conversaciones. Antes solo desplegaba
          un submenu cuyo primer renglon se llamaba "Bandeja" y hacia exactamente eso, o sea que
          para llegar a los chats habia que tocar dos veces algo que decia lo mismo dos veces.

          El desplegable queda en la flecha, que es donde estan los canales sueltos.
        */}
        <div>
          <SidebarMenuButton
            render={<Link href="/cliente/chats" prefetch />}
            isActive={isChatsRoute && !currentConnectionKey}
          >
            <MessageSquareText />
            <span>Chats</span>
          </SidebarMenuButton>
          <CollapsibleTrigger render={<SidebarMenuAction />}>
            <ChevronDown />
          </CollapsibleTrigger>
        </div>

        <CollapsibleContent>
          <SidebarMenuSub>
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
