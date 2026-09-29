"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ClipboardCopy, FileDown, History, Loader2, MoreVertical } from "lucide-react";
import { toast } from "sonner";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { importConversationHistoryAction } from "@/app/actions/chats-actions";

/**
 * El menú de la ficha del contacto.
 *
 * Antes eran dos iconos sueltos en el encabezado —copiar la conversación y traer el historial— sin
 * texto que dijera qué hacían. Con una tercera acción encima el encabezado se volvía una fila de
 * jeroglíficos, así que se juntan acá adentro, donde cada una dice su nombre.
 *
 * Se arma con Popover y botones normales, igual que el menú de la fila de la bandeja: el menú de
 * Base UI ignora `onSelect` en silencio (las opciones se dibujan y no hacen nada).
 */

type Props = {
  /** `agent:<id>` u `official:<id>`: lo que entienden /live y el PDF. */
  chatKey: string;
  label: string;
  phone?: string | null;
  /** Solo el canal viejo puede pedirle el historial a WhatsApp. */
  conversationId?: string | null;
  puedeTraerHistorial?: boolean;
};

export function MenuDelContacto({ chatKey, label, phone, conversationId, puedeTraerHistorial = false }: Props) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [copiando, setCopiando] = useState(false);
  const [bajando, setBajando] = useState(false);
  const [trayendo, startTrayendo] = useTransition();

  const ocupado = copiando || bajando || trayendo;

  /*
    Copiar la conversación entera para pegársela a una IA.

    No es un link: una IA no puede entrar a la app —no tiene sesión— así que un enlace no sirve de
    nada. Lo que sirve es el texto en el portapapeles. Y va como TEXTO, no como JSON: la IA lo lee
    igual de bien y ocupa la mitad.
  */
  const copiar = useCallback(async () => {
    setAbierto(false);
    setCopiando(true);
    try {
      const respuesta = await fetch(
        `/api/cliente/chats/live?chatKey=${encodeURIComponent(chatKey)}&batchSize=200`,
        { credentials: "same-origin", cache: "no-store" },
      );
      const datos = (await respuesta.json()) as {
        ok?: boolean;
        conversation?: {
          messages?: Array<{ direction?: string; content?: string | null; type?: string; createdAt?: string }>;
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
        // Los mensajes de sistema son notas nuestras ("cambió la etapa a Frío"): el cliente nunca
        // los vio y solo confunden a quien lea la conversación después.
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
      toast.error("No se pudo copiar. Intenta de nuevo.");
    } finally {
      setCopiando(false);
    }
  }, [chatKey, label, phone]);

  /*
    El PDF se baja como archivo, no se abre en una pestaña.

    Va por fetch y no por un enlace directo para poder mostrar que está trabajando: un chat con
    fotos tarda unos segundos, y sin aviso uno vuelve a tocar pensando que no pasó nada.
  */
  const descargarPdf = useCallback(async () => {
    setAbierto(false);
    setBajando(true);
    try {
      const respuesta = await fetch(`/api/cliente/chats/pdf?chatKey=${encodeURIComponent(chatKey)}`, {
        credentials: "same-origin",
        cache: "no-store",
      });

      if (!respuesta.ok) {
        const detalle = await respuesta.json().catch(() => null);
        toast.error(detalle?.error || "No se pudo armar el PDF.");
        return;
      }

      const archivo = await respuesta.blob();
      const url = URL.createObjectURL(archivo);
      const enlace = document.createElement("a");
      enlace.href = url;
      enlace.download = `Conversacion ${label}.pdf`.replace(/[\\/:*?"<>|]/g, " ");
      document.body.appendChild(enlace);
      enlace.click();
      enlace.remove();
      // Sin esto el blob se queda en memoria hasta que se recargue la pestaña.
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      toast.success("Conversación descargada");
    } catch {
      toast.error("No se pudo armar el PDF.");
    } finally {
      setBajando(false);
    }
  }, [chatKey, label]);

  /*
    Trae de WhatsApp los mensajes recientes de este contacto.

    La importación automática se quitó a propósito (revivía chats viejos y suprimía la bienvenida),
    así que esta opción es la que tapa ese hueco: la asesora ve un historial cortado y lo pide ella
    misma, sin depender de un administrador.
  */
  const traerHistorial = useCallback(() => {
    if (!conversationId) {
      return;
    }
    setAbierto(false);
    startTrayendo(async () => {
      const resultado = await importConversationHistoryAction({ conversationId });

      if ("error" in resultado) {
        toast.error(resultado.error);
        return;
      }

      // Evolution GO responde asíncrono: el pedido sale, y los mensajes llegan segundos después
      // por el webhook. No sabemos cuántos son todavía, así que no se promete un número.
      if (resultado.imported === null) {
        toast.success("Pidiendo el historial, va a aparecer en unos segundos");
        setTimeout(() => router.refresh(), 6000);
        return;
      }

      // Importa solo lo que falta: si no trajo nada, el chat ya estaba completo. Decirlo
      // explícitamente evita que se quede probando de nuevo pensando que no funcionó.
      const fusionados = resultado.fusionados ?? 0;
      if (resultado.imported === 0 && fusionados === 0) {
        toast.info("El historial ya está completo");
        return;
      }

      const trajo =
        resultado.imported === 1 ? "Se trajo 1 mensaje" : `Se trajeron ${resultado.imported} mensajes`;
      // El chat duplicado del mismo cliente (el del número oculto del anuncio) se unió a este.
      toast.success(fusionados > 0 ? `${trajo} y se unió el chat duplicado de este cliente` : trajo);
      router.refresh();
    });
  }, [conversationId, router]);

  return (
    <Popover open={abierto} onOpenChange={setAbierto}>
      <PopoverTrigger
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-ring/50"
        aria-label="Acciones de la conversación"
        title="Acciones"
      >
        {ocupado ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreVertical className="h-4 w-4" />}
      </PopoverTrigger>

      <PopoverContent
        align="end"
        side="bottom"
        sideOffset={6}
        className="w-60 rounded-2xl border border-border bg-popover p-1.5 shadow-[0_24px_60px_-24px_rgba(15,23,42,0.35)]"
      >
        <Opcion
          icono={<FileDown className="size-4" />}
          texto="Descargar en PDF"
          onClick={() => void descargarPdf()}
        />
        <Opcion
          icono={<ClipboardCopy className="size-4" />}
          texto="Copiar conversación"
          onClick={() => void copiar()}
        />
        {puedeTraerHistorial && conversationId ? (
          <>
            <div className="my-1 h-px bg-border" />
            <Opcion
              icono={<History className="size-4" />}
              texto="Traer historial de WhatsApp"
              onClick={traerHistorial}
            />
          </>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

function Opcion({ icono, texto, onClick }: { icono: React.ReactNode; texto: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[13px] text-foreground transition hover:bg-muted"
    >
      <span className="shrink-0 text-muted-foreground">{icono}</span>
      <span className="min-w-0 truncate">{texto}</span>
    </button>
  );
}
