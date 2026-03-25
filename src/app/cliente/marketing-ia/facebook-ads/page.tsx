import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { FacebookAdsWorkspace } from "@/components/marketing/facebook-ads-workspace";
import { listMarketingGenerations } from "@/lib/marketing-store";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ClienteMarketingIaFacebookAdsPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE"].includes(session.user.role)) {
    redirect("/unauthorized");
  }

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership) {
    redirect("/cliente?error=Debes+configurar+tu+negocio+primero");
  }

  const params = await searchParams;
  const okMessage = typeof params.ok === "string" ? params.ok : "";
  const errorMessage = typeof params.error === "string" ? params.error : "";
  const selectedHistoryId = typeof params.historyId === "string" ? params.historyId : "";

  const history = await listMarketingGenerations({
    workspaceId: membership.workspace.id,
    tool: "FACEBOOK_ADS",
    limit: 12,
  });

  return (
    <FacebookAdsWorkspace
      workspaceName={membership.workspace.name}
      okMessage={okMessage}
      errorMessage={errorMessage}
      history={history}
      selectedHistoryId={selectedHistoryId}
    />
  );
}
