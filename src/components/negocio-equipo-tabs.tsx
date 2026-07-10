"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Building2, Users } from "lucide-react";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

const items = [
  { value: "negocio", label: "Negocio", href: "/cliente/negocio", icon: Building2 },
  { value: "equipo", label: "Equipo", href: "/cliente/equipo", icon: Users },
  { value: "reporte", label: "Reporte", href: "/cliente/negocio/reporte", icon: BarChart3 },
] as const;

export function NegocioEquipoTabs() {
  const pathname = usePathname();
  const active = pathname?.startsWith("/cliente/negocio/reporte")
    ? "reporte"
    : pathname?.startsWith("/cliente/equipo")
      ? "equipo"
      : "negocio";

  return (
    <Tabs value={active}>
      <TabsList>
        {items.map(({ value, label, href, icon: Icon }) => (
          <TabsTrigger key={value} value={value} nativeButton={false} render={<Link href={href} />}>
            <Icon />
            {label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
