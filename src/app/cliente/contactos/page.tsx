import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { ContactosWorkspace, getContactosData } from "@/features/contactos";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ClienteContactosPage({ searchParams }: PageProps) {
  const session = await auth();

  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE"].includes(session.user.role)) {
    redirect("/unauthorized");
  }

  const params = await searchParams;
  const searchQuery = typeof params.q === "string" ? params.q.trim() : "";
  const selectedContactId = typeof params.contactId === "string" ? params.contactId.trim() : "";
  const agentFilterId = typeof params.agentId === "string" ? params.agentId.trim() : "";

  const data = await getContactosData({
    userId: session.user.id,
    searchQuery,
    selectedContactId,
    agentFilterId,
  });

  if (!data) {
    redirect("/cliente");
  }

  return <ContactosWorkspace data={data} />;
}
