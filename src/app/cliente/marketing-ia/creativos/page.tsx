import type { Metadata } from "next";
import { CreativosWorkspace } from "@/components/marketing/creativos-workspace";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

export default async function CreativosPage() {
  await requireClientWorkspaceAccess("marketing_ia");

  return <CreativosWorkspace />;
}
