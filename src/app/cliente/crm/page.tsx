import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { CrmWorkspace, getCrmData } from "@/features/crm";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

export default async function ClienteCrmPage() {
  const session = await auth();

  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE"].includes(session.user.role)) {
    redirect("/unauthorized");
  }

  const data = await getCrmData({ userId: session.user.id });

  if (!data) {
    redirect("/cliente");
  }

  return <CrmWorkspace data={data} />;
}
