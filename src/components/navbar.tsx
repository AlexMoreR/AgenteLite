"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { Fragment } from "react";
import type { Role } from "@prisma/client";
import { Bot, ChevronDown, Facebook, Instagram, LayoutDashboard, LogOut, Menu, Search, Settings, UserCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ThemeToggleButton } from "@/components/ui/theme-toggle";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const roleLinks = {
  ADMIN: "/admin",
  EMPLEADO: "/empleado",
  CLIENTE: "/cliente",
} as const;

type InitialUser = {
  name?: string | null;
  email?: string | null;
  role?: Role;
  primaryWorkspaceId?: string | null;
};

export function Navbar({
  initialUser,
  brandName,
  adminModuleAccess,
}: {
  initialUser: InitialUser | null;
  brandName: string;
  adminModuleAccess?: {
    config_users?: boolean;
    config_business?: boolean;
    config_permissions?: boolean;
    config_whatsapp?: boolean;
  };
}) {
  const { data, status } = useSession();
  const user = data?.user ?? initialUser;
  const pathname = usePathname();
  if (pathname === "/login" || pathname === "/register") return null;
  const dashboardHref =
    user?.role === "EMPLEADO" && user.primaryWorkspaceId
      ? "/cliente"
      : user?.role
        ? roleLinks[user.role]
        : null;
  const initials = (user?.name ?? user?.email ?? "U").slice(0, 1).toUpperCase();
  const isMarketingHome = pathname === "/";

  const canAccessConfig = Boolean(
    adminModuleAccess?.config_users ||
      adminModuleAccess?.config_business ||
      adminModuleAccess?.config_permissions ||
      adminModuleAccess?.config_whatsapp,
  );

  const navLinks: Array<{ label: string; href: string }> = [];
  const isActiveLink = (href: string) =>
    href === "/"
      ? pathname === "/"
      : pathname === href || pathname.startsWith(`${href}/`);
  const navLinkClass = (href: string) =>
    isActiveLink(href)
      ? "rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow-sm"
      : "rounded-full px-3 py-1.5 text-xs font-semibold text-foreground transition hover:bg-muted hover:text-primary";
  const socialLinks = [
    {
      label: "Instagram",
      href: "https://www.instagram.com/magilus.co?igsh=MWc5aHV4Nnc1enJpbg==",
      icon: Instagram,
    },
    { label: "Facebook", href: "https://www.facebook.com/share/1C7NgCJa1q/", icon: Facebook },
  ];
  const topMenuLinks = [
    { label: "Tiendas", href: "/" },
    { label: "Quienes somos", href: "/" },
    { label: "Clientes satisfechos", href: "/" },
    { label: "Centro de ayuda", href: "/" },
    { label: "Envios", href: "/" },
    { label: "Ofertas", href: "/" },
    { label: "Vende con nosotros", href: "/" },
  ];
  const marketingLinks = [
    { label: "Beneficios", href: "#beneficios" },
    { label: "Precios", href: "#precios" },
    { label: "Como funciona", href: "#como-funciona" },
  ];

  if (isMarketingHome) {
    return (
      <header className="sticky top-0 z-40 border-b border-white/8 bg-slate-900/80 backdrop-blur-xl">
        <div className="mx-auto flex h-18 w-full max-w-7xl items-center justify-between gap-4 px-4 md:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <Link href="/" className="inline-flex items-center gap-3 rounded-full" aria-label="Inicio">
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-teal-400/20 bg-teal-950 text-teal-200">
                <Bot className="h-5 w-5" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold tracking-widest text-teal-200">
                  {brandName.toUpperCase()}
                </span>
                <span className="block truncate text-xs text-slate-400">Agentes IA para WhatsApp</span>
              </span>
            </Link>

            <nav className="hidden items-center gap-1 lg:flex">
              {marketingLinks.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded-full px-4 py-2 text-sm font-medium text-slate-300 transition hover:bg-white/6 hover:text-white"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>

          <div className="flex items-center gap-2">
            <ThemeToggleButton />
            {user ? (
              <>
                {dashboardHref ? (
                  <Button
                    asChild
                    variant="ghost"
                    size="sm"
                    className="hidden h-10 rounded-full border border-white/10 bg-white/6 px-4 text-white hover:bg-white/10 md:inline-flex"
                  >
                    <Link href={dashboardHref}>Ir al dashboard</Link>
                  </Button>
                ) : null}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-10 gap-2 rounded-full border border-white/10 bg-white/6 px-2.5 text-white transition hover:bg-white/10"
                    >
                      <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-white/10 text-xs font-semibold text-white">
                        {initials}
                      </span>
                      <span className="hidden max-w-40 truncate sm:inline">{user.name ?? user.email}</span>
                      <ChevronDown className="h-4 w-4 text-slate-400" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <div className="border-b border-border px-2 py-2">
                      <p className="truncate text-sm font-medium text-foreground">{user.name ?? "Usuario"}</p>
                      <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                    </div>
                    <DropdownMenuItem asChild>
                      <Link href="/profile" className="flex items-center gap-2">
                        <UserCircle2 className="h-4 w-4 text-muted-foreground" />
                        Perfil
                      </Link>
                    </DropdownMenuItem>
                    {dashboardHref && (
                      <DropdownMenuItem asChild>
                        <Link href={dashboardHref} className="flex items-center gap-2">
                          <LayoutDashboard className="h-4 w-4 text-muted-foreground" />
                          Dashboard
                        </Link>
                      </DropdownMenuItem>
                    )}
                    {user.role === "ADMIN" && canAccessConfig && (
                      <DropdownMenuItem asChild>
                        <Link href="/admin/configuracion" className="flex items-center gap-2">
                          <Settings className="h-4 w-4 text-muted-foreground" />
                          Configuracion
                        </Link>
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem onClick={() => signOut({ callbackUrl: "/login" })} className="flex items-center gap-2">
                      <LogOut className="h-4 w-4 text-muted-foreground" />
                      Cerrar sesion
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            ) : (
              <>
                <Button
                  asChild
                  variant="ghost"
                  size="sm"
                  className="hidden h-10 rounded-full border border-white/10 bg-white/6 px-4 text-white hover:bg-white/10 md:inline-flex"
                >
                  <Link href="/login">Iniciar sesion</Link>
                </Button>
                <Button
                  asChild
                  size="sm"
                  className="h-10 rounded-full bg-teal-400 px-4 text-teal-950 hover:bg-teal-300 md:hidden"
                >
                  <Link href="/login">Iniciar sesion</Link>
                </Button>
                <Button
                  asChild
                  size="sm"
                  className="hidden h-10 rounded-full bg-teal-400 px-4 text-teal-950 hover:bg-teal-300 md:inline-flex"
                >
                  <Link href="/register">Comienza gratis</Link>
                </Button>
              </>
            )}
          </div>
        </div>
      </header>
    );
  }

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur-md">
      <div className="hidden border-b border-border bg-background/65 md:block">
        <div className="mx-auto flex h-8 w-full items-center justify-start gap-2 overflow-x-auto whitespace-nowrap px-3 text-xs text-muted-foreground md:justify-center md:px-7">
          <span className="font-medium text-foreground">Servicio al cliente +57 304-648-1994</span>
          {topMenuLinks.map((item) => (
            <Fragment key={item.label}>
              <span className="text-muted-foreground">|</span>
              <Link href={item.href} className="transition hover:text-primary">
                {item.label}
              </Link>
            </Fragment>
          ))}
        </div>
      </div>
      <div className="mx-auto flex h-14 w-full items-center justify-between gap-2 px-3 md:h-16 md:px-7">
        <div className="flex min-w-0 items-center gap-2.5">
          <Link href="/" className="inline-flex items-center rounded-md" aria-label="Inicio">
            <Image
              src="/magilus-logo.svg"
              alt={brandName}
              width={260}
              height={72}
              className="h-12 w-auto md:h-14"
              priority
            />
          </Link>

          <nav className="hidden items-center gap-4 md:flex">
            {navLinks.map((item) => {
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={navLinkClass(item.href)}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>

        <form action="/" method="get" className="mx-1 max-w-xl flex-1">
          <div className="relative transition-shadow duration-200 focus-within:drop-shadow-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-primary" />
            <Input
              name="q"
              placeholder="Buscar producto"
              className="h-9 rounded-full border-input bg-background/95 pl-9 pr-4 text-sm text-foreground shadow-sm focus-visible:h-10 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50 md:h-10"
            />
          </div>
        </form>

        <div className="flex items-center gap-1.5 md:gap-2">
          <div className="flex items-center gap-1">
            {socialLinks.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.label}
                  href={item.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={item.label}
                  title={item.label}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border bg-card/90 text-primary shadow-sm transition hover:-translate-y-0.5 hover:bg-muted md:h-9 md:w-9"
                >
                  <Icon className="h-3.5 w-3.5 md:h-4 md:w-4" />
                </Link>
              );
            })}
          </div>

          {user && navLinks.length > 0 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="md:hidden" aria-label="Abrir menu">
                  <Menu className="h-4 w-4 text-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52 md:hidden">
                {navLinks.map((item) => (
                  <DropdownMenuItem key={item.href} asChild>
                    <Link href={item.href} className={isActiveLink(item.href) ? "w-full font-medium text-foreground" : "w-full"}>
                      {item.label}
                    </Link>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}

          {status === "loading" ? (
            <div className="hidden h-8 w-24 animate-pulse rounded-md bg-muted sm:block" />
          ) : !user ? (
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card/90 p-0 text-primary shadow-sm transition hover:bg-muted md:h-10 md:w-auto md:gap-2 md:px-3"
            >
              <Link href="/login">
                <UserCircle2 className="h-4 w-4 text-muted-foreground" />
                <span className="hidden md:inline">Cuenta</span>
              </Link>
            </Button>
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-9 gap-2 rounded-full border border-border bg-card/90 px-2.5 text-foreground shadow-sm transition hover:bg-muted md:h-10"
                >
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-muted text-xs font-semibold text-foreground">
                    {initials}
                  </span>
                  <span className="hidden max-w-40 truncate text-foreground sm:inline">
                    {user.name ?? user.email}
                  </span>
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <div className="border-b border-border px-2 py-2">
                  <p className="truncate text-sm font-medium text-foreground">{user.name ?? "Usuario"}</p>
                  <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                </div>
                <DropdownMenuItem asChild>
                  <Link href="/profile" className="flex items-center gap-2">
                    <UserCircle2 className="h-4 w-4 text-muted-foreground" />
                    Perfil
                  </Link>
                </DropdownMenuItem>
                {dashboardHref && (
                  <DropdownMenuItem asChild>
                    <Link href={dashboardHref} className="flex items-center gap-2">
                      <LayoutDashboard className="h-4 w-4 text-muted-foreground" />
                      Dashboard
                    </Link>
                  </DropdownMenuItem>
                )}
                {user.role === "ADMIN" && canAccessConfig && (
                  <DropdownMenuItem asChild>
                    <Link href="/admin/configuracion" className="flex items-center gap-2">
                      <Settings className="h-4 w-4 text-muted-foreground" />
                      Configuracion
                    </Link>
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={() => signOut({ callbackUrl: "/login" })} className="flex items-center gap-2">
                  <LogOut className="h-4 w-4 text-muted-foreground" />
                  Cerrar sesion
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
    </header>
  );
}
