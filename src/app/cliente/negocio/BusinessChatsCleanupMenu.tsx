"use client";

import { useFormStatus } from "react-dom";
import { Trash2, Users2 } from "lucide-react";
import {
  clearEvolutionGhostChatsAction,
  clearWorkspaceChatsAction,
  clearWorkspaceContactsAction,
} from "@/app/actions/workspace-actions";
import { clearConversationCache } from "@/components/chats/chat-history-cache";
import { WhatsAppGlyph } from "@/components/icons/whatsapp-glyph";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const cleanupItemClass =
  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition disabled:pointer-events-none disabled:opacity-50";

function ClearChatsSubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      className={`${cleanupItemClass} text-destructive hover:bg-destructive/10 focus:bg-destructive/10`}
      disabled={pending}
    >
      <Trash2 className="size-4" />
      {pending ? "Limpiando..." : "Limpiar chats"}
    </button>
  );
}

function ClearContactsSubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      className={`${cleanupItemClass} text-destructive hover:bg-destructive/10 focus:bg-destructive/10`}
      disabled={pending}
    >
      <Users2 className="size-4" />
      {pending ? "Limpiando..." : "Limpiar contactos"}
    </button>
  );
}

function ClearEvolutionGhostChatsSubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      className={`${cleanupItemClass} text-amber-600 hover:bg-amber-500/10 focus:bg-amber-500/10 dark:text-amber-400`}
      disabled={pending}
    >
      <Trash2 className="size-4" />
      {pending ? "Limpiando..." : "Limpiar chats fantasma"}
    </button>
  );
}

export function BusinessChatsCleanupMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="icon" aria-label="Abrir acciones del negocio">
          <WhatsAppGlyph className="size-4" />
        </Button>
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
        <form
          action={clearEvolutionGhostChatsAction}
          onSubmit={(event) => {
            const confirmed = window.confirm(
              "Esto eliminara chats de Evolution vacios o claramente fantasma del negocio. La accion no se puede deshacer.",
            );

            if (!confirmed) {
              event.preventDefault();
              return;
            }

            clearConversationCache();
          }}
        >
          <input type="hidden" name="confirm" value="CLEAR_EVOLUTION_GHOST_CHATS" />
          <DropdownMenuItem asChild>
            <ClearEvolutionGhostChatsSubmitButton />
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
