import { redirect } from "next/navigation";

type PageProps = {
  params: Promise<{ agentId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ClienteAgenteContactosPage({ params, searchParams }: PageProps) {
  const { agentId } = await params;
  const query = await searchParams;

  const parts = new URLSearchParams({
    agentId,
  });

  if (typeof query.q === "string" && query.q) {
    parts.set("q", query.q);
  }
  if (typeof query.contactId === "string" && query.contactId) {
    parts.set("contactId", query.contactId);
  }
  if (typeof query.ok === "string" && query.ok) {
    parts.set("ok", query.ok);
  }
  if (typeof query.error === "string" && query.error) {
    parts.set("error", query.error);
  }

  redirect(`/cliente/contactos?${parts.toString()}`);
}
