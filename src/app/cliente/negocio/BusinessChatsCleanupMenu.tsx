"use client";

import { useFormStatus } from "react-dom";
import { Trash2 } from "lucide-react";
import { clearWorkspaceChatsAction } from "@/app/actions/workspace-actions";
import { clearConversationCache } from "@/components/chats/chat-history-cache";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function WhatsAppGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path
        d="M12 4.5c-4.14 0-7.5 3.2-7.5 7.14 0 1.36.4 2.67 1.14 3.82L5 19l3.64-.56A7.57 7.57 0 0 0 12 18.86c4.14 0 7.5-3.2 7.5-7.14S16.14 4.5 12 4.5Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path
        d="M10.2 9.5c.18-.32.38-.33.56-.33h.48c.16 0 .43.05.65.5.18.37.63 1.55.69 1.66.06.11.1.25.03.41-.07.16-.1.26-.2.4-.1.14-.21.32-.3.42-.1.1-.2.21-.09.41.1.2.46.77.99 1.25.68.62 1.26.82 1.46.92.2.1.32.08.44-.05.12-.12.5-.58.62-.79.12-.2.25-.17.42-.1.16.08 1.07.5 1.25.6.18.1.3.15.35.24.05.08.05.5-.12.98-.17.48-.96.94-1.32 1-.36.07-.8.1-1.3.01-.5-.09-1.13-.31-1.93-.66-.98-.43-1.94-1.2-2.56-1.83-.62-.63-1.49-1.7-1.88-2.6-.39-.9-.08-1.38.02-1.56.1-.17.92-1.48.92-1.48Z"
        fill="currentColor"
      />
    </svg>
  );
}

function ClearChatsSubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm text-rose-600 transition hover:bg-rose-50 focus:bg-rose-50 focus:text-rose-700"
      disabled={pending}
    >
      <Trash2 className="h-4 w-4" />
      {pending ? "Limpiando..." : "Limpiar chats"}
    </button>
  );
}

export function BusinessChatsCleanupMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Abrir acciones del negocio"
          className="inline-flex h-10 w-10 items-center justify-center rounded-[16px] border border-[rgba(22,163,74,0.18)] bg-[color-mix(in_srgb,white_88%,#dcfce7)] text-emerald-600 transition hover:border-[rgba(22,163,74,0.35)] hover:text-emerald-700"
        >
          <WhatsAppGlyph className="h-5 w-5" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="min-w-52 rounded-2xl p-2">
        <form
          action={clearWorkspaceChatsAction}
          onSubmit={(event) => {
            const confirmed = window.confirm(
              "Esto eliminara todas las conversaciones y mensajes del negocio en todos los canales. La accion no se puede deshacer.",
            );

            if (!confirmed) {
              event.preventDefault();
              return;
            }

            clearConversationCache();
          }}
        >
          <input type="hidden" name="confirm" value="CLEAR_CHATS" />
          <DropdownMenuItem asChild>
            <ClearChatsSubmitButton />
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
