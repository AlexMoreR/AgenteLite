"use client";

import Link from "next/link";
import { useState } from "react";
import { Bot, ChartNoAxesCombined, ChevronDown, Compass, Filter, GitCompareArrows, LifeBuoy, Megaphone, ServerCog, ShieldCheck, Target, type LucideIcon } from "lucide-react";
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
  /** Solo dueño o administrador del negocio (mismas banderas que tenían dentro del CRM). */
  soloJefes?: boolean;
  /** Además de `soloJefes`, exige `veRecuperacion` (hoy es lo mismo que ser jefe). */
  soloRecuperacion?: boolean;
}> = [
  // El Supervisor: solo dueño o administrador; la página también bloquea a las demás cuentas.
  { title: "Supervisor", view: "supervisor", icon: ShieldCheck, soloJefes: true },
  // Los agentes de área (molde `PaginaDeAgenteDeArea`): los ven los mismos que ven el Supervisor.
  { title: "Agente de Ventas", view: "agente-de-ventas", icon: Bot, soloJefes: true },
  { title: "Agente de Marketing", view: "agente-de-marketing", icon: Megaphone, soloJefes: true },
  // El Agente de Sistemas revisa que lo subido funcione. Solo lee.
  { title: "Agente de Sistemas", view: "agente-de-sistemas", icon: ServerCog, soloJefes: true },
  // El embudo del Combo (F1): de la entrada del anuncio al anticipo.
  { title: "Embudo", view: "embudo", icon: Filter, soloJefes: true },
  // Comparar dos versiones del libro lado a lado (solo lectura).
  { title: "Comparar embudos", view: "comparar-embudos", icon: GitCompareArrows, soloJefes: true },
  // Pauta: qué campaña y anuncio de Meta traen ventas y cuánto cuesta cada una (solo lectura).
  { title: "Pauta", view: "pauta", icon: Target, soloJefes: true },
  // Recuperación de leads (13-10-2026): solo dueño / administrador.
  { title: "Recuperación", view: "recuperacion", icon: LifeBuoy, soloJefes: true, soloRecuperacion: true },
  // Informe: en el CRM ya era solo de jefes; aquí lleva la bandera para que no salga a las asesoras.
  { title: "Informe", view: "informe", icon: ChartNoAxesCombined, soloJefes: true },
];

export function NavDireccion({
  currentPath,
  esJefe = false,
  veRecuperacion = false,
}: {
  currentPath: string;
  /** Dueño o administrador del negocio: los únicos que ven estas pantallas. */
  esJefe?: boolean;
  /** Dueño, administrador o la supervisora del Supervisor accionable: ve Recuperación. */
  veRecuperacion?: boolean;
}) {
  const [manualOpen, setManualOpen] = useState(false);
  const isDireccionRoute = currentPath.startsWith("/cliente/direccion");
  const open = manualOpen || isDireccionRoute;

  const items = direccionViews.filter((item) => (!item.soloJefes || esJefe) && (!item.soloRecuperacion || veRecuperacion));
  // A las asesoras no les aparece el grupo vacío.
  if (items.length === 0) return null;

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
            {items.map((item) => (
              <SidebarMenuSubItem key={item.view}>
                <SidebarMenuSubButton
                  render={<Link href={`/cliente/direccion/${item.view}`} />}
                  isActive={currentPath.startsWith(`/cliente/direccion/${item.view}`)}
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
