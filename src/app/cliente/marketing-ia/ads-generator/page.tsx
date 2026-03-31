import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AdsGeneratorLibrary } from "@/features/ads-generator";
import { getAdsGeneratorHistory } from "@/lib/ads-generator-history";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

export default async function AdsGeneratorPage() {
  const session = await auth();

  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE"].includes(session.user.role)) {
    redirect("/unauthorized");
  }

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership?.workspace.id) {
    redirect("/cliente/marketing-ia");
  }

  const history = await getAdsGeneratorHistory(membership.workspace.id);

  return <AdsGeneratorLibrary history={history} />;
}
