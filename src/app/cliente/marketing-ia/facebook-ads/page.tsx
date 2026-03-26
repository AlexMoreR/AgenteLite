import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { FacebookAdsWorkspace } from "@/components/marketing/facebook-ads-workspace";
import { getWorkspaceMarketingLogoUrl } from "@/lib/marketing-branding";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

export default async function FacebookAdsPage() {
  const session = await auth();

  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE"].includes(session.user.role)) {
    redirect("/unauthorized");
  }

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  const businessLogoUrl = membership
    ? await getWorkspaceMarketingLogoUrl(membership.workspace.id)
    : null;

  return <FacebookAdsWorkspace businessLogoUrl={businessLogoUrl} />;
}
