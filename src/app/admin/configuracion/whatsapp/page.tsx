import { redirect } from "next/navigation";
import { MessageSquareMore, Save } from "lucide-react";
import { auth } from "@/auth";
import { adminUpdateEvolutionSettingsAction } from "@/app/actions/settings-actions";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { QueryFeedbackToast } from "@/components/ui/query-feedback-toast";
import { hasAdminModuleAccess } from "@/lib/admin-module-access";
import { getEvolutionSettings } from "@/lib/system-settings";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AdminConfiguracionWhatsAppPage({ searchParams }: PageProps) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    redirect("/unauthorized");
  }

  const canAccess = await hasAdminModuleAccess(session.user.id, session.user.role, "config_whatsapp");
  if (!canAccess) {
    redirect("/unauthorized");
  }

  const params = await searchParams;
  const okMessage = typeof params.ok === "string" ? params.ok : "";
  const errorMessage = typeof params.error === "string" ? params.error : "";
  const settings = await getEvolutionSettings();

  return (
    <section className="w-full space-y-5">
      <QueryFeedbackToast
        okMessage={okMessage}
        errorMessage={errorMessage}
        okTitle="Configuracion guardada"
        errorTitle="Error de configuracion"
      />

      <div>
        <h1 className="inline-flex items-center gap-1 text-lg font-semibold tracking-tight text-slate-900 md:text-xl">
          <MessageSquareMore className="h-4 w-4 text-slate-500" />
          <span>Configuracion WhatsApp</span>
        </h1>
        <p className="mt-1 text-xs text-slate-600">
          Esta conexion global de Evolution API sera usada por la aplicacion para crear y operar instancias de WhatsApp.
        </p>
      </div>

      <Card className="space-y-4">
        <form action={adminUpdateEvolutionSettingsAction} className="grid gap-4">
          <label className="space-y-1.5">
            <span className="text-sm font-medium text-slate-700">URL base de Evolution API</span>
            <Input
              name="apiBaseUrl"
              type="url"
              defaultValue={settings.apiBaseUrl}
              placeholder="https://evolution.tudominio.com"
              className="h-11"
              required
            />
          </label>

          <label className="space-y-1.5">
            <span className="text-sm font-medium text-slate-700">Token global</span>
            <Input
              name="apiToken"
              defaultValue={settings.apiToken}
              placeholder="Tu token de Evolution API"
              className="h-11"
              required
            />
          </label>

          <label className="space-y-1.5">
            <span className="text-sm font-medium text-slate-700">Prefijo de instancias</span>
            <Input
              name="instancePrefix"
              defaultValue={settings.instancePrefix}
              placeholder="agente-lite"
              className="h-11"
              required
            />
            <p className="text-xs text-slate-500">
              Se usara para generar nombres de instancia por cliente o agente.
            </p>
          </label>

          <div className="rounded-2xl border border-[rgba(148,163,184,0.14)] bg-slate-50 px-4 py-4">
            <p className="text-sm font-medium text-slate-700">Webhook de Evolution</p>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              La URL del webhook ahora se completa automaticamente desde las variables de entorno del backend.
            </p>
            <p className="mt-3 rounded-xl bg-white px-3 py-2 text-xs text-slate-500">
              URL efectiva: {settings.webhookBaseUrl || "No configurada por entorno"}
            </p>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[var(--primary)] px-4 text-sm font-medium text-white transition hover:bg-[var(--primary-strong)]"
            >
              <Save className="h-4 w-4" />
              Guardar configuracion
            </button>
          </div>
        </form>
      </Card>
    </section>
  );
}
