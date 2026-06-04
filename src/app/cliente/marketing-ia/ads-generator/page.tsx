import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AdsGeneratorLibrary } from "@/features/ads-generator";
import { getAdsGeneratorHistory } from "@/lib/ads-generator-history";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

export default async function AdsGeneratorPage() {
  const access = await requireClientWorkspaceAccess("marketing_ia");

  const membership = await getPrimaryWorkspaceForUser(access.userId);
  if (!membership?.workspace.id) {
    redirect("/cliente/marketing-ia");
  }

  const history = await getAdsGeneratorHistory(membership.workspace.id);

  return <AdsGeneratorLibrary history={history} />;
}
