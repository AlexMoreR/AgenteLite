"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, UserCheck, UserPlus } from "lucide-react";
import {
  assignChatAction,
  getAssignableMembersAction,
  type AssignableMember,
} from "@/app/actions/chats-actions";

type AssignChatControlProps = {
  conversationId: string;
  assignee: { id: string; name: string | null; email: string } | null;
};

function memberLabel(member: { name: string | null; email: string }) {
  return member.name?.trim() || member.email;
}

export function AssignChatControl({ conversationId, assignee }: AssignChatControlProps) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [members, setMembers] = useState<AssignableMember[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [isManager, setIsManager] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const loadMembers = useCallback(async () => {
    if (loaded || loading) return;
    setLoading(true);
    setError(null);
    const result = await getAssignableMembersAction();
    if (result.error) {
      setError(result.error);
    } else {
      setMembers(result.members ?? []);
      setCurrentUserId(result.currentUserId ?? null);
      setIsManager(Boolean(result.isManager));
      setLoaded(true);
    }
    setLoading(false);
  }, [loaded, loading]);

  const handleToggle = useCallback(() => {
    setOpen((value) => !value);
  }, []);

  useEffect(() => {
    if (open) {
      void loadMembers();
    }
  }, [open, loadMembers]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  const handleAssign = useCallback(
    (targetUserId: string | null) => {
      setError(null);
      startTransition(async () => {
        const result = await assignChatAction({ conversationId, assignToUserId: targetUserId });
        if (result?.error) {
          setError(result.error);
          return;
        }
        setOpen(false);
        router.refresh();
      });
    },
    [conversationId, router],
  );

  const assignedToMe = Boolean(assignee && currentUserId && assignee.id === currentUserId);
  const buttonLabel = assignee ? memberLabel(assignee) : "Sin asignar";

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={handleToggle}
        className={`inline-flex h-7 max-w-[160px] items-center gap-1.5 rounded-md border px-2 text-[12px] font-medium transition ${
          assignee
            ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20"
            : "border-border bg-card text-muted-foreground hover:bg-muted"
        }`}
        title={assignee ? `Asignado a ${buttonLabel}` : "Asignar chat"}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {assignee ? <UserCheck className="h-3.5 w-3.5 shrink-0" /> : <UserPlus className="h-3.5 w-3.5 shrink-0" />}
        <span className="truncate">{buttonLabel}</span>
        <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
      </button>

      {open ? (
        <div className="absolute right-0 z-50 mt-1 w-60 overflow-hidden rounded-xl border border-border bg-popover shadow-[0_18px_50px_-24px_rgba(15,23,42,0.35)]">
          <div className="border-b border-border px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Asignar chat
          </div>

          {loading ? (
            <div className="px-3 py-3 text-[12px] text-muted-foreground">Cargando equipo…</div>
          ) : error ? (
            <div className="px-3 py-3 text-[12px] text-red-500">{error}</div>
          ) : (
            <div className="max-h-72 overflow-y-auto py-1">
              {/* Tomar / soltar rápido para no-managers */}
              {!isManager ? (
                <>
                  {!assignedToMe ? (
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => currentUserId && handleAssign(currentUserId)}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-foreground transition hover:bg-muted disabled:opacity-50"
                    >
                      <UserPlus className="h-3.5 w-3.5 text-emerald-500" />
                      Tomar este chat
                    </button>
                  ) : null}
                  {assignedToMe ? (
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => handleAssign(null)}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-foreground transition hover:bg-muted disabled:opacity-50"
                    >
                      Soltar chat
                    </button>
                  ) : null}
                  {assignee && !assignedToMe ? (
                    <div className="px-3 py-2 text-[12px] text-muted-foreground">
                      Asignado a {memberLabel(assignee)}
                    </div>
                  ) : null}
                </>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => handleAssign(null)}
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-[13px] text-muted-foreground transition hover:bg-muted disabled:opacity-50"
                  >
                    <span>Sin asignar</span>
                    {!assignee ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : null}
                  </button>
                  {members.map((member) => {
                    const selected = assignee?.id === member.id;
                    return (
                      <button
                        key={member.id}
                        type="button"
                        disabled={isPending}
                        onClick={() => handleAssign(member.id)}
                        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[13px] text-foreground transition hover:bg-muted disabled:opacity-50"
                      >
                        <span className="min-w-0 truncate">
                          {memberLabel(member)}
                          {member.id === currentUserId ? " (tú)" : ""}
                        </span>
                        {selected ? <Check className="h-3.5 w-3.5 shrink-0 text-emerald-500" /> : null}
                      </button>
                    );
                  })}
                </>
              )}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
