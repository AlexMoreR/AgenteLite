"use client";

import Image from "next/image";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import {
  ArrowRight,
  Copy,
  Mail,
  MessageCircle,
  MessagesSquare,
  Phone,
  Search,
  Sparkles,
  Users2,
  Clock3,
} from "lucide-react";
import type { ContactosContact, ContactosData } from "../types";
import { cn } from "@/lib/utils";

function getInitials(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  return parts.map((part) => part.charAt(0).toUpperCase()).join("") || "CT";
}

function formatDateLabel(value: string | null) {
  if (!value) {
    return "Sin actividad";
  }

  return new Intl.DateTimeFormat("es-CO", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatRelative(value: string) {
  const date = new Date(value);
  const diffHours = Math.max(0, Math.round((Date.now() - date.getTime()) / 3_600_000));

  if (diffHours < 1) return "Hace menos de 1 h";
  if (diffHours < 24) return `Hace ${diffHours} h`;

  const diffDays = Math.round(diffHours / 24);
  if (diffDays === 1) return "Hace 1 d";
  if (diffDays < 7) return `Hace ${diffDays} d`;
  return formatDateLabel(value);
}

function getContactDisplayName(contact: ContactosContact) {
  return contact.name?.trim() || contact.phoneNumber;
}

function getConversationHref(contact: ContactosContact) {
  const conversation = contact.recentConversations[0];
  return conversation ? `/cliente/chats?chatKey=agent:${conversation.id}` : "/cliente/chats";
}

function getTagBadgeStyle(color?: string | null) {
  const normalized = color?.trim();
  return {
    backgroundColor: normalized || "var(--primary)",
  };
}

function ContactMetric({
  label,
  value,
  helper,
  icon,
}: {
  label: string;
  value: string;
  helper: string;
  icon: ReactNode;
}) {
  return (
    <div className="rounded-[24px] border border-[var(--line)] bg-white p-4 shadow-[0_16px_34px_-28px_rgba(15,23,42,0.16)]">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</p>
          <p className="text-[1.45rem] font-semibold tracking-[-0.05em] text-slate-950">{value}</p>
          <p className="text-xs leading-5 text-slate-500">{helper}</p>
        </div>
        <div className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--primary)_10%,white)] text-[var(--primary)]">
          {icon}
        </div>
      </div>
    </div>
  );
}

function ContactCard({
  contact,
  isSelected,
  href,
}: {
  contact: ContactosContact;
  isSelected: boolean;
  href: string;
}) {
  const name = getContactDisplayName(contact);
  const lastConversation = contact.recentConversations[0] ?? null;

  return (
    <Link
      href={href}
      className={cn(
        "group block rounded-[24px] border p-4 transition",
        isSelected
          ? "border-[color:color-mix(in_srgb,var(--primary)_20%,white)] bg-[color:color-mix(in_srgb,var(--primary)_4%,white)] shadow-[0_16px_34px_-28px_rgba(37,99,235,0.24)]"
          : "border-[var(--line)] bg-white shadow-[0_16px_34px_-28px_rgba(15,23,42,0.12)] hover:-translate-y-0.5 hover:shadow-[0_20px_40px_-30px_rgba(15,23,42,0.16)]",
      )}
    >
      <div className="flex items-start gap-3">
        {contact.avatarUrl ? (
          <Image
            src={contact.avatarUrl}
            alt={name}
            width={44}
            height={44}
            unoptimized
            className="h-11 w-11 shrink-0 rounded-2xl object-cover"
          />
        ) : (
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-sm font-semibold text-slate-700">
            {getInitials(name)}
          </div>
        )}

        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="truncate text-sm font-semibold text-slate-950">{name}</h3>
              <p className="truncate text-xs text-slate-500">{contact.phoneNumber}</p>
            </div>

            <ArrowRight className="mt-0.5 h-4 w-4 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-[var(--primary)]" />
          </div>

          <div className="flex flex-wrap gap-1.5">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] text-slate-600">
              <MessagesSquare className="h-3.5 w-3.5" />
              {contact.totalConversations} chats
            </span>
            {contact.email ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] text-emerald-700">
                <Mail className="h-3.5 w-3.5" />
                Email
              </span>
            ) : null}
            {lastConversation ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[color:color-mix(in_srgb,var(--primary)_16%,white)] bg-white px-2.5 py-1 text-[11px] text-[var(--primary)]">
                <Clock3 className="h-3.5 w-3.5" />
                {formatRelative(lastConversation.lastMessageAt || lastConversation.updatedAt)}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] text-amber-700">
                Sin historial
              </span>
            )}
          </div>

          {contact.tags.length ? (
            <div className="flex flex-wrap gap-1.5">
              {contact.tags.map((tag) => (
                <span
                  key={`${contact.id}:${tag.label}`}
                  className="inline-flex max-w-full items-center rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-white shadow-[0_8px_16px_-12px_rgba(15,23,42,0.45)]"
                  style={getTagBadgeStyle(tag.color)}
                  title={tag.label}
                >
                  <span className="truncate">{tag.label}</span>
                </span>
              ))}
            </div>
          ) : null}

          {lastConversation?.lastMessage?.content ? (
            <p className="line-clamp-2 text-xs leading-5 text-slate-600">
              {lastConversation.lastMessage.content}
            </p>
          ) : (
            <p className="text-xs leading-5 text-slate-500">Aun no tiene mensajes recientes.</p>
          )}
        </div>
      </div>
    </Link>
  );
}

