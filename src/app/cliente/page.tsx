import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Bot, Building2, MessageSquareMore } from "lucide-react";
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
  if (!membership) {
    redirect("/cliente/onboarding");
  }

  const params = await searchParams;
  const okMessage = typeof params.ok === "string" ? params.ok : "";

  return (
    <section className="app-page space-y-5">
      <QueryFeedbackToast
        okMessage={okMessage}
        errorMessage=""
        okTitle="Tu negocio ya esta listo"
      />

      <Card className="max-w-4xl space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--primary)_12%,white)] text-[var(--primary)]">
              <Building2 className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-slate-900 md:text-3xl">
                {membership.workspace.name}
              </h1>
              <p className="text-sm text-slate-600 md:text-base">
                Tu negocio ya tiene espacio configurado. El siguiente paso es crear tu primer agente y luego conectarlo a WhatsApp.
              </p>
            </div>
          </div>

          <span className="inline-flex h-11 items-center justify-center rounded-lg border border-dashed border-[var(--line)] px-4 text-sm font-medium text-slate-500">
            Crear mi primer agente pronto
          </span>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="space-y-2">
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
            <Bot className="h-4 w-4" />
          </div>
          <h2 className="text-base font-semibold text-slate-900">Agentes</h2>
          <p className="text-sm text-slate-600">
            {membership.workspace._count.agents} creados. Aqui vivira la configuracion de personalidad, instrucciones y objetivos.
          </p>
        </Card>

        <Card className="space-y-2">
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
            <MessageSquareMore className="h-4 w-4" />
          </div>
          <h2 className="text-base font-semibold text-slate-900">Canales</h2>
          <p className="text-sm text-slate-600">
            {membership.workspace._count.channels} conectados. Cada agente podra tener su canal de WhatsApp enlazado desde aqui.
          </p>
        </Card>

        <Card className="space-y-2">
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
            <Building2 className="h-4 w-4" />
          </div>
          <h2 className="text-base font-semibold text-slate-900">Conversaciones</h2>
          <p className="text-sm text-slate-600">
            {membership.workspace._count.conversations} registradas. Aqui veremos despues la actividad real de WhatsApp.
          </p>
        </Card>
      </div>
    </section>
  );
}
