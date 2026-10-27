import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { esJefeDelNegocio } from "@/lib/permisos-del-crm";
import { listPlaybookScriptsAction } from "@/app/actions/playbook-actions";
import { PlaybookScriptsWorkspace } from "@/features/crm/components/PlaybookScriptsWorkspace";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function ClienteCrmGuionesPage() {
  const access = await requireClientWorkspaceAccess("crm");
  // Solo dueño o administrador (Alex, 26-10-2026): las demás cuentas vuelven a Mi día.
  if (!esJefeDelNegocio(access)) redirect("/cliente/crm/mi-dia");
  const { items } = await listPlaybookScriptsAction();

  return <PlaybookScriptsWorkspace scripts={items} />;
}
