import { redirect } from "next/navigation";
import { MessageSquareMore } from "lucide-react";
import { auth } from "@/auth";
import { WhatsAppConnectionsSettings } from "@/components/admin/whatsapp-connections-settings";
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
          Administra por separado la conexion heredada de Evolution y la configuracion activa de Evolution Go.
        </p>
      </div>

      <WhatsAppConnectionsSettings settings={settings} />
    </section>
  );
}
