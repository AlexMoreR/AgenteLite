"use client";

import { useState } from "react";
import { ClipboardCopy, LoaderCircle } from "lucide-react";
import { toast } from "sonner";

/**
 * Copiar la conversacion entera para pegarsela a una IA.
 *
 * No es un link: una IA no puede entrar a la app —no tiene sesion— asi que un enlace no sirve de
 * nada. Lo que sirve es el texto en el portapapeles.
 *
 * Y va como TEXTO, no como JSON: la IA lo lee igual de bien y ocupa la mitad. Un JSON de 60
 * mensajes son miles de caracteres de comillas y llaves que no aportan nada.
 */
export function CopyConversationButton({
  chatKey,
  label,
  phone,
}: {
  chatKey: string;
  label: string;
  phone?: string | null;
}) {
  const [copiando, setCopiando] = useState(false);

  const copiar = async () => {
    setCopiando(true);
    try {
      const respuesta = await fetch(
        `/api/cliente/chats/live?chatKey=${encodeURIComponent(chatKey)}&batchSize=200`,
        { credentials: "same-origin", cache: "no-store" },
      );
      const datos = (await respuesta.json()) as {
        ok?: boolean;
        conversation?: {
          messages?: Array<{
            direction?: string;
            content?: string | null;
            type?: string;
            createdAt?: string;
          }>;
        };
      };

      const mensajes = datos?.conversation?.messages ?? [];
      if (!datos?.ok || mensajes.length === 0) {
        toast.error("No se pudo leer la conversación.");
        return;
      }

      const fecha = (iso?: string) => {
        if (!iso) return "";
        const d = new Date(iso);
        if (!Number.isFinite(d.getTime())) return "";
        return new Intl.DateTimeFormat("es-CO", {
          day: "2-digit",
          month: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        }).format(d);
      };

      const lineas = mensajes
        // Los mensajes de sistema son notas nuestras ("cambio la etapa a Frio"): el cliente nunca
        // los vio y solo confunden a quien lea la conversacion despues.
        .filter((mensaje) => mensaje.type !== "SYSTEM" && (mensaje.content ?? "").trim())
        .map((mensaje) => {
          const quien = mensaje.direction === "INBOUND" ? "CLIENTE" : "NOSOTROS";
          return `[${fecha(mensaje.createdAt)}] ${quien}: ${(mensaje.content ?? "").trim()}`;
        });

      const texto = [
        `Conversación de WhatsApp con ${label}${phone ? ` (${phone})` : ""}`,
        `${lineas.length} mensajes`,
        "",
        ...lineas,
      ].join("\n");

      await navigator.clipboard.writeText(texto);
      toast.success(`${lineas.length} mensajes copiados`);
    } catch {
      toast.error("No se pudo copiar. Probá de nuevo.");
    } finally {
      setCopiando(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void copiar()}
      disabled={copiando}
      aria-label="Copiar conversación para la IA"
      title="Copiar la conversación para pegársela a una IA"
      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-60"
    >
      {copiando ? (
        <LoaderCircle className="h-4 w-4 animate-spin" />
      ) : (
        <ClipboardCopy className="h-4 w-4" />
      )}
    </button>
  );
}