export function ContactosWorkspace({ data }: { data: ContactosData }) {
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const selectedContact = data.selectedContact;

  async function copyToClipboard(value: string, field: string) {
    await navigator.clipboard.writeText(value);
    setCopiedField(field);
    window.setTimeout(() => setCopiedField((current) => (current === field ? null : current)), 1200);
  }

  const selectedConversation = selectedContact?.recentConversations[0] ?? null;
  const selectedHref = selectedContact ? getConversationHref(selectedContact) : "";

  return (
    <section className="space-y-2">
      <div className="space-y-1">
        <div className="flex items-start gap-3">
          <Users2 className="mt-1 h-5 w-5 shrink-0 text-[var(--primary)]" />
          <h1 className="text-2xl font-semibold tracking-[-0.05em] text-slate-950">Contactos</h1>
        </div>
        <p className="max-w-3xl text-sm text-slate-600">
          Organiza los contactos.
        </p>
        {data.agentFilterName ? (
          <p className="text-xs font-medium text-slate-500">Filtrado por {data.agentFilterName}</p>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <ContactMetric
          label="Total"
          value={String(data.stats.total)}
          helper="Contactos visibles en el modulo."
          icon={<Users2 className="h-5 w-5" />}
        />
        <ContactMetric
          label="Con chats"
          value={String(data.stats.withConversations)}
          helper="Contactos que ya abrieron conversacion."
          icon={<MessagesSquare className="h-5 w-5" />}
        />
        <ContactMetric
          label="Sin chat"
          value={String(data.stats.withoutConversations)}
          helper="Utiles para campanas y seguimiento."
          icon={<Sparkles className="h-5 w-5" />}
        />
        <ContactMetric
          label="Con email"
          value={String(data.stats.withEmail)}
          helper="Listos para segmentacion multicanal."
          icon={<Mail className="h-5 w-5" />}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[380px_minmax(0,1fr)]">
        <div className="rounded-[28px] border border-[var(--line)] bg-white shadow-[0_24px_54px_-42px_rgba(15,23,42,0.14)]">
          <div className="border-b border-slate-100 p-4 sm:p-5">
            <form method="get" className="space-y-3">
              {data.agentFilterId ? <input type="hidden" name="agentId" value={data.agentFilterId} /> : null}
              <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                <Search className="h-4 w-4 shrink-0 text-slate-400" />
                <input
                  name="q"
                  defaultValue={data.searchQuery}
                  placeholder="Nombre, telefono, email o nota"
                  className="w-full bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
                />
              </div>
            </form>
          </div>

          <div className="max-h-[calc(100vh-18rem)] space-y-2 overflow-y-auto p-3 sm:p-4">
            {data.contacts.length > 0 ? (
              data.contacts.map((contact) => (
                <ContactCard
                  key={contact.id}
                  contact={contact}
                  isSelected={contact.id === data.selectedContactId}
                  href={`/cliente/contactos?${new URLSearchParams([
                    ...(data.searchQuery ? [["q", data.searchQuery]] : []),
                    ...(data.agentFilterId ? [["agentId", data.agentFilterId]] : []),
                    ["contactId", contact.id],
                  ]).toString()}`}
                />
              ))
            ) : (
              <div className="rounded-[24px] border border-dashed border-slate-200 bg-slate-50 px-5 py-10 text-center">
                <div className="mx-auto flex max-w-sm flex-col items-center gap-3">
                  <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-slate-500 shadow-sm">
                    <Users2 className="h-5 w-5" />
                  </span>
                  <div className="space-y-1">
                    <h3 className="text-base font-semibold text-slate-950">No hay contactos para mostrar</h3>
                    <p className="text-sm leading-6 text-slate-600">
                      Prueba quitando el filtro o revisa si ya llegaron conversaciones a tu bandeja.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="rounded-[28px] border border-[var(--line)] bg-white shadow-[0_24px_54px_-42px_rgba(15,23,42,0.14)]">
          {selectedContact ? (
            <div className="flex h-full flex-col">
              <div className="border-b border-slate-100 p-4 sm:p-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex min-w-0 items-start gap-3">
                    {selectedContact.avatarUrl ? (
                      <Image
                        src={selectedContact.avatarUrl}
                        alt={getContactDisplayName(selectedContact)}
                        width={56}
                        height={56}
                        unoptimized
                        className="h-14 w-14 shrink-0 rounded-[22px] object-cover"
                      />
                    ) : (
                      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[22px] bg-slate-100 text-base font-semibold text-slate-700">
                        {getInitials(getContactDisplayName(selectedContact))}
                      </div>
                    )}

                    <div className="min-w-0 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-[1.15rem] font-semibold tracking-[-0.04em] text-slate-950">
                          {getContactDisplayName(selectedContact)}
                        </h2>
                        {selectedConversation?.automationPaused ? (
                          <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10px] font-medium text-amber-700">
                            IA pausada
                          </span>
                        ) : null}
                      </div>
                      <p className="text-sm text-slate-500">{selectedContact.phoneNumber}</p>
                      {selectedContact.email ? <p className="text-sm text-slate-500">{selectedContact.email}</p> : null}
                      {selectedContact.tags.length ? (
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          {selectedContact.tags.map((tag) => (
                            <span
                              key={`${selectedContact.id}:${tag.label}`}
                              className="inline-flex max-w-full items-center rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-white shadow-[0_8px_16px_-12px_rgba(15,23,42,0.45)]"
                              style={getTagBadgeStyle(tag.color)}
                              title={tag.label}
                            >
                              <span className="truncate">{tag.label}</span>
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void copyToClipboard(selectedContact.phoneNumber, "phone")}
                      className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
                    >
                      <Copy className="h-4 w-4" />
                      {copiedField === "phone" ? "Copiado" : "Copiar"}
                    </button>
                    <Link
                      href={selectedHref}
                      className="inline-flex items-center gap-2 rounded-2xl bg-[var(--primary)] px-3.5 py-2 text-sm font-medium text-white transition hover:bg-[var(--primary-strong)]"
                    >
                      Abrir chat
                      <MessageCircle className="h-4 w-4" />
                    </Link>
                  </div>
                </div>
              </div>

              <div className="grid gap-4 p-4 sm:grid-cols-2 sm:p-5">
                <div className="rounded-[24px] border border-slate-100 bg-slate-50 p-4">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Resumen</p>
                  <div className="mt-3 space-y-2 text-sm text-slate-600">
                    <p>
                      <span className="font-medium text-slate-900">{selectedContact.totalConversations}</span> conversaciones
                    </p>
                    <p>
                      <span className="font-medium text-slate-900">{selectedContact.totalMessages}</span> mensajes relacionados
                    </p>
                    <p>Creado: {formatDateLabel(selectedContact.createdAt)}</p>
                    <p>Ultima actividad: {formatDateLabel(selectedContact.lastActivityAt)}</p>
                  </div>
                </div>

                <div className="rounded-[24px] border border-slate-100 bg-slate-50 p-4">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Acciones rapidas</p>
                  <div className="mt-3 space-y-2">
                    <button
                      type="button"
                      onClick={() => void copyToClipboard(selectedContact.phoneNumber, "phone")}
                      className="flex w-full items-center justify-between rounded-2xl border border-white bg-white px-3 py-2.5 text-sm text-slate-600 shadow-sm transition hover:border-[color:color-mix(in_srgb,var(--primary)_16%,white)]"
                    >
                      <span className="inline-flex items-center gap-2">
                        <Phone className="h-4 w-4 text-slate-400" />
                        {selectedContact.phoneNumber}
                      </span>
                      <Copy className="h-4 w-4 text-slate-400" />
                    </button>

                    {selectedContact.email ? (
                      <button
                        type="button"
                        onClick={() => void copyToClipboard(selectedContact.email || "", "email")}
                        className="flex w-full items-center justify-between rounded-2xl border border-white bg-white px-3 py-2.5 text-sm text-slate-600 shadow-sm transition hover:border-[color:color-mix(in_srgb,var(--primary)_16%,white)]"
                      >
                        <span className="inline-flex items-center gap-2">
                          <Mail className="h-4 w-4 text-slate-400" />
                          {selectedContact.email}
                        </span>
                        <Copy className="h-4 w-4 text-slate-400" />
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="grid gap-4 border-t border-slate-100 p-4 sm:p-5">
                <div className="rounded-[24px] border border-slate-100 bg-white p-4">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold text-slate-950">Conversaciones recientes</h3>
                    <span className="text-[11px] text-slate-500">{selectedContact.recentConversations.length} hilos</span>
                  </div>

                  <div className="mt-3 space-y-3">
                    {selectedContact.recentConversations.length > 0 ? (
                      selectedContact.recentConversations.map((conversation) => (
                        <div
                          key={conversation.id}
                          className="rounded-[20px] border border-slate-100 bg-slate-50 p-4"
                        >
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0 space-y-1">
                              <p className="text-sm font-medium text-slate-950">
                                {conversation.agent?.name ?? "Chat sin agente asignado"}
                              </p>
                              <p className="text-xs text-slate-500">
                                {conversation.channel?.name ?? "Canal"} · {conversation.status}
                              </p>
                            </div>
                            <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-slate-500">
                              {formatDateLabel(conversation.lastMessageAt || conversation.updatedAt)}
                            </span>
                          </div>

                          {conversation.lastMessage?.content ? (
                            <p className="mt-3 line-clamp-2 text-sm leading-6 text-slate-600">
                              {conversation.lastMessage.content}
                            </p>
                          ) : (
                            <p className="mt-3 text-sm text-slate-500">Sin mensaje visible en este hilo.</p>
                          )}

                          <div className="mt-3 flex flex-wrap items-center gap-2">
                            <Link
                              href={`/cliente/chats?chatKey=agent:${conversation.id}`}
                              className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-[11px] font-medium text-[var(--primary)] ring-1 ring-[color:color-mix(in_srgb,var(--primary)_14%,white)] transition hover:bg-[color:color-mix(in_srgb,var(--primary)_5%,white)]"
                            >
                              Abrir conversacion
                              <ArrowRight className="h-3.5 w-3.5" />
                            </Link>
                            {conversation.automationPaused ? (
                              <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] text-amber-700">
                                IA pausada
                              </span>
                            ) : null}
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="rounded-[20px] border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center">
                        <p className="text-sm font-medium text-slate-950">Todavia no hay conversaciones</p>
                        <p className="mt-1 text-sm leading-6 text-slate-500">
                          Este contacto todavia no ha entrado al flujo de chats.
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {selectedContact.notes ? (
                  <div className="rounded-[24px] border border-slate-100 bg-[linear-gradient(180deg,#ffffff_0%,#fbfcfe_100%)] p-4">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Notas</p>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-600">
                      {selectedContact.notes}
                    </p>
                  </div>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="flex min-h-[36rem] items-center justify-center p-6 text-center">
              <div className="mx-auto flex max-w-sm flex-col items-center gap-3">
                <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-50 text-slate-500">
                  <Users2 className="h-5 w-5" />
                </span>
                <div className="space-y-1">
                  <h3 className="text-base font-semibold text-slate-950">Selecciona un contacto</h3>
                  <p className="text-sm leading-6 text-slate-600">
                    Aqui veras su informacion, las conversaciones recientes y el acceso directo al chat.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
