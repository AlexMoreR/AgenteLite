"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Brain, Building2, Plug, Users } from "lucide-react";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

const items = [
  { value: "negocio", label: "Negocio", href: "/cliente/negocio", icon: Building2 },
  { value: "equipo", label: "Equipo", href: "/cliente/equipo", icon: Users },
  { value: "reporte", label: "Reporte", href: "/cliente/negocio/reporte", icon: BarChart3 },
  { value: "claude", label: "Claude", href: "/cliente/negocio/claude", icon: Plug },
  { value: "cerebro", label: "Cerebro", href: "/cliente/negocio/cerebro", icon: Brain },
] as const;

/**
 * La pestaña Claude solo la ve el dueño o un administrador del negocio (misma regla que su página).
 * La pestaña Cerebro, el dueño y quien él autorice.
 */
export function NegocioEquipoTabsLista({ verClaude, verCerebro }: { verClaude: boolean; verCerebro: boolean }) {
  const pathname = usePathname();
  const active = pathname?.startsWith("/cliente/negocio/reporte")
    ? "reporte"
    : pathname?.startsWith("/cliente/negocio/claude")
      ? "claude"
      : pathname?.startsWith("/cliente/negocio/cerebro")
        ? "cerebro"
        : pathname?.startsWith("/cliente/equipo")
          ? "equipo"
          : "negocio";

  return (
    <Tabs value={active}>
      <TabsList>
        {items
          .filter((item) => (item.value !== "claude" || verClaude) && (item.value !== "cerebro" || verCerebro))
          .map(({ value, label, href, icon: Icon }) => (
            <TabsTrigger key={value} value={value} nativeButton={false} render={<Link href={href} />}>
              <Icon />
              {label}
            </TabsTrigger>
          ))}
      </TabsList>
    </Tabs>
  );
}
