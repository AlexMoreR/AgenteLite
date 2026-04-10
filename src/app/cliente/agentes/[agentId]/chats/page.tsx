import { redirect } from "next/navigation";

type PageProps = {
  params: Promise<{ agentId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ClienteAgenteChatsPage({ params, searchParams }: PageProps) {
  await params;
  const query = await searchParams;

  const parts = new URLSearchParams({
    source: "agent",
  });

  if (typeof query.conversationId === "string" && query.conversationId) {
    parts.set("chatKey", `agent:${query.conversationId}`);
  }
  if (typeof query.q === "string" && query.q) {
    parts.set("q", query.q);
  }
  if (typeof query.ok === "string" && query.ok) {
    parts.set("ok", query.ok);
  }
  if (typeof query.error === "string" && query.error) {
    parts.set("error", query.error);
  }

  redirect(`/cliente/chats?${parts.toString()}`);
}
