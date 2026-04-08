"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Bot, FileText, MessageSquareText } from "lucide-react";

type OfficialApiPanelShellProps = {
  children: ReactNode;
  basePath?: string;
};

export function OfficialApiPanelShell({
  children,
  basePath = "/cliente/api-oficial",
}: OfficialApiPanelShellProps) {
  const pathname = usePathname();
  const tabs = [
    {
      key: "resumen",
      label: "Resumen",
      href: basePath,
      icon: FileText,
    },
    {
      key: "chats",
      label: "Chats",
      href: `${basePath}/chats`,
      icon: MessageSquareText,
    },
    {
      key: "chatbot",
      label: "Chatbot",
      href: `${basePath}/chatbot`,
      icon: Bot,
    },
  ];

  return (
    <section className="flex min-h-0 w-full flex-1 flex-col gap-4">
      <div className="overflow-x-auto">
        <nav className="flex min-w-max items-center gap-1.5 rounded-[20px] border border-[rgba(148,163,184,0.14)] bg-white p-2 shadow-[0_12px_30px_-26px_rgba(15,23,42,0.14)]">
          {tabs.map((tab) => {
            const active =
              tab.key === "chatbot"
                ? pathname.startsWith(`${basePath}/chatbot`)
                : tab.key === "chats"
                  ? pathname.startsWith(`${basePath}/chats`)
                  : pathname === tab.href;
            const Icon = tab.icon;

            return (
              <Link
                key={tab.key}
                href={tab.href}
                className={`inline-flex h-10 items-center gap-2 rounded-xl px-3 text-sm font-medium transition ${
                  active
                    ? "bg-[var(--primary)] text-white shadow-[0_16px_30px_-20px_color-mix(in_srgb,var(--primary)_55%,black)]"
                    : "text-slate-600 hover:bg-slate-50 hover:text-[var(--primary)]"
                }`}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="flex-1">{children}</div>
    </section>
  );
}
