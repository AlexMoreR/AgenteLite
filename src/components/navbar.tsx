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
  const dashboardHref = user?.role ? roleLinks[user.role] : null;
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
      ? "rounded-full bg-[var(--primary)] px-3 py-1.5 text-xs font-semibold text-white shadow-[0_6px_16px_-10px_rgba(15,23,42,0.35)]"
      : "rounded-full px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 hover:text-[var(--primary)]";
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
      <header className="sticky top-0 z-40 border-b border-white/8 bg-[#07111f]/82 backdrop-blur-xl">
        <div className="mx-auto flex h-18 w-full max-w-7xl items-center justify-between gap-4 px-4 md:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <Link href="/" className="inline-flex items-center gap-3 rounded-full" aria-label="Inicio">
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-[#2ed3b7]/20 bg-[#0d2732] text-[#94f0e2]">
                <Bot className="h-5 w-5" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold tracking-[0.2em] text-[#9feede]">
                  {brandName.toUpperCase()}
                </span>
                <span className="block truncate text-xs text-[#8da1b8]">Agentes IA para WhatsApp</span>
              </span>
            </Link>

            <nav className="hidden items-center gap-1 lg:flex">
              {marketingLinks.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded-full px-4 py-2 text-sm font-medium text-[#c8d4e3] transition hover:bg-white/6 hover:text-white"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>

          <div className="flex items-center gap-2">
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
                      <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-white/10 text-[11px] font-semibold text-white">
                        {initials}
                      </span>
                      <span className="hidden max-w-[10rem] truncate sm:inline">{user.name ?? user.email}</span>
                      <ChevronDown className="h-4 w-4 text-[#94a3b8]" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <div className="border-b border-slate-100 px-2 py-2">
                      <p className="truncate text-sm font-medium text-slate-900">{user.name ?? "Usuario"}</p>
                      <p className="truncate text-xs text-slate-500">{user.email}</p>
                    </div>
                    <DropdownMenuItem asChild>
                      <Link href="/profile" className="flex items-center gap-2">
                        <UserCircle2 className="h-4 w-4 text-slate-500" />
                        Perfil
                      </Link>
                    </DropdownMenuItem>
                    {dashboardHref && (
                      <DropdownMenuItem asChild>
                        <Link href={dashboardHref} className="flex items-center gap-2">
                          <LayoutDashboard className="h-4 w-4 text-slate-500" />
                          Dashboard
                        </Link>
                      </DropdownMenuItem>
                    )}
                    {user.role === "ADMIN" && canAccessConfig && (
                      <DropdownMenuItem asChild>
                        <Link href="/admin/configuracion" className="flex items-center gap-2">
                          <Settings className="h-4 w-4 text-slate-500" />
                          Configuracion
                        </Link>
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem onClick={() => signOut({ callbackUrl: "/login" })} className="flex items-center gap-2">
                      <LogOut className="h-4 w-4 text-slate-500" />
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
                  className="h-10 rounded-full bg-[#2ed3b7] px-4 text-[#04131d] hover:bg-[#58e4cc] md:hidden"
                >
                  <Link href="/login">Iniciar sesion</Link>
                </Button>
                <Button
                  asChild
                  size="sm"
                  className="hidden h-10 rounded-full bg-[#2ed3b7] px-4 text-[#04131d] hover:bg-[#58e4cc] md:inline-flex"
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
    <header className="sticky top-0 z-40 border-b border-[var(--line)] bg-white/90 backdrop-blur-md">
      <div className="hidden border-b border-[var(--line)] bg-white/65 md:block">
        <div className="mx-auto flex h-8 w-full items-center justify-start gap-2 overflow-x-auto whitespace-nowrap px-3 text-[11px] text-slate-600 md:justify-center md:px-7">
          <span className="font-medium text-slate-700">Servicio al cliente +57 304-648-1994</span>
          {topMenuLinks.map((item) => (
            <Fragment key={item.label}>
              <span className="text-slate-400">|</span>
              <Link href={item.href} className="transition hover:text-[var(--primary)]">
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
          <div className="relative transition-shadow duration-200 focus-within:drop-shadow-[0_8px_14px_rgba(15,23,42,0.18)]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--primary)]" />
            <Input
              name="q"
              placeholder="Buscar producto"
              className="h-9 rounded-full border-[var(--line)] bg-white/95 pl-9 pr-4 text-sm text-slate-800 shadow-[0_10px_24px_-18px_rgba(15,23,42,0.65)] focus-visible:h-10 focus-visible:border-[var(--primary)] focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--primary)_24%,white)] md:h-10"
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
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[var(--line)] bg-white/90 text-[var(--primary)] shadow-[0_8px_18px_-14px_rgba(15,23,42,0.45)] transition hover:-translate-y-0.5 hover:bg-slate-50 md:h-9 md:w-9"
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
                  <Menu className="h-4 w-4 text-slate-700" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52 md:hidden">
                {navLinks.map((item) => (
                  <DropdownMenuItem key={item.href} asChild>
                    <Link href={item.href} className={isActiveLink(item.href) ? "w-full font-medium text-slate-900" : "w-full"}>
                      {item.label}
                    </Link>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}

          {status === "loading" ? (
            <div className="hidden h-8 w-24 animate-pulse rounded-md bg-slate-100 sm:block" />
          ) : !user ? (
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[var(--line)] bg-white/90 p-0 text-[var(--primary-strong)] shadow-[0_8px_18px_-14px_rgba(15,23,42,0.45)] transition hover:bg-slate-50 md:h-10 md:w-auto md:gap-2 md:px-3"
            >
              <Link href="/login">
                <UserCircle2 className="h-4 w-4 text-slate-600" />
                <span className="hidden md:inline">Cuenta</span>
              </Link>
            </Button>
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-9 gap-2 rounded-full border border-[var(--line)] bg-white/90 px-2.5 text-slate-900 shadow-[0_8px_18px_-14px_rgba(15,23,42,0.45)] transition hover:bg-slate-50 md:h-10"
                >
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-100 text-[11px] font-semibold text-slate-700">
                    {initials}
                  </span>
                  <span className="hidden max-w-[10rem] truncate text-slate-800 sm:inline">
                    {user.name ?? user.email}
                  </span>
                  <ChevronDown className="h-4 w-4 text-slate-500" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <div className="border-b border-slate-100 px-2 py-2">
                  <p className="truncate text-sm font-medium text-slate-900">{user.name ?? "Usuario"}</p>
                  <p className="truncate text-xs text-slate-500">{user.email}</p>
                </div>
                <DropdownMenuItem asChild>
                  <Link href="/profile" className="flex items-center gap-2">
                    <UserCircle2 className="h-4 w-4 text-slate-500" />
                    Perfil
                  </Link>
                </DropdownMenuItem>
                {dashboardHref && (
                  <DropdownMenuItem asChild>
                    <Link href={dashboardHref} className="flex items-center gap-2">
                      <LayoutDashboard className="h-4 w-4 text-slate-500" />
                      Dashboard
                    </Link>
                  </DropdownMenuItem>
                )}
                {user.role === "ADMIN" && canAccessConfig && (
                  <DropdownMenuItem asChild>
                    <Link href="/admin/configuracion" className="flex items-center gap-2">
                      <Settings className="h-4 w-4 text-slate-500" />
                      Configuracion
                    </Link>
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={() => signOut({ callbackUrl: "/login" })} className="flex items-center gap-2">
                  <LogOut className="h-4 w-4 text-slate-500" />
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
