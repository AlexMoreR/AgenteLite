"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import {
  Bot,
  Brain,
  Cable,
  MessageSquareText,
  Sparkles,
  Workflow,
} from "lucide-react";

type AgentPanelShellProps = {
  agentId: string;
  children: ReactNode;
  hideMobileNav?: boolean;
};

const tabs = [
  { key: "resumen", label: "Resumen", href: (agentId: string) => `/cliente/agentes/${agentId}`, icon: Bot },
  { key: "chats", label: "Chats", href: (agentId: string) => `/cliente/agentes/${agentId}/chats`, icon: MessageSquareText },
  { key: "canales", label: "Canales", href: (agentId: string) => `/cliente/agentes/${agentId}/canales`, icon: Cable },
  { key: "entrenamiento", label: "Entrenamiento", href: (agentId: string) => `/cliente/agentes/${agentId}/entrenamiento`, icon: Sparkles },
  { key: "conocimiento", label: "Conocimiento", href: "", icon: Brain, disabled: true },
  { key: "automatizar", label: "Escalar/Automatizar", href: "", icon: Workflow, disabled: true },
];

export function AgentPanelShell({ agentId, children, hideMobileNav = false }: AgentPanelShellProps) {
  const pathname = usePathname();

  return (
    <section className="flex min-h-0 w-full flex-1 flex-col overflow-x-hidden">
      <div className="hidden overflow-x-auto -mt-1 md:block">
        <nav className="flex min-w-max items-center gap-1.5 rounded-[20px] border border-[rgba(148,163,184,0.14)] bg-white p-2 shadow-[0_12px_30px_-26px_rgba(15,23,42,0.14)]">
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

      <div className="mt-0 flex-1 md:mt-0">{children}</div>

      {!hideMobileNav ? (
        <nav className="sticky bottom-0 z-20 -mx-3 overflow-hidden rounded-t-[18px] border-t border-[rgba(148,163,184,0.14)] bg-white px-0 py-0 md:mx-0 md:hidden">
          <div className="grid grid-cols-4 gap-0">
            {tabs
              .filter((tab) => !tab.disabled)
              .slice(0, 3)
              .map((tab) => {
                const href = typeof tab.href === "function" ? tab.href(agentId) : "";
                const active = pathname === href;
                const Icon = tab.icon;

                return (
                  <Link
                    key={tab.key}
                    href={href}
                    className={`flex min-h-[52px] flex-col items-center justify-center gap-0.5 rounded-t-[14px] px-0 py-1.5 text-center text-[11px] font-medium transition ${
                      active
                        ? "bg-[var(--primary)] text-white"
                        : "text-slate-600"
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    <span className="leading-none">{tab.label}</span>
                  </Link>
                );
              })}
          </div>
        </nav>
      ) : null}
    </section>
  );
}
