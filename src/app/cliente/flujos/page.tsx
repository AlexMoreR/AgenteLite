import { redirect } from "next/navigation";
import { Workflow } from "lucide-react";
import { OfficialApiChatbotWorkspace, OfficialApiLockedState, getOfficialApiChatbotData } from "@/features/official-api";
import { getEvolutionFlowData } from "@/features/flows/services/getEvolutionFlowData";
import { getCasaDeLosFlujos } from "@/features/flows/services/casa-de-los-flujos";
import { canAccessOfficialApiModule } from "@/lib/admin-module-access";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";
import { PageHeader } from "@/components/ui/page-header";

type PageProps = {
  searchParams: Promise<{
    sourceType?: string;
    sourceId?: string;
  }>;
};

export default async function ClientFlowsPage({ searchParams }: PageProps) {
  const access = await requireClientWorkspaceAccess("flows");

  const membership = await getPrimaryWorkspaceForUser(access.userId);
  if (!membership?.workspace.id) {
    redirect("/cliente");
  }

  const query = await searchParams;

  // Los flujos son del negocio, no de una linea: se editan en un solo lugar y sirven para
  // todas (ver casa-de-los-flujos.ts). Cualquier otra direccion lleva a esa casa.
  const casa = await getCasaDeLosFlujos(membership.workspace.id);

  if (casa) {
    if (query.sourceType !== "evolution" || query.sourceId !== casa.sourceId) {
      redirect(casa.href);
    }

    const data = await getEvolutionFlowData(membership.workspace.id, casa.sourceId);
    if (!data) {
      redirect("/cliente");
    }

    const routeQuery = `?sourceType=evolution&sourceId=${encodeURIComponent(casa.sourceId)}`;

    return (
      <section className="space-y-4">
        <OfficialApiChatbotWorkspace
          key={`flows-evolution-${casa.sourceId}`}
          data={data}
          basePath="/cliente/flujos"
          routeQuery={routeQuery}
          saveEndpoint={`/api/cliente/flujos?sourceType=evolution&sourceId=${encodeURIComponent(casa.sourceId)}`}
          uploadEndpoint="/api/cliente/flujos/upload-media"
          saveSuccessDescription="El flujo quedo guardado y sirve para todas las lineas."
        />
      </section>
    );
  }

  // Sin lineas no oficiales, la unica casa posible es la API oficial.
  const canUseOfficialApi = await canAccessOfficialApiModule(access.userId, access.role);
  if (!canUseOfficialApi) {
    return (
      <section className="space-y-4">
        <PageHeader icon={Workflow} title="Flujos" />
        <div className="rounded-[28px] border border-dashed border-[rgba(148,163,184,0.32)] bg-white px-6 py-10 text-sm leading-6 text-slate-600">
          Aun no hay una linea de WhatsApp para guardar flujos. Conecta primero una linea.
        </div>
      </section>
    );
  }

  if (query.sourceType !== "official-api") {
    redirect("/cliente/flujos?sourceType=official-api");
  }

  const data = await getOfficialApiChatbotData(membership.workspace.id);
  if (!data.isConnected) {
    return <OfficialApiLockedState workspaceName={membership.workspace.name} />;
  }

  return (
    <section className="space-y-4">
      <OfficialApiChatbotWorkspace
        key="flows-official"
        data={data}
        basePath="/cliente/flujos"
        routeQuery="?sourceType=official-api"
        saveEndpoint="/api/cliente/flujos?sourceType=official-api"
        uploadEndpoint="/api/cliente/flujos/upload-media"
        saveSuccessDescription="El flujo quedo guardado y sirve para todas las lineas."
      />
    </section>
  );
}
