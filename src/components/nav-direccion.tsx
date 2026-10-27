"use client";

import Link from "next/link";
import { useState } from "react";
import { Bell, Bot, ChartNoAxesCombined, ChevronDown, Compass, Filter, GitCompareArrows, LifeBuoy, ListFilter, Megaphone, ServerCog, ShieldCheck, Target, type LucideIcon } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";

const direccionViews: Array<{
  title: string;
  view: string;
  icon: LucideIcon;
  /** Ruta propia cuando la pantalla no vive bajo /cliente/direccion. */
  href?: string;
}> = [
  // El Supervisor: solo dueño o administrador; la página también bloquea a las demás cuentas.
  { title: "Supervisor", view: "supervisor", icon: ShieldCheck },
  // Los agentes de área (molde `PaginaDeAgenteDeArea`): los ven los mismos que ven el Supervisor.
  { title: "Agente de Ventas", view: "agente-de-ventas", icon: Bot },
  { title: "Agente de Marketing", view: "agente-de-marketing", icon: Megaphone },
  // El Agente de Sistemas revisa que lo subido funcione. Solo lee.
  { title: "Agente de Sistemas", view: "agente-de-sistemas", icon: ServerCog },
  // Todas las alertas internas por prioridad; por WhatsApp solo llegan las urgentes.
  // El embudo del Combo: de la entrada del anuncio al anticipo.
  { title: "Embudo", view: "embudo", icon: Filter },
  // Comparar dos versiones del libro lado a lado (solo lectura).
  { title: "Comparar embudos", view: "comparar-embudos", icon: GitCompareArrows },
  // En qué paso del bot se queda la gente (solo lectura).
  { title: "Embudo por paso", view: "embudo-por-paso", icon: ListFilter },
  // Pauta: qué campaña y anuncio de Meta traen ventas y cuánto cuesta cada una (solo lectura).
  { title: "Pauta", view: "pauta", icon: Target },
  // Recuperación de leads: solo dueño / administrador.
  { title: "Recuperación", view: "recuperacion", icon: LifeBuoy },
  { title: "Informe", view: "informe", icon: ChartNoAxesCombined },
  { title: "Alertas", view: "alertas", icon: Bell, href: "/cliente/alertas" },
];

/** El sidebar solo lo dibuja para el dueño y los administradores (`puedeVerDireccion`). */
export function NavDireccion({ currentPath }: { currentPath: string }) {
  const [manualOpen, setManualOpen] = useState(false);
  const isDireccionRoute = currentPath.startsWith("/cliente/direccion") || currentPath.startsWith("/cliente/alertas");
  const open = manualOpen || isDireccionRoute;

  return (
    <SidebarMenu>
      <Collapsible open={open} onOpenChange={setManualOpen} render={<SidebarMenuItem />}>
        <div>
          <CollapsibleTrigger render={<SidebarMenuButton isActive={isDireccionRoute} />}>
            <Compass />
            <span>Dirección</span>
          </CollapsibleTrigger>
          <CollapsibleTrigger render={<SidebarMenuAction />}>
            <ChevronDown />
          </CollapsibleTrigger>
        </div>

        <CollapsibleContent>
          <SidebarMenuSub>
            {direccionViews.map((item) => (
              <SidebarMenuSubItem key={item.view}>
                <SidebarMenuSubButton
                  render={<Link href={item.href ?? `/cliente/direccion/${item.view}`} />}
                  isActive={currentPath.startsWith(item.href ?? `/cliente/direccion/${item.view}`)}
                >
                  <item.icon />
                  <span>{item.title}</span>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            ))}
          </SidebarMenuSub>
        </CollapsibleContent>
      </Collapsible>
    </SidebarMenu>
  );
}
