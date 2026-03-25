"use client";

import Link from "next/link";
import { ArrowUpRight, Clock3 } from "lucide-react";
import { Button } from "@/components/ui/button";

type ClientPlanWarningBarProps = {
  daysRemaining: number;
  expiresAtLabel: string;
  isExpired: boolean;
};

export function ClientPlanWarningBar({
  daysRemaining,
  expiresAtLabel,
  isExpired,
}: ClientPlanWarningBarProps) {
  const urgencyLabel = isExpired
    ? "Plan vencido"
    : daysRemaining <= 1
      ? "Ultimo dia"
      : `${daysRemaining} dias restantes`;

  const description = isExpired
    ? "Reactiva tu acceso para que tu agente vuelva a responder sin interrupciones."
    : daysRemaining <= 1
      ? "Vence manana. Mejora tu plan para evitar que el agente se detenga."
      : `Vence ${expiresAtLabel}. Mejora tu plan antes de que el agente se detenga.`;

  return (
    <div className="-mx-3 -mt-3 mb-3 border border-cyan-400/10 bg-[linear-gradient(90deg,rgba(5,13,24,0.94),rgba(8,24,39,0.94))] py-2.5 shadow-[0_10px_28px_rgba(2,8,23,0.12)] backdrop-blur md:-mx-4 md:-mt-4 md:mb-4">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 rounded-[22px] border border-cyan-300/12 bg-[linear-gradient(135deg,rgba(8,20,36,0.88),rgba(11,32,50,0.88))] px-4 py-3 text-white md:flex-row md:items-center md:justify-between md:px-4">
        <div className="flex min-w-0 items-start gap-3">
          <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-[18px] border border-cyan-300/12 bg-cyan-400/8 text-cyan-200">
            <Clock3 className="h-4.5 w-4.5" />
          </div>
          <div className="min-w-0">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-cyan-300/16 bg-cyan-400/8 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-200">
                {urgencyLabel}
              </span>
              {!isExpired ? <span className="text-xs text-slate-400">Vence {expiresAtLabel}</span> : null}
            </div>
            <p className="mt-0.5 max-w-2xl text-sm leading-5 text-slate-300">{description}</p>
          </div>
        </div>
        <Button
          asChild
          size="sm"
          className="h-10 shrink-0 rounded-xl bg-[#2ed3b7] px-4 text-sm font-semibold text-slate-950 hover:bg-[#56ddc6] md:h-9"
        >
          <Link href="/#precios">
            Mejorar plan
            <ArrowUpRight className="h-4 w-4" />
          </Link>
        </Button>
      </div>
    </div>
  );
}
