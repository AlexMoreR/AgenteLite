import { redirect } from "next/navigation";
import { auth } from "@/auth";
import {
  OfficialApiChatbotWorkspace,
  OfficialApiLockedState,
  OfficialApiPanelShell,
  getOfficialApiChatbotData,
} from "@/features/official-api";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";

type PageProps = {
  params: Promise<{ workflowId: string }>;
};

export default async function OfficialApiChatbotWorkflowPage({ params }: PageProps) {
  const session = await auth();

  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE"].includes(session.user.role)) {
    redirect("/unauthorized");
  }

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership?.workspace.id) {
    redirect("/cliente");
  }

  const { workflowId } = await params;
  const data = await getOfficialApiChatbotData(membership.workspace.id);

  if (!data.isConnected) {
    return <OfficialApiLockedState workspaceName={membership.workspace.name} />;
  }

  const workflowExists = data.defaults.scenarios.some((scenario) => scenario.id === workflowId);
  if (!workflowExists) {
    redirect("/cliente/api-oficial/chatbot");
  }

  return (
    <OfficialApiPanelShell>
      <OfficialApiChatbotWorkspace data={data} initialScenarioId={workflowId} />
    </OfficialApiPanelShell>
  );
}
