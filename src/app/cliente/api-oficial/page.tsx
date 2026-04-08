import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import {
  OfficialApiLockedState,
  OfficialApiPanelShell,
  OfficialApiWorkspace,
  getOfficialApiOverview,
} from "@/features/official-api";
import { canAccessOfficialApiModule } from "@/lib/admin-module-access";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

export default async function OfficialApiPage() {
  const session = await auth();

  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE"].includes(session.user.role)) {
    redirect("/unauthorized");
  }
  if (!(await canAccessOfficialApiModule(session.user.id, session.user.role))) {
    redirect("/unauthorized");
  }

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership?.workspace.id) {
    redirect("/cliente");
  }

  const overview = await getOfficialApiOverview(membership.workspace.id);

  if (overview.setupStatus !== "connected") {
    return <OfficialApiLockedState workspaceName={overview.workspaceName} />;
  }

  return (
    <OfficialApiPanelShell>
      <OfficialApiWorkspace overview={overview} />
    </OfficialApiPanelShell>
  );
}
