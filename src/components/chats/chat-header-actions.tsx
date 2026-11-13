"use client";

import { useEffect, useState } from "react";
import { ChevronRight, Lock, LockOpen } from "lucide-react";
import { toast } from "sonner";
import { fijarCandadoNoReasignarAction } from "@/app/actions/chats-actions";
import { candadoVigente } from "@/features/chats/domain/candado-no-reasignar";
import { InterruptorDeIA } from "./interruptor-ia";
import { InterruptorDeSeguimientos } from "./interruptor-seguimientos";
import { Skeleton } from "@/components/ui/skeleton";
import { CrmStageControl } from "./crm-stage-control";
import { ResolveChatControl } from "./resolve-chat-control";
import { SnoozeChatControl } from "./snooze-chat-control";
import type { CrmStage } from "@/features/crm/types";
import { BotonLlamar } from "@/features/llamadas/components/BotonLlamar";
import { AssignChatControl } from "./assign-chat-control";
import { ALTO_DE_LA_BARRA } from "./boton-de-la-barra";
import { CLASES_BOTON_DE_LA_BARRA, CLASES_ETIQUETA_DE_LA_BARRA, mostrarNombreAlMantener } from "./boton-de-la-barra";

type ChatHeaderActionsProps = {
  contactId: string | null;
  stage: CrmStage;
  /** Numero marcable del cliente. Null cuando solo hay un LID y no se puede llamar. */
  telefono?: string | null;
  nombreContacto?: string;
  channelId?: string | null;
  avatarUrl?: string | null;
  conversationId: string;
  automationPaused: boolean;
  status: "OPEN" | "PENDING" | "CLOSED" | "ARCHIVED";
  /** Ya no se usan (el interruptor de la IA no navega): quedan opcionales por compatibilidad. */
  returnTo?: string;
  toggleAutomationAction?: (formData: FormData) => void | Promise<void>;
  source?: "agent" | "official";
} & DatosParaElCandado;

/** Lo que necesita el boton del candado "No reasignar" (solo chats de WhatsApp normal). */
export type CandadoCambiado = { noReasignarAt: string | null; noReasignarPor: string | null };

type DatosParaElCandado = {
  /** Undefined = la pantalla no trae el candado (p. ej. la pagina del servidor): no se dibuja. */
  noReasignarAt?: string | null;
  /** La asesora asignada del chat. Null = sin asesora (el candado sale deshabilitado). */
  assignedToUserId?: string | null;
  usuarioActualId?: string | null;
  isManager?: boolean;
  /** Para que la bandeja actualice la fila y el chat abierto sin recargar. */
  onCandadoCambiado?: (conversationId: string, datos: CandadoCambiado) => void;
};

/*
  El candado "No reasignar" recien tocado, compartido por los dos botones del mismo chat (la cabecera
  ancha y la barra del celular se montan a la vez): los dos muestran lo mismo al tocar uno. Manda
  sobre el dato de la bandeja hasta que ese dato llega igual, o 60 s como mucho.
*/
const VIDA_DEL_CANDADO_LOCAL_MS = 60_000;
const candadoLocal = new Map<string, { valor: string | null; en: number }>();
const candadoEnVuelo = new Set<string>();
const oyentesDelCandado = new Set<() => void>();
function avisarCandado() {
  for (const oyente of oyentesDelCandado) oyente();
}

/**
 * Boton del candado "No reasignar". Prendido (Lock) mientras candadoVigente da true: se apaga solo a
 * las 24 h o cuando el contacto pasa a Ganado/Perdido. La asesora asignada lo prende y lo apaga; un
 * jefe solo puede quitarlo. Sin asesora, deshabilitado. No manda nada por WhatsApp: solo deja la nota
 * gris en el historial (la escribe la accion del servidor).
 */
