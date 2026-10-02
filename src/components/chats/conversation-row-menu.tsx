"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Ban,
  ChevronLeft,
  CircleCheck,
  Clock3,
  Copy,
  MoreVertical,
  Pin,
  PinOff,
  RotateCcw,
  Tag as TagIcon,
  UserRoundCheck,
  UserRoundX,
} from "lucide-react";
import { toast } from "sonner";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { assignChatAction, updateConversationStatusAction, type AssignableMember } from "@/app/actions/chats-actions";
import { pedirMiembros } from "@/components/chats/assign-chat-control";
import {
  CHAT_SNOOZED_EVENT,
  CHAT_STATUS_CHANGED_EVENT,
  type ChatSnoozedDetail,
  type ChatStatusChangedDetail,
} from "@/components/chats/chat-inbox-types";
import { irALaBandejaLimpia } from "@/components/chats/ir-a-la-bandeja-limpia";
import { snoozeLeadAction } from "@/app/actions/crm-actions";
import { fijarChatAction } from "@/app/actions/chats-fijados-actions";
import { ponerFijados } from "@/components/chats/chats-fijados-store";
import { usePuedeBloquear } from "@/components/chats/permisos-de-la-bandeja-store";
import { bloquearContactoAction } from "@/app/actions/bloqueo-actions";

/**
 * El menú de una fila de la bandeja.
 *
 * Son las decisiones que se toman REPASANDO la lista, sin abrir cada chat: resolver lo que ya se
 * cerró, posponer lo que sigue pero no hoy, y copiar el número para pegarlo en otro lado. La
 * etapa NO está acá a propósito: se cambia tocando su chapita, que es lo que uno intenta al verla.
 *
 * "Asignar asesora" SÍ se resuelve acá, y "Etiquetas" abre la conversación. La diferencia es
 * cuándo se pide el dato: la lista del equipo se pide al TOCAR el botón, no al dibujar la fila,
 * así que los 1.800 chats de la bandeja siguen sin costar una consulta cada uno. Además se
 * comparte la misma lista cacheada del selector del chat (un pedido por minuto para toda la
 * pantalla).
 *
 * Antes este botón solo llevaba al chat: prometía asignar y lo único que hacía era navegar, así
 * que desde la bandeja no había forma de quitarle un chat a alguien ni de pasárselo a otra
 * (Alex, 25-09-2026, mirando la pantalla de Stheffani).
 */

const POSPONER_HORAS = 24;

