"use client";

import { useFormStatus } from "react-dom";
import { Trash2, Users2 } from "lucide-react";
import { clearWorkspaceChatsAction, clearWorkspaceContactsAction } from "@/app/actions/workspace-actions";
import { clearConversationCache } from "@/components/chats/chat-history-cache";
import { WhatsAppGlyph } from "@/components/icons/whatsapp-glyph";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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

function ClearContactsSubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm text-rose-600 transition hover:bg-rose-50 focus:bg-rose-50 focus:text-rose-700"
      disabled={pending}
    >
      <Users2 className="h-4 w-4" />
      {pending ? "Limpiando..." : "Limpiar contactos"}
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
          className="inline-flex h-10 w-10 items-center justify-center rounded-[16px] border border-[rgba(22,163,74,0.18)] bg-[color-mix(in_srgb,white_90%,#dcfce7)] text-emerald-600 transition hover:border-[rgba(22,163,74,0.35)] hover:text-emerald-700"
        >
          <WhatsAppGlyph className="h-3 w-3" />
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
        <form
          action={clearWorkspaceContactsAction}
          onSubmit={(event) => {
            const confirmed = window.confirm(
              "Esto eliminara todos los contactos del negocio y sus datos asociados. La accion no se puede deshacer.",
            );

            if (!confirmed) {
              event.preventDefault();
              return;
            }
          }}
        >
          <input type="hidden" name="confirm" value="CLEAR_CONTACTS" />
          <DropdownMenuItem asChild>
            <ClearContactsSubmitButton />
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