function BotonDelCandado({
  conversationId,
  stage,
  noReasignarAt,
  assignedToUserId = null,
  usuarioActualId = null,
  isManager = false,
  onCandadoCambiado,
  compacto = false,
}: DatosParaElCandado & { conversationId: string; stage: CrmStage | null; compacto?: boolean }) {
  const id = conversationId.replace(/^agent:/, "");
  const [, setVersion] = useState(0);

  useEffect(() => {
    const alCambiar = () => setVersion((valor) => valor + 1);
    oyentesDelCandado.add(alCambiar);
    return () => {
      oyentesDelCandado.delete(alCambiar);
    };
  }, []);

  const delDato = noReasignarAt ?? null;
  // Cuando el dato de la bandeja ya llego igual, lo local sobra: desde ahi manda el dato (asi se ve
  // si otra persona lo cambia despues).
  useEffect(() => {
    if (!candadoEnVuelo.has(id) && candadoLocal.get(id)?.valor === delDato) candadoLocal.delete(id);
  }, [id, delDato]);

  const local = candadoLocal.get(id);
  const usaLocal = Boolean(local && local.valor !== delDato);
  const valor = usaLocal && local ? local.valor : delDato;
  const prendido = candadoVigente({ noReasignarAt: valor, crmStage: stage });
  const guardando = candadoEnVuelo.has(id);
  const esLaAsignada = Boolean(assignedToUserId && usuarioActualId && assignedToUserId === usuarioActualId);
  const puede = Boolean(assignedToUserId) && (esLaAsignada || (isManager && prendido));

  const nombre = prendido ? "Quitar el candado (se puede reasignar)" : "No reasignar: conservar este chat";
  const titulo = !assignedToUserId
    ? "No reasignar: el chat no tiene asesora"
    : !puede
      ? prendido
        ? "No reasignar: candado prendido por la asesora"
        : "No reasignar: solo la asesora asignada lo prende"
      : nombre;

  const cambiar = async () => {
    if (candadoEnVuelo.has(id) || !puede) return;
    const prender = !prendido;
    const antes = candadoLocal.get(id);
    candadoEnVuelo.add(id);
    // Al momento: se ve el cambio antes de que conteste el servidor.
    candadoLocal.set(id, { valor: prender ? new Date().toISOString() : null, en: Date.now() });
    avisarCandado();
    let respuesta: Awaited<ReturnType<typeof fijarCandadoNoReasignarAction>> | null = null;
    try {
      respuesta = await fijarCandadoNoReasignarAction({ conversationId: id, prender });
    } catch {
      respuesta = null;
    }
    candadoEnVuelo.delete(id);
    if (respuesta?.ok) {
      // Manda lo que quedo en el servidor; la bandeja actualiza la fila y el chat abierto.
      const guardado = { valor: respuesta.noReasignarAt, en: Date.now() };
      candadoLocal.set(id, guardado);
      avisarCandado();
      // Como mucho 60 s: despues manda siempre el dato de la bandeja.
      window.setTimeout(() => {
        if (candadoLocal.get(id) === guardado) {
          candadoLocal.delete(id);
          avisarCandado();
        }
      }, VIDA_DEL_CANDADO_LOCAL_MS);
      onCandadoCambiado?.(id, { noReasignarAt: respuesta.noReasignarAt, noReasignarPor: respuesta.noReasignarPor });
      toast.success(prender ? "Candado prendido: este chat no se reasigna" : "Candado quitado");
      return;
    }
    if (antes) candadoLocal.set(id, antes);
    else candadoLocal.delete(id);
    avisarCandado();
    toast.error(respuesta?.error ?? "No se pudo cambiar el candado. Intenta de nuevo.", { duration: 10000 });
  };

  const Icono = prendido ? Lock : LockOpen;
  const colorDelIcono = prendido ? "text-amber-600" : "text-muted-foreground";

  if (compacto) {
    return (
      <button
        type="button"
        onClick={() => void cambiar()}
        disabled={!puede || guardando}
        aria-pressed={prendido}
        aria-label={nombre}
        aria-busy={guardando}
        title={titulo}
        className={CLASES_BOTON_DE_LA_BARRA}
        onContextMenu={mostrarNombreAlMantener(titulo)}
      >
        <Icono className={`size-4 ${colorDelIcono}`} />
        <span className={CLASES_ETIQUETA_DE_LA_BARRA}>No reasignar</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void cambiar()}
      disabled={!puede || guardando}
      aria-pressed={prendido}
      aria-label={nombre}
      aria-busy={guardando}
      title={titulo}
      className={`inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-[12px] font-medium transition disabled:opacity-60 ${
        prendido
          ? "border-amber-500/20 bg-amber-500/10 text-amber-600 hover:bg-amber-500/20"
          : "border-border bg-card text-muted-foreground hover:bg-muted"
      }`}
    >
      <Icono className="h-3.5 w-3.5 shrink-0" />
      <span>No reasignar</span>
    </button>
  );
}

