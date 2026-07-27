"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
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
  const serverResolved = status === "CLOSED" || status === "ARCHIVED";
  const [resolved, setResolved] = useState(serverResolved);

  // El estado se fijaba SOLO al montar (useState no relee la prop), así que el botón se quedaba
  // pegado: si otra persona resolvía la conversación, o si cambiabas de chat sin recargar, seguía
  // diciendo "Resolver" sobre un chat ya resuelto. Ahora se sincroniza, pero SIN pisar el clic
  // optimista: solo cuando cambia el chat, o cuando el servidor reporta un estado distinto al
  // último que nos había reportado.
  const lastServerResolvedRef = useRef(serverResolved);
  const lastConversationIdRef = useRef(conversationId);
  useEffect(() => {
    if (lastConversationIdRef.current !== conversationId) {
      lastConversationIdRef.current = conversationId;
      lastServerResolvedRef.current = serverResolved;
      setResolved(serverResolved);
      return;
    }

    if (lastServerResolvedRef.current !== serverResolved) {
      lastServerResolvedRef.current = serverResolved;
      setResolved(serverResolved);
    }
  }, [conversationId, serverResolved]);

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
