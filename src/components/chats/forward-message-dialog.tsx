"use client";

import * as React from "react";
import { Loader2, Search, Send } from "lucide-react";
import { toast } from "sonner";

import { sendChatMediaReplyAction } from "@/app/actions/agent-actions";
import { sendUnifiedChatReplyAction } from "@/app/actions/chats-actions";
import { ContactAvatar } from "@/components/chats/contact-avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { SharedInboxMessageItem } from "@/components/chats/chat-inbox-types";
import { getDocumentMetaFromMessage } from "@/components/chats/chat-inbox-media";

/**
 * Reenviar un mensaje a otro chat.
 *
 * Las asesoras mandan los MISMOS catalogos todo el dia (poltronas, camillas, salas de espera).
 * Sin esto tenian que volver a buscar el PDF en su celular y subirlo de nuevo en cada
 * conversacion. Ahora se reenvia el que ya esta en el chat, que ademas es el archivo que ya
 * vive en el servidor: no se vuelve a subir nada.
 *
 * Funciona en los dos canales porque las acciones de envio ya reciben la direccion del archivo
 * y resuelven solas si el chat destino es del canal viejo o de la API oficial.
 */

type ChatDestino = {
  key: string;
  label: string;
  secondaryLabel?: string | null;
  avatarUrl?: string | null;
  source?: string;
};

const TIPOS_CON_ARCHIVO = ["IMAGE", "VIDEO", "DOCUMENT"] as const;

function esReenviableComoArchivo(tipo?: string | null): tipo is (typeof TIPOS_CON_ARCHIVO)[number] {
  return TIPOS_CON_ARCHIVO.includes((tipo ?? "") as (typeof TIPOS_CON_ARCHIVO)[number]);
}

/**
 * ¿El archivo vive en NUESTRO servidor?
 *
 * Se mira la RUTA, no el texto completo: los mensajes guardan la direccion absoluta
 * ("https://app.aizenbot.com/uploads/chat-media/...") y comparar el principio contra "/uploads/"
 * no coincidia NUNCA. Resultado: reenviar cualquier foto o PDF avisaba "todavia se esta
 * guardando" y no mandaba nada, siempre.
 */
function esArchivoDeNuestroServidor(mediaUrl?: string | null): boolean {
  const direccion = mediaUrl?.trim();
  if (!direccion) {
    return false;
  }
  try {
    const ruta = direccion.startsWith("/") ? direccion : new URL(direccion).pathname;
    return ruta.startsWith("/uploads/");
  } catch {
    return false;
  }
}