// Acciones de la cabecera del chat (Etapa CRM, pausar agente IA, resolver).
// Se muestran EN LÍNEA cuando la cabecera tiene ancho; cuando es angosta (móvil O panel de
// contacto abierto que estrecha la cabecera) pasan a la barra de abajo (BarraDeAccionesDelChat).
// El corte se hace por CONTAINER QUERY (@container/chathdr, definido en chat-conversation-panel)
// y NO por ancho de pantalla: así reacciona al panel abierto, que antes dejaba los controles
// apilados y diminutos. Se renderizan ambas variantes y el CSS muestra solo la que aplica.
export function ChatHeaderActions({
  contactId,
  stage,
  telefono = null,
  nombreContacto = "",
  channelId = null,
  avatarUrl = null,
  conversationId,
  automationPaused,
  status,
  source = "agent",
  noReasignarAt,
  assignedToUserId,
  usuarioActualId,
  isManager,
  onCandadoCambiado,
}: ChatHeaderActionsProps) {
  const conCandado = source === "agent" && noReasignarAt !== undefined;
  return (
    <>
      {/* Variante EN LÍNEA — solo visible cuando la cabecera es ancha (≥520px de contenedor). */}
      <div className="hidden items-center gap-1 @min-[520px]/chathdr:flex">
        {/* Llamar va primero: es la accion que se toma leyendo la conversacion, no al cerrarla. */}
        <BotonLlamar telefono={telefono} nombre={nombreContacto} avatarUrl={avatarUrl} channelId={channelId} />
        {contactId ? (
          <CrmStageControl contactId={contactId} stage={stage} conversationId={conversationId} source={source} />
        ) : null}
        <InterruptorDeIA conversationId={conversationId} automationPaused={automationPaused} source={source} />
        {source === "agent" ? <InterruptorDeSeguimientos key={conversationId} conversationId={conversationId} /> : null}
        {conCandado ? (
          <BotonDelCandado
            conversationId={conversationId}
            stage={stage}
            noReasignarAt={noReasignarAt}
            assignedToUserId={assignedToUserId}
            usuarioActualId={usuarioActualId}
            isManager={isManager}
            onCandadoCambiado={onCandadoCambiado}
          />
        ) : null}
        <ResolveChatControl conversationId={conversationId} status={status} source={source} />
        {/* Las dos salidas del chat: resolver es "esto se termino", posponer es "sigue, pero
            no hoy". Por eso van pegados. */}
        {contactId ? (
          <SnoozeChatControl contactId={contactId} conversationId={conversationId} source={source} />
        ) : null}
      </div>

      {/* Variante ANGOSTA (celular, o ficha del contacto abierta): arriba queda solo "Llamar", que
          es la accion mas frecuente leyendo un chat, igual que en WhatsApp. Lo demas -etapa,
          agente, resolver, posponer- va en la barra de abajo de la cabecera
          (BarraDeAccionesDelChat), a un toque y a la vista, en vez de escondido en tres puntos
          (Alex, 03-10-2026). */}
      <div className="flex items-center gap-0.5 @min-[520px]/chathdr:hidden">
        <BotonLlamar telefono={telefono} nombre={nombreContacto} avatarUrl={avatarUrl} channelId={channelId} />
      </div>
    </>
  );
}

/**
 * La barra en silueta, mientras llegan los datos del chat (la fila de la lista no los traia).
 *
 * Mismas piezas y mismo alto que BarraDeAccionesDelChat (etapa, agente, asignar y, al final,
 * resolver/posponer), para que al llegar los datos reales la barra no salte ni empuje los mensajes.
 */
/*
  Resolver y Posponer van fijos a la derecha de la barra (sticky): en un celular de 360 o 375 px se
  ven sin deslizar, y lo demas pasa por debajo. El fondo tapa lo que se desliza y el pr-3 es el
  espacio a la derecha que antes ponia la fila. Las mismas clases en la silueta, para que no salte.
*/
const CLASES_SALIDAS_FIJAS = "sticky right-0 z-10 order-last flex shrink-0 items-center gap-1.5 bg-card pr-3";

/**
 * La flechita que avisa que hay mas botones al deslizar. Va pegada a la izquierda de Resolver y
 * solo se ve mientras la fila (group/barra) diga data-hay-mas="true"; al llegar al final, se va.
 */
function FlechitaHayMas() {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute inset-y-0 right-full hidden w-7 items-center justify-end bg-gradient-to-l from-card to-transparent text-muted-foreground group-data-[hay-mas=true]/barra:flex"
    >
      <ChevronRight className="size-4" />
    </span>
  );
}

