"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import {
  Bot,
  Brain,
  Cable,
  Sparkles,
  Workflow,
} from "lucide-react";

type AgentPanelShellProps = {
  agentId: string;
  children: ReactNode;
};

const tabs = [
  { key: "resumen", label: "Resumen", href: (agentId: string) => `/cliente/agentes/${agentId}`, icon: Bot },
  { key: "canales", label: "Canales", href: (agentId: string) => `/cliente/agentes/${agentId}/canales`, icon: Cable },
  { key: "personalidad", label: "Personalidad", href: "", icon: Sparkles, disabled: true },
  { key: "conocimiento", label: "Conocimiento", href: "", icon: Brain, disabled: true },
  { key: "automatizar", label: "Escalar/Automatizar", href: "", icon: Workflow, disabled: true },
];

export function AgentPanelShell({ agentId, children }: AgentPanelShellProps) {
  const pathname = usePathname();

  return (
    <section className="w-full space-y-5 overflow-x-hidden">
      <div className="overflow-hidden rounded-[28px] border border-[rgba(148,163,184,0.14)] bg-[linear-gradient(180deg,#ffffff_0%,#fbfcff_100%)] px-4 py-4 shadow-[0_24px_60px_-44px_rgba(15,23,42,0.16)] md:px-5">
        <div className="overflow-x-auto">
          <nav className="flex min-w-max items-center gap-1.5 rounded-[20px] border border-[rgba(148,163,184,0.12)] bg-slate-50/90 p-2">
            {tabs.map((tab) => {
              const href = typeof tab.href === "function" ? tab.href(agentId) : "";
              const active = !tab.disabled && pathname === href;
              const Icon = tab.icon;

              if (tab.disabled) {
                return (
                  <span
                    key={tab.key}
                    className="inline-flex h-10 items-center gap-2 rounded-xl px-3 text-sm font-medium text-slate-400"
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
                      ? "bg-[var(--primary)] text-white shadow-[0_16px_30px_-20px_color-mix(in_srgb,var(--primary)_55%,black)]"
                      : "text-slate-600 hover:bg-white hover:text-[var(--primary)]"
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
