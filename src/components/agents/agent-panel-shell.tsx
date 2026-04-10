"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import {
  Bot,
  Brain,
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
  { key: "entrenamiento", label: "Entrenamiento", href: (agentId: string) => `/cliente/agentes/${agentId}/entrenamiento`, icon: Sparkles },
  { key: "conocimiento", label: "Conocimiento", href: "", icon: Brain, disabled: true },
  { key: "automatizar", label: "Escalar/Automatizar", href: "", icon: Workflow, disabled: true },
];

export function AgentPanelShell({ agentId, children, hideMobileNav = false }: AgentPanelShellProps) {
  const pathname = usePathname();
  const trainingHref = `/cliente/agentes/${agentId}/entrenamiento`;
  const playgroundHref = `/cliente/agentes/${agentId}/probar`;
  const shouldHideMobileNav = hideMobileNav || pathname === playgroundHref;
  const mobileTabs = tabs.filter((tab) => !tab.disabled).slice(0, 4);

  return (
    <section className="flex min-h-0 w-full flex-1 flex-col overflow-x-hidden">
      <div className="hidden overflow-x-auto -mt-1 md:block">
        <nav className="flex min-w-max items-center gap-1.5 rounded-[20px] border border-[rgba(148,163,184,0.14)] bg-white p-2 shadow-[0_12px_30px_-26px_rgba(15,23,42,0.14)]">
          {tabs.map((tab) => {
            const href = typeof tab.href === "function" ? tab.href(agentId) : "";
            const active =
              !tab.disabled &&
              (pathname === href || (tab.key === "entrenamiento" && pathname === playgroundHref) || (href === trainingHref && pathname === playgroundHref));
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

      <div className={`mt-0 flex-1 md:mt-0 ${!shouldHideMobileNav ? "pb-[calc(env(safe-area-inset-bottom)+5.75rem)] md:pb-0" : ""}`}>
        {children}
      </div>

      {!shouldHideMobileNav ? (
        <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-[rgba(148,163,184,0.14)] bg-white/96 px-2 pb-[calc(env(safe-area-inset-bottom)+0.35rem)] pt-2 shadow-[0_-12px_30px_-24px_rgba(15,23,42,0.22)] backdrop-blur md:hidden">
          <div className="grid grid-cols-2 gap-1 rounded-[22px] border border-[rgba(148,163,184,0.08)] bg-slate-50/70 p-1">
            {mobileTabs.map((tab) => {
                const href = typeof tab.href === "function" ? tab.href(agentId) : "";
                const active = pathname === href || (tab.key === "entrenamiento" && pathname === playgroundHref);
                const Icon = tab.icon;

                return (
                  <Link
                    key={tab.key}
                    href={href}
                    className={`flex min-h-[60px] flex-col items-center justify-center gap-1 rounded-[18px] px-1 py-2 text-center text-[11px] font-medium transition ${
                      active
                        ? "bg-[var(--primary)] text-white shadow-[0_12px_24px_-18px_color-mix(in_srgb,var(--primary)_50%,black)]"
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
