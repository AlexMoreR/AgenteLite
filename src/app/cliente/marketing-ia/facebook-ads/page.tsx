import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { FacebookAdsWorkspace } from "@/components/marketing/facebook-ads-workspace";

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

  return <FacebookAdsWorkspace />;
}
