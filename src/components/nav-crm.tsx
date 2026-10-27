"use client";

import Link from "next/link";
import { useState } from "react";
import { BookOpen, ChartNoAxesCombined, ChevronDown, Filter, Gauge, GitCompareArrows, KanbanSquare, Bot, Megaphone, ServerCog, Target, LifeBuoy, ShieldCheck, Sun, type LucideIcon } from "lucide-react";
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

type CrmView = "mi-dia" | "registro" | "kanban" | "informe" | "tablero" | "embudo" | "comparar-embudos" | "pauta" | "recuperacion" | "supervisor" | "agente-de-ventas" | "agente-de-marketing" | "agente-de-sistemas" | "guiones";

const crmViews: Array<{
  title: string;
  view: CrmView;
  icon: LucideIcon;
  soloJefes?: boolean;
  /** Solo dueño o administrador (no supervisoras). */
  soloDueno?: boolean;
  /** Dueño, administrador o la supervisora del Supervisor accionable. */
  soloRecuperacion?: boolean;
}> = [
  { title: "Mi día", view: "mi-dia", icon: Sun },
  // Registro ya no está en el menú (Alex, 26-10-2026): la pantalla y los datos siguen, solo se esconde el botón.
  { title: "Kanban", view: "kanban", icon: KanbanSquare },
  // Informe y Guiones: solo quien supervisa; las asesoras ven solo Mi día y Kanban.
  { title: "Informe", view: "informe", icon: ChartNoAxesCombined, soloJefes: true },
  // Solo para quien supervisa: es como viene CADA asesora, no el trabajo de una.
  { title: "Tablero", view: "tablero", icon: Gauge, soloJefes: true },
  // El embudo del Combo (F1): de la entrada del anuncio al anticipo. También solo para quien supervisa.
  { title: "Embudo", view: "embudo", icon: Filter, soloJefes: true },
  // Comparar dos versiones del libro lado a lado (solo lectura). También solo para quien supervisa.
  { title: "Comparar embudos", view: "comparar-embudos", icon: GitCompareArrows, soloJefes: true },
  // Pauta: qué campaña y anuncio de Meta traen ventas y cuánto cuesta cada una (solo lectura).
  { title: "Pauta", view: "pauta", icon: Target, soloJefes: true },
  // Recuperación de leads (13-10-2026): dueño / administrador y la supervisora del accionable.
  { title: "Recuperación", view: "recuperacion", icon: LifeBuoy, soloRecuperacion: true },
  // El Supervisor: solo dueño o administrador (Alex, 13-10-2026). Las supervisoras siguen
  // entrando por los avisos (la página no cambia sus permisos).
  { title: "Supervisor", view: "supervisor", icon: ShieldCheck, soloDueno: true },
  // El Agente de Ventas (molde de agentes de área): lo ven los mismos que ven el Tablero.
  { title: "Agente de Ventas", view: "agente-de-ventas", icon: Bot, soloJefes: true },
  // El Agente de Marketing: el mismo molde, junto al de Ventas.
  { title: "Agente de Marketing", view: "agente-de-marketing", icon: Megaphone, soloJefes: true },
  // El Agente de Sistemas: el mismo molde; revisa que lo subido funcione. Solo lee.
  { title: "Agente de Sistemas", view: "agente-de-sistemas", icon: ServerCog, soloJefes: true },
  { title: "Guiones", view: "guiones", icon: BookOpen, soloJefes: true },
];

export function NavCrm({
  currentView,
  isCrmRoute,
  puedeSupervisar = false,
  esJefe = false,
  veRecuperacion = false,
}: {
  currentView: CrmView;
  isCrmRoute: boolean;
  /** Dueño, administrador o supervisora: a ellos se les muestra el Tablero del equipo. */
  puedeSupervisar?: boolean;
  /** Dueño o administrador del negocio: ve también el Supervisor. */
  esJefe?: boolean;
  /** Dueño, administrador o la supervisora del Supervisor accionable: ve Recuperación. */
  veRecuperacion?: boolean;
}) {
  const [manualOpen, setManualOpen] = useState(false);
  const open = manualOpen || isCrmRoute;

  return (
    <SidebarMenu>
      <Collapsible open={open} onOpenChange={setManualOpen} render={<SidebarMenuItem />}>
        <div>
          <CollapsibleTrigger render={<SidebarMenuButton isActive={isCrmRoute} />}>
            <ChartNoAxesCombined />
            <span>CRM</span>
          </CollapsibleTrigger>
          <CollapsibleTrigger render={<SidebarMenuAction />}>
            <ChevronDown />
          </CollapsibleTrigger>
        </div>

        <CollapsibleContent>
          <SidebarMenuSub>
            {crmViews
              .filter(
                (item) =>
                  (!item.soloJefes || puedeSupervisar) && (!item.soloDueno || esJefe) && (!item.soloRecuperacion || veRecuperacion),
              )
              .map((item) => (
              <SidebarMenuSubItem key={item.view}>
                {/* Sin `prefetch`: eran seis vistas del CRM pedidas enteras desde cualquier pantalla. */}
                <SidebarMenuSubButton
                  render={<Link href={`/cliente/crm/${item.view}`} />}
                  isActive={currentView === item.view}
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
