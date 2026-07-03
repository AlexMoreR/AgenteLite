"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { updateConversationStatusAction } from "@/app/actions/chats-actions";

type ResolveChatControlProps = {
  conversationId: string;
  status: "OPEN" | "PENDING" | "CLOSED" | "ARCHIVED";
  source?: "agent" | "official";
};

export function ResolveChatControl({ conversationId, status, source = "agent" }: ResolveChatControlProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  // Estado optimista para que el botón cambie al instante.
  const [resolved, setResolved] = useState(status === "CLOSED" || status === "ARCHIVED");

  const handleClick = useCallback(() => {
    const nextResolved = !resolved;
    setResolved(nextResolved);
    startTransition(async () => {
      const result = await updateConversationStatusAction({
        conversationId,
        status: nextResolved ? "CLOSED" : "OPEN",
        source,
      });
      if (result?.error) {
        setResolved(!nextResolved); // revertir
        toast.error(result.error);
        return;
      }
      toast.success(nextResolved ? "Conversación resuelta" : "Conversación reabierta");
      router.refresh();
    });
  }, [conversationId, resolved, router, source]);

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      aria-pressed={resolved}
      title={resolved ? "Reabrir conversación" : "Resolver conversación"}
      className={`inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-[12px] font-medium transition disabled:opacity-60 ${
        resolved
          ? "border-amber-500/20 bg-amber-500/10 text-amber-600 hover:bg-amber-500/20"
          : "border-emerald-500/20 bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20"
      }`}
    >
      {resolved ? (
        <>
          <RotateCcw className="h-3.5 w-3.5 shrink-0" />
          <span>Reabrir</span>
        </>
      ) : (
        <>
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          <span>Resolver</span>
        </>
      )}
    </button>
  );
}
