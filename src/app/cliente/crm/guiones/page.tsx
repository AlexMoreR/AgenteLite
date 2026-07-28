import type { Metadata } from "next";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { listPlaybookScriptsAction } from "@/app/actions/playbook-actions";
import { PlaybookScriptsWorkspace } from "@/features/crm/components/PlaybookScriptsWorkspace";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function ClienteCrmGuionesPage() {
  await requireClientWorkspaceAccess("crm");
  const { items } = await listPlaybookScriptsAction();

  return <PlaybookScriptsWorkspace scripts={items} />;
}
