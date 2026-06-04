import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ContactosWorkspace, getContactosData } from "@/features/contactos";
import { QueryFeedbackToast } from "@/components/ui/query-feedback-toast";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ClienteContactosPage({ searchParams }: PageProps) {
  const access = await requireClientWorkspaceAccess("contacts");

  const params = await searchParams;
  const searchQuery = typeof params.q === "string" ? params.q.trim() : "";
  const selectedContactId = typeof params.contactId === "string" ? params.contactId.trim() : "";
  const agentFilterId = typeof params.agentId === "string" ? params.agentId.trim() : "";
  const reportRangeDays = typeof params.range === "string" ? Number(params.range) : undefined;
  const page = typeof params.page === "string" ? Number(params.page) : undefined;
  const activeView = params.view === "informe" ? "informe" : "contacto";
  const okMessage = typeof params.ok === "string" ? params.ok : "";
  const errorMessage = typeof params.error === "string" ? params.error : "";

  const data = await getContactosData({
    userId: access.userId,
    searchQuery,
    selectedContactId,
    agentFilterId,
    reportRangeDays,
    page,
    includeReport: activeView === "informe",
  });

  if (!data) {
    redirect("/cliente");
  }

  return (
    <>
      <QueryFeedbackToast
        okMessage={okMessage}
        errorMessage={errorMessage}
        okTitle="Contactos actualizados"
        errorTitle="No pudimos completar la accion"
      />
      <ContactosWorkspace data={data} activeView={activeView} />
    </>
  );
}
