"use client";

import Link from "next/link";
import { LockKeyhole, MessageCircleMore, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { siteConfig } from "@/lib/site";

type ClientPlanBlockModalProps = {
  expiresAtLabel: string;
  paymentHref: string;
};

export function ClientPlanBlockModal({
  expiresAtLabel,
  paymentHref,
}: ClientPlanBlockModalProps) {
  const advisorHref = `https://wa.me/${siteConfig.phoneHref.replace("+", "")}?text=${encodeURIComponent(
    `Hola ${siteConfig.name}, mi plan vencio el ${expiresAtLabel} y quiero hablar con un asesor para solicitar un poco mas de dias.`,
  )}`;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-[#020817cc] p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Plan vencido">
      <div className="w-full max-w-md overflow-hidden rounded-[2rem] border border-cyan-300/15 bg-[linear-gradient(180deg,rgba(9,20,35,0.98),rgba(7,17,29,0.98))] text-white shadow-[0_32px_80px_-32px_rgba(2,8,23,0.85)]">
        <div className="border-b border-white/8 px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-cyan-300/18 bg-cyan-400/10 text-cyan-200">
              <ShieldAlert className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-200">Plan vencido</p>
              <h2 className="mt-1 text-xl font-semibold tracking-[-0.03em] text-white">
                Tu agente fue desactivado
              </h2>
            </div>
          </div>
        </div>

        <div className="space-y-4 px-6 py-5">
          <p className="max-w-[30ch] text-sm leading-6 text-slate-300">
            Tu acceso vencio el {expiresAtLabel}. Reactiva el plan para volver a entrar.
          </p>

          <div className="rounded-[1.25rem] border border-cyan-300/10 bg-white/[0.06] px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 rounded-xl border border-white/8 bg-cyan-400/10 p-2 text-cyan-200">
                <LockKeyhole className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-medium text-white">Acceso temporalmente bloqueado</p>
                <p className="mt-1 text-sm leading-5 text-slate-400">
                  Este aviso seguira activo hasta renovar.
                </p>
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Button
              asChild
              className="h-11 w-full rounded-xl bg-[#2ed3b7] text-sm font-semibold text-slate-950 hover:bg-[#56ddc6]"
            >
              <Link href={paymentHref}>Pagar plan</Link>
            </Button>

            <Button
              asChild
              className="h-11 w-full rounded-xl border border-cyan-300/20 bg-white/5 text-sm font-semibold text-white hover:bg-white/10"
            >
              <Link href={advisorHref} target="_blank" rel="noreferrer">
                <MessageCircleMore className="h-4 w-4" />
                Hablar con asesor
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
