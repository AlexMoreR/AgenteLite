import { redirect } from "next/navigation";
import { auth } from "@/auth";
import {
  OfficialApiChatbotWorkspace,
  OfficialApiLockedState,
  OfficialApiPanelShell,
  getOfficialApiChatbotData,
} from "@/features/official-api";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";

export default async function OfficialApiChatbotPage() {
  const session = await auth();

  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE"].includes(session.user.role)) {
    redirect("/unauthorized");
  }

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership?.workspace.id) {
    redirect("/cliente");
  }

  const data = await getOfficialApiChatbotData(membership.workspace.id);

  if (!data.isConnected) {
    return <OfficialApiLockedState workspaceName={membership.workspace.name} />;
  }

  return (
    <OfficialApiPanelShell>
      <OfficialApiChatbotWorkspace data={data} />
    </OfficialApiPanelShell>
  );
}
