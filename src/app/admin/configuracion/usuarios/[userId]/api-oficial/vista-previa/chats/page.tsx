import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, MessageSquareText, Search, UserRound } from "lucide-react";
import { auth } from "@/auth";
import { ChatsAutoRefresh } from "@/components/agents/chats-auto-refresh";
import { ChatScrollAnchor } from "@/components/agents/chat-scroll-anchor";
import { Card } from "@/components/ui/card";
import {
  OfficialApiLockedState,
  OfficialApiPanelShell,
  getOfficialApiChatsData,
} from "@/features/official-api";
import { hasAdminModuleAccess } from "@/lib/admin-module-access";
import { prisma } from "@/lib/prisma";

type PageProps = {
  params: Promise<{
    userId: string;
  }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function getContactLabel(input: { name: string | null; phoneNumber: string | null; waId: string }) {
  return input.name?.trim() || input.phoneNumber?.trim() || input.waId;
}

function getInitials(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  const initials = parts.map((part) => part.charAt(0).toUpperCase()).join("");
  return initials || "CT";
}

function formatDateDivider(date: Date) {
  return new Intl.DateTimeFormat("es-CO", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

export default async function AdminUserOfficialApiPreviewChatsPage({ params, searchParams }: PageProps) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    redirect("/unauthorized");
  }

  const canAccess = await hasAdminModuleAccess(session.user.id, session.user.role, "config_users");
  if (!canAccess) {
    redirect("/unauthorized");
  }

  const { userId } = await params;
  const paramsData = await searchParams;
  const selectedConversationId =
    typeof paramsData.conversationId === "string" ? paramsData.conversationId : "";
  const searchQuery = typeof paramsData.q === "string" ? paramsData.q.trim() : "";

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      role: true,
      workspaceMemberships: {
        orderBy: { createdAt: "asc" },
        take: 1,
        select: {
          workspace: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
    },
  });

  if (!user || user.role !== "CLIENTE") {
    redirect("/admin/configuracion/usuarios?error=Cliente+no+encontrado");
  }

  const workspace = user.workspaceMemberships[0]?.workspace;
  if (!workspace?.id) {
    redirect("/admin/configuracion/usuarios?error=Cliente+sin+workspace");
  }

  const data = await getOfficialApiChatsData({
    workspaceId: workspace.id,
    conversationId: selectedConversationId,
    q: searchQuery,
  });

  const basePath = `/admin/configuracion/usuarios/${userId}/api-oficial/vista-previa`;

  if (!data.isConnected) {
    return <OfficialApiLockedState workspaceName={workspace.name} />;
  }

  const hasMobileSelection = Boolean(selectedConversationId);
  const selectedConversationScrollKey = data.selectedConversation
    ? `${data.selectedConversation.id}:${data.selectedConversation.messages.length}:${data.selectedConversation.messages.at(-1)?.id ?? ""}`
    : "empty";

  return (
    <OfficialApiPanelShell basePath={basePath}>
      <ChatsAutoRefresh intervalMs={5000} />
      <div className="mb-3 rounded-[18px] border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
        Vista previa desde admin del workspace <span className="font-semibold">{workspace.name}</span>.
      </div>

      <div className="flex min-h-[calc(100dvh-8rem)] flex-1 flex-col gap-0 md:min-h-0 md:grid md:grid-cols-[380px_minmax(0,1fr)]">
        <Card className={`${hasMobileSelection ? "hidden md:flex" : "flex"} min-h-0 flex-1 overflow-hidden border border-[rgba(148,163,184,0.14)] bg-white p-0 shadow-[0_24px_60px_-44px_rgba(15,23,42,0.18)] md:h-[76vh] md:flex-none`}>
          <div className="flex min-h-0 w-full flex-col">
            <div className="shrink-0 border-b border-[rgba(148,163,184,0.12)] bg-white px-3 py-3">
              <form className="relative" action={`${basePath}/chats`}>
                <input type="hidden" name="conversationId" value={selectedConversationId} />
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  name="q"
                  defaultValue={data.searchQuery}
                  placeholder="Buscar chat..."
                  className="h-10 w-full rounded-2xl border border-[rgba(148,163,184,0.14)] bg-slate-50 pl-9 pr-3 text-sm text-slate-700 outline-none transition focus:border-[var(--primary)] focus:bg-white"
                />
              </form>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto divide-y divide-[rgba(148,163,184,0.12)]">
              {data.conversations.length > 0 ? data.conversations.map((conversation) => {
                const lastMessage = conversation.lastMessage;
                const label = getContactLabel(conversation.contact);
                const isSelected = data.selectedConversation?.id === conversation.id;
                const isInbound = lastMessage?.direction === "INBOUND";
                return (
                  <Link
                    key={conversation.id}
                    href={`${basePath}/chats?conversationId=${conversation.id}`}
                    className={`group relative grid w-full grid-cols-[44px_minmax(0,1fr)] items-start gap-3 overflow-hidden px-3 py-3 transition ${
                      isSelected ? "bg-[color-mix(in_srgb,var(--primary)_6%,white)]" : "hover:bg-slate-50/80"
                    }`}
                  >
                    <span className={`absolute inset-y-3 left-0 w-1 rounded-r-full ${isSelected ? "bg-[var(--primary)]" : "bg-transparent"}`} />
                    <div className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-sm font-semibold text-slate-700">
                      {getInitials(label)}
                    </div>
                    <div className="min-w-0 overflow-hidden space-y-0.5">
                      <div className="flex items-center justify-between gap-3">
                        <p className="min-w-0 flex-1 truncate text-[13px] font-semibold text-slate-950">{label}</p>
                        <span className="shrink-0 text-[10px] text-slate-500">
                          {lastMessage?.createdAt ? new Intl.DateTimeFormat("es-CO", { hour: "2-digit", minute: "2-digit" }).format(lastMessage.createdAt) : ""}
                        </span>
                      </div>
                      <div className="flex min-w-0 max-w-full items-center gap-2 overflow-hidden">
                        {isInbound ? <span className="h-2 w-2 rounded-full bg-emerald-500" /> : null}
                        <p className="block min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[13px] text-slate-600">
                          {lastMessage?.content || "Sin mensajes visibles aun."}
                        </p>
                      </div>
                    </div>
                  </Link>
                );
              }) : (
                <div className="px-5 py-12 text-center">
                  <div className="mx-auto flex max-w-sm flex-col items-center gap-3">
                    <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-50 text-slate-500">
                      <MessageSquareText className="h-5 w-5" />
                    </span>
                    <div className="space-y-1">
                      <h3 className="text-base font-semibold text-slate-950">Aun no hay conversaciones</h3>
                      <p className="text-sm leading-6 text-slate-600">Cuando lleguen mensajes por WhatsApp en la API oficial, apareceran aqui.</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </Card>

        <Card className={`${hasMobileSelection || data.conversations.length === 0 ? "flex" : "hidden md:flex"} min-h-0 flex-1 overflow-hidden border border-[rgba(148,163,184,0.14)] bg-white p-0 shadow-[0_24px_60px_-44px_rgba(15,23,42,0.18)] md:h-[76vh] md:flex-none`}>
          {data.selectedConversation ? (
            <div className="flex min-h-0 h-full w-full flex-1 flex-col">
              <div className="sticky top-0 z-10 shrink-0 border-b border-[rgba(148,163,184,0.12)] bg-[linear-gradient(180deg,#ffffff_0%,#fbfcff_100%)] px-3 py-3 md:static md:px-[10px] md:py-[10px]">
                <div className="flex min-w-0 items-center justify-between gap-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <Link
                      href={`${basePath}/chats`}
                      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[rgba(148,163,184,0.14)] bg-white text-slate-500 transition hover:bg-slate-50 md:hidden"
                      aria-label="Volver a chats"
                    >
                      <ArrowLeft className="h-4 w-4" />
                    </Link>
                    <div className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-sm font-semibold text-slate-700">
                      {getInitials(getContactLabel(data.selectedConversation.contact))}
                    </div>
                    <div className="min-w-0">
                      <h2 className="truncate text-sm font-semibold text-slate-950">
                        {getContactLabel(data.selectedConversation.contact)}
                      </h2>
                      <p className="truncate text-xs text-slate-500">
                        {data.selectedConversation.contact.phoneNumber || data.selectedConversation.contact.waId}
                      </p>
                    </div>
                  </div>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200">
                    <span className="h-2 w-2 rounded-full bg-emerald-500" />
                    Oficial
                  </span>
                </div>
              </div>

              <div className="flex min-h-0 flex-1 flex-col bg-[#f3f4f6]">
                <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 pb-24 md:px-5 md:py-5 md:pb-5" style={{ backgroundColor: "#f3f4f6" }}>
                  <div className="space-y-3">
                    {data.selectedConversation.messages.map((message, index) => {
                      const outbound = message.direction === "OUTBOUND";
                      const previousMessage = data.selectedConversation?.messages[index - 1];
                      const currentDateKey = new Intl.DateTimeFormat("en-CA").format(message.createdAt);
                      const previousDateKey = previousMessage ? new Intl.DateTimeFormat("en-CA").format(previousMessage.createdAt) : null;
                      const showDateDivider = currentDateKey !== previousDateKey;
                      return (
                        <div key={message.id} className="space-y-3">
                          {showDateDivider ? (
                            <div className="flex justify-center">
                              <span className="rounded-full border border-white/70 bg-white/80 px-3 py-1 text-[11px] font-medium capitalize text-slate-500 shadow-sm backdrop-blur">
                                {formatDateDivider(message.createdAt)}
                              </span>
                            </div>
                          ) : null}
                          <div className={`flex ${outbound ? "justify-end" : "justify-start"}`}>
                            <div className={`max-w-[85%] rounded-[16px] px-[10px] py-[9px] text-[13px] leading-5 shadow-[0_10px_24px_-20px_rgba(15,23,42,0.16)] md:max-w-[72%] ${
                              outbound ? "bg-[var(--primary)] text-white" : "border border-[rgba(148,163,184,0.12)] bg-white text-slate-800"
                            }`}>
                              <p>{message.content || "-"}</p>
                              <div className={`mt-1.5 flex items-center justify-end gap-1 text-[10px] ${outbound ? "text-white/80" : "text-slate-400"}`}>
                                <UserRound className="h-3 w-3" />
                                <span>{new Intl.DateTimeFormat("es-CO", { hour: "numeric", minute: "2-digit" }).format(message.createdAt)}</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    <ChatScrollAnchor dependencyKey={selectedConversationScrollKey} />
                  </div>
                </div>

                <div className="border-t border-[rgba(148,163,184,0.12)] bg-white px-4 py-3 text-sm text-slate-500">
                  Vista previa solo lectura desde administracion.
                </div>
              </div>
            </div>
          ) : (
            <div className="flex min-h-[74vh] items-center justify-center px-6 py-10 text-center">
              <div className="mx-auto flex max-w-sm flex-col items-center gap-3">
                <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-50 text-slate-500">
                  <MessageSquareText className="h-5 w-5" />
                </span>
                <div className="space-y-1">
                  <h3 className="text-base font-semibold text-slate-950">Selecciona una conversacion</h3>
                  <p className="text-sm leading-6 text-slate-600">Elige un chat de la columna izquierda para ver el historial.</p>
                </div>
              </div>
            </div>
          )}
        </Card>
      </div>
    </OfficialApiPanelShell>
  );
}
