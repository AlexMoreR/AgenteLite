import { AgentV2Workspace } from "@/features/agents-v2/components/AgentV2Workspace";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";

export default async function ClienteAgenteV2Page() {
  await requireClientWorkspaceAccess("agents_v2");

  return (
    <section className="w-full overflow-x-hidden">
      <AgentV2Workspace />
    </section>
  );
}
