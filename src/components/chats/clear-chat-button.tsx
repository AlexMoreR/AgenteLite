"use client";

import { useRef } from "react";
import { Trash2 } from "lucide-react";
import { clearConversationMessagesAction } from "@/app/actions/chats-actions";
import { clearConversationFromCache } from "@/components/chats/chat-history-cache";

type ClearChatButtonProps = {
  conversationId: string;
  returnTo: string;
};

export function ClearChatButton({ conversationId, returnTo }: ClearChatButtonProps) {
  const formRef = useRef<HTMLFormElement>(null);

  function handleClick() {
    if (!window.confirm("¿Limpiar este chat? Se eliminarán todos los mensajes permanentemente.")) {
      return;
    }

    clearConversationFromCache(conversationId);
    formRef.current?.requestSubmit();
  }

  return (
    <form ref={formRef} action={clearConversationMessagesAction}>
      <input type="hidden" name="conversationId" value={conversationId} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <button
        type="button"
        onClick={handleClick}
        className="shrink-0 inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition hover:bg-red-50 hover:text-red-500"
        aria-label="Limpiar chat"
        title="Limpiar chat"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </form>
  );
}
