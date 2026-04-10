import { redirect } from "next/navigation";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function OfficialApiChatsPage({ searchParams }: PageProps) {
  const query = await searchParams;

  const parts = new URLSearchParams({
    source: "official",
  });

  if (typeof query.conversationId === "string" && query.conversationId) {
    parts.set("chatKey", `official:${query.conversationId}`);
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