/** La silueta del candado "No reasignar": mismo alto de la barra y el mismo ancho que su boton (min-w-8). */
const SILUETA_DEL_CANDADO = `${ALTO_DE_LA_BARRA} w-8 rounded-lg`;

export function BarraDeAccionesEnSilueta() {
  return (
    <div className="contents" aria-hidden="true">
      <Skeleton className="h-5 w-14 rounded-full" />
      <Skeleton className="h-[1.15rem] w-8 rounded-full" />
      <span className="mx-0.5 h-5 w-px bg-border" />
      <Skeleton className={`${ALTO_DE_LA_BARRA} w-8 rounded-lg`} />
      <Skeleton className={SILUETA_DEL_CANDADO} />
      <div className={CLASES_SALIDAS_FIJAS}>
        <FlechitaHayMas />
        <span className="mx-0.5 h-5 w-px bg-border" />
        <Skeleton className={`${ALTO_DE_LA_BARRA} w-8 rounded-lg`} />
      </div>
    </div>
  );
}

/**
 * La barra de abajo de la cabecera, cuando la cabecera es angosta (celular, o ficha abierta).
 *
 * Antes todo esto vivia en tres puntos: para pausar al agente o cambiar la etapa habia que abrir
 * un menu, y desde el celular -donde mas se usa- nadie lo encontraba. Aca queda a la vista y a un
 * toque, como los botones de primera accion de los CRM de chat (Alex, 03-10-2026).
 *
 * Esta parte trae lo del chat (etapa, agente, asignar, y al final resolver y posponer). Las de la
 * conversacion que viven en el panel -nota, seguimiento, etiquetas- las agrega el panel en el medio.
 */
export function BarraDeAccionesDelChat({
  contactId,
  stage,
  conversationId,
  automationPaused,
  status,
  source = "agent",
  assignee,
  noReasignarAt,
  usuarioActualId,
  isManager,
  onCandadoCambiado,
}: Pick<
  ChatHeaderActionsProps,
  | "contactId"
  | "stage"
  | "conversationId"
  | "automationPaused"
  | "status"
  | "returnTo"
  | "toggleAutomationAction"
  | "source"
> &
  Omit<DatosParaElCandado, "assignedToUserId"> & {
  assignee: { id: string; name: string | null; email: string } | null;
}) {
  /*
    `contents`: los hijos se acomodan directo en la fila del panel. Asi Resolver y Posponer -las
    dos salidas del chat- quedan AL FINAL, despues de nota, seguimiento y etiquetas que agrega el
    panel (order-last), y no en el medio (Alex, 03-10-2026).
  */
  return (
    <div className="contents">
      {contactId ? (
        <CrmStageControl
          contactId={contactId}
          stage={stage}
          variant="chip"
          conversationId={conversationId}
          source={source}
        />
      ) : null}
      {/* Con la etiqueta "IA" a la vista: en el celular el interruptor solo no se entendia. */}
      <InterruptorDeIA conversationId={conversationId} automationPaused={automationPaused} source={source} conEtiqueta />
      {source === "agent" ? <InterruptorDeSeguimientos key={conversationId} conversationId={conversationId} conEtiqueta /> : null}
      <span aria-hidden="true" className="mx-0.5 h-5 w-px bg-border" />
      <AssignChatControl conversationId={conversationId} assignee={assignee} source={source} compacto />
      {source === "agent" && noReasignarAt !== undefined ? (
        <BotonDelCandado
          conversationId={conversationId}
          stage={stage}
          noReasignarAt={noReasignarAt}
          assignedToUserId={assignee?.id ?? null}
          usuarioActualId={usuarioActualId}
          isManager={isManager}
          onCandadoCambiado={onCandadoCambiado}
          compacto
        />
      ) : null}
      <div className={CLASES_SALIDAS_FIJAS}>
        <FlechitaHayMas />
        <span aria-hidden="true" className="mx-0.5 h-5 w-px bg-border" />
        {/* Resolver y Posponer en UN boton con menu. Sin ficha del CRM no se puede posponer:
            ahi queda solo el de resolver. */}
        {contactId ? (
          <SnoozeChatControl
            contactId={contactId}
            conversationId={conversationId}
            source={source}
            estado={status}
            compacto
          />
        ) : (
          <ResolveChatControl conversationId={conversationId} status={status} source={source} compacto />
        )}
      </div>
    </div>
  );
}
