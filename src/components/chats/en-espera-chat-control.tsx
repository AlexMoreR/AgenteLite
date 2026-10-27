"use client";

import { useEffect, useState, useTransition } from "react";
import { Hourglass } from "lucide-react";
import { toast } from "sonner";

import { leerChatEnEsperaAction, ponerChatEnEsperaAction, quitarChatEnEsperaAction } from "@/app/actions/chat-en-espera-actions";

type EnEsperaChatControlProps = {
  conversationId: string;
  source?: "agent" | "official";
  /** Solo el icono, para la barra de acciones del celular. */
  compacto?: boolean;
};

const hora = (iso: string) => new Date(iso).toLocaleTimeString("es-CO", { timeZone: "America/Bogota", hour: "numeric", minute: "2-digit" });

/**
 * "En espera": la asesora avisa que está averiguando algo y el Supervisor no le manda recordatorios
 * ni le quita el chat hasta que vuelva a escribirle al cliente (o pasen unas horas). Solo líneas del
 * CRM propio: el chat de la API oficial no lo usa.
 */
export function EnEsperaChatControl({ conversationId, source = "agent", compacto = false }: EnEsperaChatControlProps) {
  const [hasta, setHasta] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (source === "official") return;
    let vigente = true;
    setHasta(null);
    leerChatEnEsperaAction({ conversationId })
      .then((estado) => {
        if (vigente) setHasta(estado.enEspera ? estado.hasta : null);
      })
      .catch(() => null);
    return () => {
      vigente = false;
    };
  }, [conversationId, source]);

  if (source === "official") return null;
  const enEspera = Boolean(hasta);
  const titulo = enEspera ? `En espera hasta las ${hora(hasta as string)}. Toca para quitarlo` : "Poner el chat En espera (estoy averiguando algo)";

  const alternar = () => {
    startTransition(async () => {
      const resultado = enEspera ? await quitarChatEnEsperaAction({ conversationId }) : await ponerChatEnEsperaAction({ conversationId });
      if (resultado.error) {
        toast.error(resultado.error);
        return;
      }
      setHasta(resultado.enEspera ? (resultado.hasta ?? null) : null);
      toast.success(resultado.enEspera ? `Chat En espera hasta las ${hora(resultado.hasta as string)}` : "Chat fuera de espera");
    });
  };

  if (compacto) {
    return (
      <button
        type="button"
        onClick={alternar}
        disabled={isPending}
        aria-pressed={enEspera}
        aria-label={titulo}
        title={titulo}
        className={`inline-flex size-8 shrink-0 items-center justify-center rounded-lg border transition disabled:opacity-60 ${
          enEspera ? "border-sky-500/30 bg-sky-500/10 text-sky-600" : "border-border bg-card hover:bg-muted"
        }`}
      >
        <Hourglass className="size-4" />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={alternar}
      disabled={isPending}
      aria-pressed={enEspera}
      title={titulo}
      className={`inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-[12px] font-medium transition disabled:opacity-60 ${
        enEspera
          ? "border-sky-500/30 bg-sky-500/10 text-sky-600 hover:bg-sky-500/20"
          : "border-border bg-card text-foreground hover:bg-muted"
      }`}
    >
      <Hourglass className="h-3.5 w-3.5 shrink-0" />
      <span>{enEspera ? `En espera · ${hora(hasta as string)}` : "En espera"}</span>
    </button>
  );
}
