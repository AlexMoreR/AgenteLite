"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  CircleCheck,
  Clock3,
  Copy,
  MoreVertical,
  RotateCcw,
  Tag as TagIcon,
  UserRoundCheck,
} from "lucide-react";
import { toast } from "sonner";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { updateConversationStatusAction } from "@/app/actions/chats-actions";
import { snoozeLeadAction } from "@/app/actions/crm-actions";

/**
 * El menú de una fila de la bandeja.
 *
 * Son las decisiones que se toman REPASANDO la lista, sin abrir cada chat: resolver lo que ya se
 * cerró, posponer lo que sigue pero no hoy, y copiar el número para pegarlo en otro lado. La
 * etapa NO está acá a propósito: se cambia tocando su chapita, que es lo que uno intenta al verla.
 *
 * "Asignar" y "Etiquetas" abren la conversación en vez de resolverse acá: las dos necesitan
 * cargar datos del servidor (quiénes son las asesoras, qué etiquetas existen) y meter esas
 * consultas en cada una de las filas de una lista de 1.800 chats es la clase de cosa que hace
 * que la bandeja tarde en abrir.
 */

const POSPONER_HORAS = 24;

export function ConversationRowMenu({
  conversationId,
  contactId,
  phoneNumber,
  status,
  chatHref,
}: {
  conversationId: string;
  contactId: string | null;
  phoneNumber: string | null;
  status: "OPEN" | "PENDING" | "CLOSED" | "ARCHIVED";
  chatHref: string;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [isPending, startTransition] = useTransition();
  const resuelto = status === "CLOSED" || status === "ARCHIVED";

  const cerrarYCorrer = useCallback((accion: () => Promise<void>) => {
    setAbierto(false);
    startTransition(async () => {
      await accion();
    });
  }, []);

  const alternarResuelto = () =>
    cerrarYCorrer(async () => {
      const resultado = await updateConversationStatusAction({
        conversationId,
        status: resuelto ? "OPEN" : "CLOSED",
        source: "agent",
      });
      if (resultado?.error) {
        toast.error(resultado.error);
        return;
      }
      toast.success(resuelto ? "Conversación reabierta" : "Conversación resuelta");
      router.refresh();
    });

  const posponer = () =>
    cerrarYCorrer(async () => {
      if (!contactId) {
        return;
      }
      const hasta = new Date(Date.now() + POSPONER_HORAS * 60 * 60 * 1000);
      const resultado = await snoozeLeadAction({ contactId, hasta: hasta.toISOString() });
      if (resultado?.error) {
        toast.error(resultado.error);
        return;
      }
      toast.success("Pospuesto hasta mañana");
      router.refresh();
    });

  const copiarNumero = () => {
    setAbierto(false);
    if (!phoneNumber) {
      return;
    }
    void navigator.clipboard
      ?.writeText(phoneNumber)
      .then(() => toast.success("Número copiado"))
      .catch(() => toast.error("No se pudo copiar."));
  };

  return (
    /* La fila entera es un enlace al chat: sin cortar el clic, abrir el menú abría la
       conversación por debajo. */
    <span
      className="-mr-1 shrink-0"
      onClick={(evento) => {
        evento.preventDefault();
        evento.stopPropagation();
      }}
    >
      <Popover open={abierto} onOpenChange={setAbierto}>
        <PopoverTrigger
          className="inline-flex size-7 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground"
          aria-label="Acciones de la conversación"
          title="Acciones"
          disabled={isPending}
        >
          <MoreVertical className="size-4" />
        </PopoverTrigger>

        <PopoverContent
          align="end"
          side="bottom"
          sideOffset={6}
          className="w-60 rounded-2xl border border-border bg-popover p-1.5 shadow-[0_24px_60px_-24px_rgba(15,23,42,0.35)]"
        >
          <Opcion
            icono={resuelto ? <RotateCcw className="size-4" /> : <CircleCheck className="size-4" />}
            texto={resuelto ? "Reabrir conversación" : "Marcar como resuelto"}
            onClick={alternarResuelto}
          />
          {contactId ? (
            <Opcion
              icono={<Clock3 className="size-4" />}
              texto="Posponer hasta mañana"
              onClick={posponer}
            />
          ) : null}

          <div className="my-1 h-px bg-border" />

          <Opcion
            icono={<UserRoundCheck className="size-4" />}
            texto="Asignar asesora"
            onClick={() => {
              setAbierto(false);
              router.push(chatHref);
            }}
          />
          <Opcion
            icono={<TagIcon className="size-4" />}
            texto="Etiquetas"
            onClick={() => {
              setAbierto(false);
              router.push(chatHref);
            }}
          />

          {phoneNumber ? (
            <>
              <div className="my-1 h-px bg-border" />
              <Opcion icono={<Copy className="size-4" />} texto="Copiar número" onClick={copiarNumero} />
            </>
          ) : null}
        </PopoverContent>
      </Popover>
    </span>
  );
}

function Opcion({
  icono,
  texto,
  onClick,
}: {
  icono: React.ReactNode;
  texto: string;
  onClick: () => void;
}) {
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
