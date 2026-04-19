import Link from "next/link";
import { Bot } from "lucide-react";

export function FinanzasEntryWorkspace() {
  return (
    <section className="mx-auto flex min-h-[calc(100dvh-12rem)] w-full max-w-5xl items-center justify-center px-4 py-10 sm:px-6">
      <div className="w-full rounded-[32px] border border-slate-200 bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] p-6 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.2)] sm:p-8">
        <div className="mx-auto flex max-w-2xl flex-col items-center text-center">
          <span className="inline-flex h-16 w-16 items-center justify-center rounded-[22px] bg-[linear-gradient(135deg,#1b2748_0%,#223463_100%)] text-white shadow-[0_18px_40px_-24px_rgba(15,23,42,0.55)]">
            <Bot className="h-8 w-8" />
          </span>

          <h1 className="mt-6 text-3xl font-semibold tracking-[-0.05em] text-slate-950 sm:text-4xl">
            Finanzas
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-slate-600 sm:text-base">
            Entra al asistente para registrar ingresos, gastos y consultar tu balance en formato conversacional.
          </p>

          <Link
            href="/cliente/finanzas/asistente"
            className="mt-8 inline-flex items-center gap-2 rounded-full bg-[linear-gradient(135deg,#1b2748_0%,#223463_100%)] px-6 py-3 text-sm font-semibold text-white shadow-[0_18px_40px_-24px_rgba(15,23,42,0.55)] transition hover:scale-[1.01] hover:shadow-[0_24px_48px_-24px_rgba(15,23,42,0.65)]"
          >
            <Bot className="h-4 w-4" />
            Ingresar
          </Link>
        </div>
      </div>
    </section>
  );
}
