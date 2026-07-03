import Link from "next/link";
import { Bot } from "lucide-react";

export function FinanzasEntryWorkspace() {
  return (
    <section className="mx-auto flex min-h-[calc(100dvh-12rem)] w-full max-w-5xl items-center justify-center px-4 py-10 sm:px-6">
      <div className="w-full rounded-2xl border bg-card p-6 shadow-lg sm:p-8">
        <div className="mx-auto flex max-w-2xl flex-col items-center text-center">
          <span className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg">
            <Bot className="h-8 w-8" />
          </span>

          <h1 className="mt-6 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Finanzas
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground sm:text-base">
            Entra al asistente para registrar ingresos, gastos y consultar tu balance en formato conversacional.
          </p>

          <Link
            href="/cliente/finanzas/asistente"
            className="mt-8 inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-lg transition hover:scale-[1.01] hover:shadow-xl"
          >
            <Bot className="h-4 w-4" />
            Ingresar
          </Link>
        </div>
      </div>
    </section>
  );
}
