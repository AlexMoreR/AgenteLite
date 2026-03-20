"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import {
  Bot,
  Brain,
  Cable,
  CircleDollarSign,
  PackageCheck,
  Radio,
  Sparkles,
  Workflow,
} from "lucide-react";

type AgentPanelShellProps = {
  agentId: string;
  agentName: string;
  description?: string | null;
  children: ReactNode;
};

const tabs = [
  { key: "resumen", label: "Resumen", href: (agentId: string) => `/cliente/agentes/${agentId}`, icon: Bot },
  { key: "canales", label: "Canales", href: (agentId: string) => `/cliente/agentes/${agentId}/canales`, icon: Cable },
  { key: "personalidad", label: "Personalidad", href: "", icon: Sparkles, disabled: true },
  { key: "conocimiento", label: "Conocimiento", href: "", icon: Brain, disabled: true },
  { key: "entrega", label: "Entrega", href: "", icon: PackageCheck, disabled: true },
  { key: "pagos", label: "Pagos", href: "", icon: CircleDollarSign, disabled: true },
  { key: "automatizar", label: "Escalar/Automatizar", href: "", icon: Workflow, disabled: true },
  { key: "activacion", label: "Activación", href: "", icon: Radio, disabled: true },
];

export function AgentPanelShell({ agentId, agentName, description, children }: AgentPanelShellProps) {
  const pathname = usePathname();

  return (
    <section className="w-full space-y-4 overflow-x-hidden">
      <div className="space-y-3">
        <div className="space-y-1 px-1">
          <h1 className="text-[1.45rem] font-semibold tracking-[-0.05em] text-slate-950">{agentName}</h1>
          <p className="text-sm text-slate-600">{description || "Panel de control del agente."}</p>
        </div>

        <div className="overflow-x-auto">
          <nav className="flex min-w-max items-center gap-1.5 rounded-[18px] border border-[rgba(15,23,42,0.08)] bg-[linear-gradient(180deg,#111827_0%,#0f172a_100%)] p-2 shadow-[0_16px_36px_-28px_rgba(15,23,42,0.52)]">
            {tabs.map((tab) => {
              const href = typeof tab.href === "function" ? tab.href(agentId) : "";
              const active = !tab.disabled && pathname === href;
              const Icon = tab.icon;

              if (tab.disabled) {
                return (
                  <span
                    key={tab.key}
                    className="inline-flex h-10 items-center gap-2 rounded-xl px-3 text-sm font-medium text-slate-500"
                  >
                    <Icon className="h-4 w-4" />
                    {tab.label}
                  </span>
                );
              }

              return (
                <Link
                  key={tab.key}
                  href={href}
                  className={`inline-flex h-10 items-center gap-2 rounded-xl px-3 text-sm font-medium transition ${
                    active
                      ? "bg-white text-slate-950 shadow-[0_10px_24px_-18px_rgba(15,23,42,0.3)]"
                      : "text-slate-300 hover:bg-white/8 hover:text-white"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {tab.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </div>

      {children}
    </section>
  );
}
