"use client";

import Link from "next/link";
import type { Role } from "@prisma/client";
import { signOut } from "next-auth/react";
import {
  ChevronsUpDown,
  LogOut,
  Settings,
  User,
} from "lucide-react";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

export function NavUser({
  user,
  canAccessConfig,
}: {
  user: {
    name: string;
    email: string;
    avatar: string;
    role?: Role;
  };
  canAccessConfig?: boolean;
}) {
  const { isMobile } = useSidebar();
  const initials = (user.name?.[0] || "U").toUpperCase();
  const rawRole = (user.role ?? "CLIENTE").toLowerCase();
  const roleLabel = rawRole.charAt(0).toUpperCase() + rawRole.slice(1);

  return (
    <SidebarMenu className="w-full">
      <SidebarMenuItem className="w-full">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="w-full rounded-none border-y border-x-0 border-[var(--line)] bg-white text-slate-700 hover:bg-slate-100 data-[state=open]:bg-slate-100"
            >
              <Avatar className="h-8 w-8 rounded-lg">
                <AvatarImage src={user.avatar} alt={user.name} />
                <AvatarFallback className="rounded-lg bg-slate-200 text-slate-700">{initials}</AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]/sidebar:hidden">
                <span className="truncate font-medium text-slate-900">{user.name}</span>
                <span className="text-xs  text-slate-500">
                  {roleLabel}
                </span>
              </div>
              <ChevronsUpDown className="ml-auto h-4 w-4 text-black group-data-[collapsible=icon]/sidebar:hidden" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="min-w-56 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-2 py-1.5 text-left text-sm">
                <Avatar className="h-8 w-8 rounded-lg">
                  <AvatarImage src={user.avatar} alt={user.name} />
                  <AvatarFallback className="rounded-lg">{initials}</AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">{user.name}</span>
                  <span className="text-xs font-semibold text-slate-500">
                    {roleLabel}
                  </span>
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem asChild>
                <Link href="/profile" className="flex items-center gap-2">
                  <User className="h-4 w-4" />
                  Mi perfil
                </Link>
              </DropdownMenuItem>
              {user.role === "ADMIN" && canAccessConfig ? (
                <DropdownMenuItem asChild>
                  <Link href="/admin/configuracion" className="flex items-center gap-2">
                    <Settings className="h-4 w-4" />
                    Configuracion
                  </Link>
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="flex items-center gap-2"
            >
              <LogOut className="h-4 w-4" />
              Cerrar sesion
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
