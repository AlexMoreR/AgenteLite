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

  const headline = isExpired ? "Tu agente ya quedo en pausa." : "Tu agente entra en cuenta regresiva.";
  const description = isExpired
    ? "Tu plan ya vencio. Reactivalo hoy para seguir respondiendo sin cortar ventas."
    : daysRemaining <= 1
      ? "Te queda 1 dia de acceso. Sube de plan antes de que tu operacion se frene."
      : `Te quedan ${daysRemaining} dias de acceso. Mejora tu plan antes de que tu agente se detenga.`;

  return (
    <div className="sticky bottom-0 z-30 border-t border-cyan-400/15 bg-[linear-gradient(90deg,rgba(7,17,32,0.98),rgba(11,32,51,0.98))] px-3 py-3 shadow-[0_-18px_40px_rgba(2,8,23,0.28)] backdrop-blur xl:px-4">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 rounded-[24px] border border-cyan-300/15 bg-[linear-gradient(135deg,rgba(7,18,34,0.94),rgba(14,41,58,0.94))] px-4 py-4 text-white md:flex-row md:items-center md:justify-between md:px-5">
        <div className="flex min-w-0 items-start gap-3">
          <div className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-cyan-300/15 bg-cyan-400/10 text-cyan-200">
            <Clock3 className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-cyan-300/20 bg-cyan-400/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-200">
                {urgencyLabel}
              </span>
              <span className="text-xs font-medium text-slate-300">Vence {expiresAtLabel}</span>
            </div>
            <p className="text-base font-semibold tracking-[-0.02em] text-white md:text-lg">{headline}</p>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-300">{description}</p>
          </div>
        </div>
        <Button
          asChild
          size="lg"
          className="h-11 shrink-0 rounded-2xl bg-[#2ed3b7] px-5 text-[15px] font-semibold text-slate-950 hover:bg-[#56ddc6]"
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
