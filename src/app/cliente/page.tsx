import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Bot, Building2, MessageSquareMore } from "lucide-react";
import { auth } from "@/auth";
import { Card } from "@/components/ui/card";
import { QueryFeedbackToast } from "@/components/ui/query-feedback-toast";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ClientePage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE"].includes(session.user.role)) {
    redirect("/unauthorized");
  }

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  const params = await searchParams;
  const okMessage = typeof params.ok === "string" ? params.ok : "";

  return (
    <section className="app-page space-y-5">
      <QueryFeedbackToast
        okMessage={okMessage}
        errorMessage=""
        okTitle="Tu negocio ya esta listo"
      />

      <Card className="max-w-5xl space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--primary)_12%,white)] text-[var(--primary)]">
              <Building2 className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-slate-900 md:text-3xl">
                {membership?.workspace.name ?? "Bienvenido a tu estudio de agentes"}
              </h1>
              <p className="text-sm text-slate-600 md:text-base">
                {membership
                  ? "Tu espacio de trabajo ya esta listo. Desde aqui podras avanzar a agentes, WhatsApp y conversaciones."
                  : "Todavia no has configurado tu negocio. Puedes hacerlo despues, justo cuando vayas a crear tu primer agente."}
              </p>
            </div>
          </div>

          <Link
            href="/cliente/agentes"
            className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-slate-950 px-4 text-sm font-medium text-white transition hover:bg-slate-800"
          >
            Ir a agentes
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="space-y-2">
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
            <Bot className="h-4 w-4" />
          </div>
          <h2 className="text-base font-semibold text-slate-900">Agentes</h2>
          <p className="text-sm text-slate-600">
            {membership?.workspace._count.agents ?? 0} creados. Aqui vivira la configuracion de personalidad, instrucciones y objetivos.
          </p>
        </Card>

        <Card className="space-y-2">
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
            <MessageSquareMore className="h-4 w-4" />
          </div>
          <h2 className="text-base font-semibold text-slate-900">Canales</h2>
          <p className="text-sm text-slate-600">
            {membership?.workspace._count.channels ?? 0} conectados. Cada agente podra tener su canal de WhatsApp enlazado desde aqui.
          </p>
        </Card>
      </div>
    </section>
  );
}