export function ConversationRowMenu({
  chatKey,
  fijado = false,
  conversationId,
  source = "agent",
  contactId,
  phoneNumber,
  status,
  chatHref,
}: {
  /** La clave con prefijo (`agent:` / `official:`), que es como se guardan los fijados. */
  chatKey: string;
  fijado?: boolean;
  conversationId: string;
  /*
    De donde sale la conversacion. Las de la API oficial viven en otra tabla, y resolverlas
    buscandolas entre las del agente no las encuentra nunca.
  */
  source?: "agent" | "official";
  contactId: string | null;
  phoneNumber: string | null;
  status: "OPEN" | "PENDING" | "CLOSED" | "ARCHIVED";
  chatHref: string;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [isPending, startTransition] = useTransition();
  // Segunda vista del mismo menú: la lista del equipo.
  const [vistaAsignar, setVistaAsignar] = useState(false);
  const [miembros, setMiembros] = useState<AssignableMember[] | null>(null);
  const [errorMiembros, setErrorMiembros] = useState<string | null>(null);
  const [asignando, setAsignando] = useState(false);
  // Tercera vista: confirmar el bloqueo. Bloquear corta al cliente en WhatsApp: no va de un toque.
  const [vistaBloquear, setVistaBloquear] = useState(false);
  const puedeBloquear = usePuedeBloquear() && source === "agent" && Boolean(contactId);
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
        source,
      });
      if (resultado?.error) {
        toast.error(resultado.error);
        return;
      }
      toast.success(resuelto ? "Conversación reabierta" : "Conversación resuelta");
      /*
        La bandeja escucha esto para sacar la fila en el acto.

        Su refresco solo agrega y actualiza, nunca quita: sin el aviso, uno resolvia desde el menu
        y el chat se quedaba ahi, como si no hubiera pasado nada. Es lo mismo que ya hace el boton
        "Resolver" de adentro del chat.
      */
      window.dispatchEvent(
        new CustomEvent<ChatStatusChangedDetail>(CHAT_STATUS_CHANGED_EVENT, {
          detail: { conversationId, source, resolved: !resuelto },
        }),
      );
      irALaBandejaLimpia(router, !resuelto, conversationId);
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

  /*
    La lista del equipo se pide al TOCAR "Asignar asesora", no antes: es lo que permite tenerla
    en la fila sin que la bandeja pague una consulta por cada uno de sus 1.800 chats.
  */
  const abrirAsignar = useCallback(() => {
    setVistaAsignar(true);
    if (miembros !== null || errorMiembros) {
      return;
    }
    void pedirMiembros().then((resultado) => {
      if (resultado.error || !resultado.members) {
        setErrorMiembros(resultado.error ?? "No se pudo cargar el equipo");
        return;
      }
      setMiembros(resultado.members);
    });
  }, [miembros, errorMiembros]);

  const asignar = useCallback(
    (userId: string | null) => {
      if (asignando) {
        return;
      }
      setAsignando(true);
      startTransition(async () => {
        const resultado = await assignChatAction({
          conversationId,
          assignToUserId: userId,
          source,
          // La lista se reordena sola cuando entra un mensaje: si algun dia aparecen asignaciones
          // que nadie recuerda haber hecho, saber que salieron de aca es la mitad de la respuesta.
          origen: "menu-de-la-lista",
        }).catch(() => ({ error: "No se pudo asignar" }));
        setAsignando(false);

        if (resultado.error) {
          toast.error(resultado.error);
          return;
        }

        toast.success(userId ? "Chat asignado" : "Asignación quitada");
        setAbierto(false);
        setVistaAsignar(false);
        router.refresh();
      });
    },
    [asignando, conversationId, source, router],
  );

  /*
    Fijar arriba de la bandeja, como en WhatsApp: hasta 3 y solo para quien lo fija (ver
    lib/chats-fijados). La lista se reordena en el acto con lo que devuelve el servidor.
  */
  const alternarFijado = () =>
    cerrarYCorrer(async () => {
      const resultado = await fijarChatAction({ chatKey, fijar: !fijado }).catch(() => ({
        error: "No se pudo fijar",
      }));
      if ("error" in resultado) {
        toast.error(resultado.error);
        return;
      }
      ponerFijados(resultado.fijados);
      toast.success(fijado ? "Chat desfijado" : "Chat fijado arriba");
    });

  /*
    Bloquear: en WhatsApp, en todas las lineas donde tiene chat, y fuera de la bandeja y del CRM
    (ver lib/bloqueo-de-contactos). Solo duenio y admin; se desbloquea desde Contactos.
  */
  const bloquear = () =>
    cerrarYCorrer(async () => {
      if (!contactId) {
        return;
      }
      const resultado = await bloquearContactoAction({ contactId }).catch(() => ({
        error: "No se pudo bloquear",
      }));
      setVistaBloquear(false);
      if ("error" in resultado) {
        toast.error(resultado.error);
        return;
      }
      if (resultado.lineasConError.length > 0) {
        toast.warning(
          `Bloqueado en el CRM, pero en WhatsApp no se pudo en: ${resultado.lineasConError
            .map((fila) => fila.linea)
            .join(", ")}.`,
        );
      } else {
        toast.success("Contacto bloqueado. Se desbloquea desde Contactos.");
      }
      // Salen de la bandeja en el acto todos sus chats, no solo esta fila: puede tener uno por linea.
      for (const id of new Set([conversationId, ...resultado.chatIds])) {
        window.dispatchEvent(
          new CustomEvent<ChatSnoozedDetail>(CHAT_SNOOZED_EVENT, { detail: { conversationId: id, source } }),
        );
      }
      irALaBandejaLimpia(router, true, conversationId);
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
      <Popover
        open={abierto}
        onOpenChange={(siguiente) => {
          setAbierto(siguiente);
          if (!siguiente) {
            setVistaBloquear(false);
          }
        }}
      >
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
          {vistaBloquear ? (
            <div className="flex flex-col gap-2 p-1.5">
              <p className="text-[13px] font-semibold text-foreground">¿Bloquear este contacto?</p>
              <p className="text-[12px] leading-snug text-muted-foreground">
                Se bloquea en WhatsApp: ya no podrá escribir ni llamar a ninguna de nuestras líneas. Sus
                chats salen de la bandeja y del CRM. Se puede desbloquear desde Contactos.
              </p>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setVistaBloquear(false)}
                  className="rounded-lg px-3 py-1.5 text-[12.5px] text-muted-foreground transition hover:bg-muted hover:text-foreground"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={bloquear}
                  disabled={isPending}
                  className="rounded-lg bg-rose-600 px-3 py-1.5 text-[12.5px] font-medium text-white transition hover:bg-rose-700 disabled:opacity-60"
                >
                  Bloquear
                </button>
              </div>
            </div>
          ) : vistaAsignar ? (
            <div className="flex flex-col">
              <button
                type="button"
                onClick={() => setVistaAsignar(false)}
                className="mb-1 flex items-center gap-1.5 px-2.5 py-1.5 text-left text-[12px] text-muted-foreground transition hover:text-foreground"
              >
                <ChevronLeft className="size-3.5" />
                Asignar asesora
              </button>
              <div className="max-h-64 overflow-y-auto">
                {errorMiembros ? (
                  <p className="px-2.5 py-2 text-[12.5px] text-muted-foreground">{errorMiembros}</p>
                ) : miembros === null ? (
                  <p className="px-2.5 py-2 text-[12.5px] text-muted-foreground">Cargando…</p>
                ) : miembros.length === 0 ? (
                  <p className="px-2.5 py-2 text-[12.5px] text-muted-foreground">No hay a quién asignar.</p>
                ) : (
                  <>
                    {miembros.map((miembro) => (
                      <Opcion
                        key={miembro.id}
                        icono={<UserRoundCheck className="size-4" />}
                        texto={miembro.name?.trim() || miembro.email}
                        onClick={() => asignar(miembro.id)}
                      />
                    ))}
                    <div className="my-1 h-px bg-border" />
                    <Opcion
                      icono={<UserRoundX className="size-4" />}
                      texto="Quitar asignación"
                      onClick={() => asignar(null)}
                    />
                  </>
                )}
              </div>
            </div>
          ) : (
          <>
          <Opcion
            icono={fijado ? <PinOff className="size-4" /> : <Pin className="size-4" />}
            texto={fijado ? "Desfijar chat" : "Fijar chat"}
            onClick={alternarFijado}
          />
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
            onClick={abrirAsignar}
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

          {puedeBloquear ? (
            <>
              <div className="my-1 h-px bg-border" />
              <Opcion
                icono={<Ban className="size-4" />}
                texto="Bloquear contacto"
                peligro
                onClick={() => setVistaBloquear(true)}
              />
            </>
          ) : null}
          </>
          )}
        </PopoverContent>
      </Popover>
    </span>
  );
}

function Opcion({
  icono,
  texto,
  onClick,
  peligro = false,
}: {
  icono: React.ReactNode;
  texto: string;
  onClick: () => void;
  /** En rojo: acciones que cortan algo con el cliente (bloquear). */
  peligro?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[13px] transition ${
        peligro
          ? "text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-500/10"
          : "text-foreground hover:bg-muted"
      }`}
    >
      <span className={`shrink-0 ${peligro ? "" : "text-muted-foreground"}`}>{icono}</span>
      <span className="min-w-0 truncate">{texto}</span>
    </button>
  );
}
