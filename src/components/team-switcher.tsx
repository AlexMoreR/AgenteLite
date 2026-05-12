"use client";

import Image from "next/image";
import { cn } from "@/lib/utils";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";

type Team = {
  name: string;
  plan: string;
};

export function TeamSwitcher({ teams }: { teams: Team[] }) {
  const activeTeam = teams[0];

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          size="lg"
          className={cn(
            "group-data-[collapsible=icon]/sidebar:h-9 group-data-[collapsible=icon]/sidebar:w-9 group-data-[collapsible=icon]/sidebar:min-w-9 group-data-[collapsible=icon]/sidebar:justify-center group-data-[collapsible=icon]/sidebar:px-0",
          )}
        >
          <Image
            src="/magilus-logo.svg"
            alt={activeTeam.name}
            width={44}
            height={44}
            className="h-11 w-11 shrink-0 object-contain group-data-[collapsible=icon]/sidebar:h-8 group-data-[collapsible=icon]/sidebar:w-8"
          />
          <div className="grid flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]/sidebar:hidden">
            <span className="truncate text-sm">{activeTeam.name}</span>
          </div>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
