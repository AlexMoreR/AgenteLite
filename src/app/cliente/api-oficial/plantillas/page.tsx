import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  OfficialApiLockedState,
  OfficialApiPanelShell,
  OfficialApiTemplatesWorkspace,
  getOfficialApiOverview,
} from "@/features/official-api";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

export default async function OfficialApiTemplatesPage() {
  const access = await requireClientWorkspaceAccess("client_official_api");

  const membership = await getPrimaryWorkspaceForUser(access.userId);
  if (!membership?.workspace.id) {
    redirect("/cliente");
  }

  const overview = await getOfficialApiOverview(membership.workspace.id);

  if (overview.setupStatus !== "connected") {
    return <OfficialApiLockedState workspaceName={overview.workspaceName} />;
  }

  return (
    <OfficialApiPanelShell>
      <OfficialApiTemplatesWorkspace />
    </OfficialApiPanelShell>
  );
}
