"use client";

import { useCallback, useTransition } from "react";
import { useRouter } from "next/navigation";
import { History, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { importConversationHistoryAction } from "@/app/actions/chats-actions";

type ImportHistoryControlProps = {
  conversationId: string;
  // En móvil el botón va dentro del menú y necesita texto; en escritorio va en línea y
  // alcanza con el icono.
  withLabel?: boolean;
};

/**
 * Trae de WhatsApp los mensajes recientes de este contacto.
 *
 * La importación automática se quitó a propósito (revivía chats viejos y suprimía la
 * bienvenida), así que este botón es el que tapa ese hueco: la asesora ve un historial
 * cortado y lo pide ella misma, sin depender de un administrador. Solo trae ESTE contacto;
 * la importación masiva de un canal sigue en Conexión.
 */
export function ImportHistoryControl({ conversationId, withLabel = false }: ImportHistoryControlProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleClick = useCallback(() => {
    startTransition(async () => {
      const result = await importConversationHistoryAction({ conversationId });

      if ("error" in result) {
        toast.error(result.error);
        return;
      }

      // Importa solo lo que falta: si no trajo nada, el chat ya estaba completo. Decirlo
      // explicitamente evita que se quede probando de nuevo pensando que no funcionó.
      if (result.imported === 0) {
        toast.info("El historial ya está completo");
        return;
      }

      toast.success(
        result.imported === 1 ? "Se trajo 1 mensaje" : `Se trajeron ${result.imported} mensajes`,
      );
      router.refresh();
    });
  }, [conversationId, router]);

  if (withLabel) {
    return (
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-[13px] font-medium text-foreground transition hover:bg-muted disabled:opacity-60"
      >
        {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <History className="h-3.5 w-3.5" />}
        {isPending ? "Trayendo..." : "Traer"}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground transition hover:bg-muted disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-ring/50"
      aria-label="Traer historial de WhatsApp"
      title="Traer historial de WhatsApp"
    >
      {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <History className="h-4 w-4" />}
    </button>
  );
}