export function ForwardMessageDialog({
  message,
  onClose,
}: {
  message: SharedInboxMessageItem | null;
  onClose: () => void;
}) {
  const [busqueda, setBusqueda] = React.useState("");
  const [chats, setChats] = React.useState<ChatDestino[]>([]);
  const [cargando, setCargando] = React.useState(false);
  const [enviandoA, setEnviandoA] = React.useState<string | null>(null);

  const abierto = Boolean(message);

  // Lista de chats a los que reenviar. Se pide al abrir y en cada busqueda; el servidor ya
  // devuelve los dos canales mezclados con su clave lista para usar.
  React.useEffect(() => {
    if (!abierto) {
      return;
    }

    let cancelado = false;
    const temporizador = setTimeout(async () => {
      setCargando(true);
      try {
        /*
          TODOS los chats, no los mios.

          La ruta entiende la ausencia de `assigned` como "mine", asi que sin decirlo se veian
          unicamente los chats propios: 63 de 1959. Uno abria "Reenviar" para mandarle algo a una
          clienta de otra asesora y esa clienta no figuraba, sin ninguna explicacion. (A una
          empleada la ruta le sigue mostrando solo los suyos: eso lo decide el servidor.)

          Y `status=all` porque un chat resuelto sigue siendo un destino valido: reenviarle la
          remision a alguien a quien ya se le cerro la conversacion es de lo mas normal.
        */
        const params = new URLSearchParams({ limit: "40", assigned: "all", status: "all" });
        if (busqueda.trim()) {
          params.set("q", busqueda.trim());
        }
        const respuesta = await fetch(`/api/cliente/chats/list?${params.toString()}`, {
          credentials: "same-origin",
          cache: "no-store",
        });
        const datos = (await respuesta.json().catch(() => null)) as
          | { ok?: boolean; conversations?: ChatDestino[] }
          | null;
        if (!cancelado && datos?.ok && Array.isArray(datos.conversations)) {
          setChats(datos.conversations);
        }
      } finally {
        if (!cancelado) setCargando(false);
      }
    }, busqueda.trim() ? 300 : 0);

    return () => {
      cancelado = true;
      clearTimeout(temporizador);
    };
  }, [abierto, busqueda]);

  React.useEffect(() => {
    if (!abierto) {
      setBusqueda("");
      setEnviandoA(null);
    }
  }, [abierto]);

  const reenviar = async (destino: ChatDestino) => {
    if (!message || enviandoA) {
      return;
    }

    const [fuente, ...resto] = destino.key.split(":");
    const conversationId = resto.join(":");
    if (!conversationId) {
      toast.error("No se pudo identificar ese chat.");
      return;
    }

    setEnviandoA(destino.key);
    try {
      let resultado: { ok?: boolean; error?: string } | null = null;

      /**
       * Solo se reenvian archivos que viven en NUESTRO servidor (/uploads).
       *
       * Cuando el archivo sigue apuntando al CDN de WhatsApp, el envio por el canal oficial le
       * pasa a Meta una direccion que no puede descargar (arma la URL publica a partir de la
       * ruta, y la de un CDN ajeno no sirve). Antes de reenviar algo que va a fallar en silencio,
       * se avisa: el archivo se termina de guardar solo al abrir el chat, asi que reintentar en
       * un momento suele alcanzar.
       */
      const archivoPropio = esArchivoDeNuestroServidor(message.mediaUrl);

      if (esReenviableComoArchivo(message.type) && message.mediaUrl && !archivoPropio) {
        toast.error("Ese archivo todavía se está guardando. Abrí el chat y probá de nuevo en un momento.");
        setEnviandoA(null);
        return;
      }

      if (esReenviableComoArchivo(message.type) && message.mediaUrl) {
        const meta = getDocumentMetaFromMessage(message);
        resultado = await sendChatMediaReplyAction({
          source: fuente === "official" ? "official" : "agent",
          conversationId,
          mediaUrl: message.mediaUrl,
          mediaType: message.type as "IMAGE" | "VIDEO" | "DOCUMENT",
          fileName: meta.fileName,
          mimeType: message.type === "DOCUMENT" ? "application/pdf" : "application/octet-stream",
          caption: message.content?.trim() || undefined,
          returnTo: "",
        });
      } else {
        const texto = message.content?.trim();
        if (!texto) {
          toast.error("Ese mensaje no se puede reenviar.");
          setEnviandoA(null);
          return;
        }
        const datos = new FormData();
        datos.set("source", fuente === "official" ? "official" : "agent");
        datos.set("conversationId", conversationId);
        datos.set("message", texto);
        resultado = await sendUnifiedChatReplyAction(datos);
      }

      if (resultado && "error" in resultado && resultado.error) {
        toast.error(resultado.error);
        return;
      }

      toast.success(`Reenviado a ${destino.label}`);
      onClose();
    } catch {
      toast.error("No se pudo reenviar. Probá de nuevo.");
    } finally {
      setEnviandoA(null);
    }
  };

  const resumen = React.useMemo(() => {
    if (!message) return "";
    if (esReenviableComoArchivo(message.type) && message.mediaUrl) {
      return getDocumentMetaFromMessage(message).fileName;
    }
    return message.content?.trim().slice(0, 80) || "Mensaje";
  }, [message]);

  return (
    <Dialog open={abierto} onOpenChange={(valor) => !valor && onClose()}>
      {/*
        En el celular va ARRIBA, no centrado.

        Centrado, al abrirse el teclado para buscar, la lista de destinos queda debajo del teclado:
        se ve la caja de busqueda y nada mas, justo cuando uno necesita ver a quien le manda.
        Anclado arriba, el teclado se come el espacio de la lista, que es scrolleable. El alto se
        mide con `--app-viewport-height`, que es lo unico que sabe cuanto se ve DE VERDAD con el
        teclado encima.
      */}
      <DialogContent className="max-h-[calc(var(--app-viewport-height,100dvh)-2rem)] overflow-y-auto max-sm:top-4 max-sm:translate-y-0 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reenviar</DialogTitle>
        </DialogHeader>

        <p className="truncate rounded-lg bg-muted px-3 py-2 text-[13px] text-muted-foreground">
          {resumen}
        </p>

        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={busqueda}
            onChange={(evento) => setBusqueda(evento.target.value)}
            placeholder="Buscar un chat…"
            className="pl-8"
            autoFocus
          />
        </div>

        <div className="min-h-[120px] flex-1 overflow-y-auto">
          {cargando && chats.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Buscando…</p>
          ) : chats.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No hay chats que coincidan.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {chats.map((chat) => (
                <li key={chat.key}>
                  <button
                    type="button"
                    onClick={() => void reenviar(chat)}
                    disabled={Boolean(enviandoA)}
                    className="flex w-full items-center gap-3 px-1 py-2 text-left transition hover:bg-muted disabled:opacity-60"
                  >
                    <ContactAvatar
                      avatarUrl={chat.avatarUrl}
                      label={chat.label}
                      className="size-9 shrink-0"
                    />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm font-medium text-foreground">{chat.label}</span>
                      {chat.secondaryLabel ? (
                        <span className="truncate text-[12px] text-muted-foreground">
                          {chat.secondaryLabel}
                        </span>
                      ) : null}
                    </span>
                    {enviandoA === chat.key ? (
                      <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
                    ) : (
                      <Send className="size-4 shrink-0 text-muted-foreground" />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <Button type="button" variant="outline" onClick={onClose}>
          Cancelar
        </Button>
      </DialogContent>
    </Dialog>
  );
}
