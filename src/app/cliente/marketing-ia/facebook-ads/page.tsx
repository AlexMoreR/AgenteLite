import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

export default async function FacebookAdsPage() {
  await requireClientWorkspaceAccess("marketing_ia");

  redirect("/cliente/marketing-ia/creativos");
}
