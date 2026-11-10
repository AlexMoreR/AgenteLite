"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, UserCheck, UserPlus, Users, X } from "lucide-react";
import { CLASES_BOTON_DE_LA_BARRA, CLASES_ETIQUETA_DE_LA_BARRA, mostrarNombreAlMantener } from "@/components/chats/boton-de-la-barra";
import {
  asignarSegundoAsesorAction,
  assignChatAction,
  getAssignableMembersAction,
  type AssignableMember,
} from "@/app/actions/chats-actions";
import {
  olvidarSegundoSiYaLlego,
  olvidarSiYaLlego,
  recordarAsignacion,
  recordarSegundoAsesor,
  useAsignadoMostrado,
  useSegundoAsesorMostrado,
} from "@/components/chats/asignacion-optimista";

type AssignChatControlProps = {
  conversationId: string;
  assignee: { id: string; name: string | null; email: string } | null;
  // De que canal es el chat: los de la API oficial se guardan en otra tabla.
  source?: "agent" | "official";
  /** Barra del celular: solo el icono (verde si tiene asesora); el nombre va en el title. */
  compacto?: boolean;
  /**
   * El segundo asesor del chat (null = no tiene). Si no se pasa (undefined), no se muestra el
   * bloque "Agregar asesor": la barra compacta y la API oficial no lo tienen.
   */
  segundoAsesor?: { id: string; name: string | null } | null;
};

/*
  La lista del equipo, UNA vez para toda la pantalla (Alex, 16-sep-2026: "se demora en cargar a
  quien asignar").

  Se pedia al abrir el menu y en CADA chat: el control se vuelve a montar al cambiar de chat, asi que
  cada apertura era una consulta nueva, y ademas esperaba en fila detras de las que dispara el chat al
  abrirse. El equipo cambia muy poco: se guarda un minuto y se comparte entre chats.
*/
type ResultadoMiembros = Awaited<ReturnType<typeof getAssignableMembersAction>>;
let miembrosEnCache: { cuando: number; pedido: Promise<ResultadoMiembros> } | null = null;

export function pedirMiembros() {
  const ahora = Date.now();
  if (!miembrosEnCache || ahora - miembrosEnCache.cuando > 60_000) {
    const pedido = getAssignableMembersAction().catch(() => ({ error: "No se pudo cargar el equipo" }) as ResultadoMiembros);
    miembrosEnCache = { cuando: ahora, pedido };
    // Un error no se guarda: el proximo intento vuelve a preguntar.
    void pedido.then((resultado) => {
      if (resultado.error && miembrosEnCache?.pedido === pedido) {
        miembrosEnCache = null;
      }
    });
  }
  return miembrosEnCache.pedido;
}

function memberLabel(member: { name: string | null; email: string }) {
  return member.name?.trim() || member.email;
}

export function AssignChatControl({
  conversationId,
  assignee: asignadoDelServidor,
  source = "agent",
  compacto = false,
  segundoAsesor: segundoDelServidor,
}: AssignChatControlProps) {
  /*
    Quien lo tiene AHORA, sin esperar al servidor.

    Antes el chip solo cambiaba cuando terminaba `router.refresh()`, que vuelve a renderizar la
    pantalla entera de chats -mil y pico conversaciones-. Asignar era instantaneo en la base y
    tardaba segundos en verse, asi que parecia que no habia pasado nada (Alex, 25-09-2026).

    `undefined` significa "todavia no toque nada, mostra lo que dice el servidor".
  */
  /*
    La marca vive FUERA del componente (ver asignacion-optimista).

    Estaba en `useState`, y el `router.refresh()` que sale justo despues de asignar puede
    desmontar este control: ahi la marca se perdia y la ficha volvia a mostrar lo viejo. La
    asesora ve que su toque "no hizo nada" y vuelve a tocar — el 29-09-2026 quedaron dos tomas del
    mismo chat con 12 segundos de diferencia, y con el menu abierto un segundo toque puede caer en
    otra opcion.
  */
  const assignee = useAsignadoMostrado(conversationId, asignadoDelServidor);

  // Cuando el servidor por fin dice lo mismo, se suelta la marca: si no, una asignacion hecha
  // desde otro lado -el menu de la lista, otra pestaña, un jefe- no se veria nunca aca.
  useEffect(() => {
    olvidarSiYaLlego(conversationId, asignadoDelServidor);
  }, [conversationId, asignadoDelServidor]);
  // El segundo asesor, con la misma marca optimista que el principal (ver asignacion-optimista).
  const conSegundoAsesor = !compacto && source === "agent" && segundoDelServidor !== undefined;
  const segundoAsesor = useSegundoAsesorMostrado(conversationId, segundoDelServidor ?? null);
  const segundoDelServidorId = segundoDelServidor?.id ?? null;
  const traeSegundo = segundoDelServidor !== undefined;
  useEffect(() => {
    if (!traeSegundo) return;
    olvidarSegundoSiYaLlego(conversationId, segundoDelServidorId ? { id: segundoDelServidorId, name: null } : null);
  }, [conversationId, traeSegundo, segundoDelServidorId]);
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  // Barra del celular: la lista se dibuja fuera de la fila (portal), asi que vive en otro lugar.
  const listaRef = useRef<HTMLDivElement>(null);
  const botonCompactoRef = useRef<HTMLButtonElement>(null);
  const segundoRef = useRef<HTMLDivElement>(null);
  const [segundoOpen, setSegundoOpen] = useState(false);
  const [segundoError, setSegundoError] = useState<string | null>(null);
  const [segundoPending, startSegundoTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [members, setMembers] = useState<AssignableMember[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [isManager, setIsManager] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  // Mientras no llego la lista, el menu muestra "Cargando…".
  const loading = !loaded && !error;

  // Se pide apenas se abre el chat, no al tocar el menu: cuando la asesora lo abre, ya esta.
  useEffect(() => {
    let vigente = true;
    void pedirMiembros().then((result) => {
      if (!vigente) return;
      if (result.error) {
        setError(result.error);
        return;
      }
      setMembers(result.members ?? []);
      setCurrentUserId(result.currentUserId ?? null);
      setIsManager(Boolean(result.isManager));
      setLoaded(true);
    });
    return () => {
      vigente = false;
    };
  }, []);

  const handleToggle = useCallback(() => {
    setOpen((value) => !value);
  }, []);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      const destino = event.target as Node;
      // La lista de la barra del celular vive fuera del contenedor (portal): tocarla es tocar
      // adentro. Si no, tocar una asesora cerraria la lista antes de asignar.
      if (listaRef.current?.contains(destino)) return;
      if (containerRef.current && !containerRef.current.contains(destino)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  /*
    Barra del celular: la lista va `fixed`, contra la pantalla.

    Era `absolute` dentro de la fila que se desliza de lado (overflow-x-auto), y esa fila la cortaba:
    se veia apenas el comienzo. Se mide donde quedo el boton y se dibuja encima de todo, como la
    lista de etapas (crm-stage-control): sin salirse de la pantalla por ningun lado y abriendo para
    arriba si abajo no hay lugar. Al deslizar o cambiar el tamaño se vuelve a ubicar.
  */
  const [posicionLista, setPosicionLista] = useState<{
    left: number;
    top?: number;
    bottom?: number;
    alto: number;
  } | null>(null);
  useEffect(() => {
    if (!open || !compacto) return;
    const ubicar = () => {
      const caja = botonCompactoRef.current?.getBoundingClientRect();
      if (!caja) return;
      const ancho = 224;
      const margen = 12;
      const izquierda = Math.min(Math.max(margen, caja.left), Math.max(margen, window.innerWidth - ancho - margen));
      const espacioAbajo = window.innerHeight - caja.bottom - margen;
      const espacioArriba = caja.top - margen;
      const abreAbajo = espacioAbajo >= 240 || espacioAbajo >= espacioArriba;
      setPosicionLista(
        abreAbajo
          ? { left: izquierda, top: caja.bottom + 4, alto: Math.max(120, espacioAbajo - 4) }
          : { left: izquierda, bottom: window.innerHeight - caja.top + 4, alto: Math.max(120, espacioArriba - 4) },
      );
    };
    ubicar();
    window.addEventListener("resize", ubicar);
    window.addEventListener("scroll", ubicar, true);
    return () => {
      window.removeEventListener("resize", ubicar);
      window.removeEventListener("scroll", ubicar, true);
      // Al cerrar se olvida: la proxima vez se mide de nuevo y no aparece un instante donde estaba.
      setPosicionLista(null);
    };
  }, [open, compacto]);

  // La lista de "Agregar asesor" se cierra al tocar afuera, igual que la de "Asignar".
  useEffect(() => {
    if (!segundoOpen) return;
    function onPointerDown(event: MouseEvent) {
      if (segundoRef.current && !segundoRef.current.contains(event.target as Node)) {
        setSegundoOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [segundoOpen]);

  /*
    Agrega (userId) o quita (null) al segundo asesor. El principal no cambia. Mismo patron que
    "Asignar": se ve de una cuando el servidor lo guardo, y el refresco va aparte, sin esperarlo.
  */
  const handleSegundo = useCallback(
    (targetUserId: string | null) => {
      if ((segundoAsesor?.id ?? null) === targetUserId) {
        setSegundoOpen(false);
        return;
      }
      setSegundoError(null);
      startSegundoTransition(async () => {
        const result = await asignarSegundoAsesorAction({ conversationId, userId: targetUserId }).catch(
          () => ({ error: "No se pudo guardar. Revisa la conexión y vuelve a intentarlo." }) as Awaited<
            ReturnType<typeof asignarSegundoAsesorAction>
          >,
        );
        if (result?.error) {
          setSegundoError(result.error);
          return;
        }
        const elegido = targetUserId ? (members.find((miembro) => miembro.id === targetUserId) ?? null) : null;
        recordarSegundoAsesor(
          conversationId,
          targetUserId
            ? { id: targetUserId, name: elegido ? memberLabel(elegido) : (result.segundoAsesor?.name ?? null) }
            : null,
        );
        setSegundoOpen(false);
      });
      router.refresh();
    },
    [conversationId, members, router, segundoAsesor?.id],
  );

  const handleAssign = useCallback(
    (targetUserId: string | null) => {
      /*
        Asignarle el chat a quien YA lo tiene no es una asignación: es un toque de más.

        En producción quedaron tres notas seguidas en el mismo chat, al mismo destino, en dos
        segundos (07:37:13, :14 y :15 del 28-09-2026), y varias parejas iguales con doce segundos
        de diferencia. Los botones ya se deshabilitan mientras la acción viaja, así que no son
        llamadas simultáneas: son toques repetidos porque en el celular no se ve que haya pasado
        algo. Cada uno dejaba su nota, y el historial del chat terminaba pareciendo que el sistema
        reasigna solo — que es justo lo que nos vino a preguntar Alex (28-09-2026).

        Cortarlo acá, además de limpiar el historial, evita mover la rueda del reparto por turnos.
      */
      if (targetUserId && assignee?.id === targetUserId) {
        setOpen(false);
        return;
      }
      setError(null);
      startTransition(async () => {
        const result = await assignChatAction({ conversationId, assignToUserId: targetUserId, source, origen: "ficha-del-chat" });
        if (result?.error) {
          setError(result.error);
          return;
        }

        /*
          Se ve el cambio de una: el servidor ya lo guardo, no hay nada que esperar.

          El nombre se toma de la lista del equipo, que ya esta cargada, y no de la respuesta:
          asi el chip nunca queda en blanco si al usuario le falta el nombre y solo tiene correo.
        */
        const elegido = targetUserId ? (members.find((miembro) => miembro.id === targetUserId) ?? null) : null;
        // Si el nuevo principal era el segundo asesor, el servidor ya lo quito de segundo.
        if (targetUserId && segundoAsesor?.id === targetUserId) {
          recordarSegundoAsesor(conversationId, null);
        }
        recordarAsignacion(
          conversationId,
          elegido
            ? { id: elegido.id, name: elegido.name, email: elegido.email }
            : result.assignedTo
              ? { id: result.assignedTo.id, name: result.assignedTo.name, email: "" }
              : null,
        );
        setOpen(false);
      });

      /*
        El refresco va por FUERA de la transicion y sin esperarlo: sirve para que el resto de la
        pantalla (la fila de la bandeja) se entere, pero nadie tiene que quedarse mirando mientras
        se rehacen mil conversaciones.
      */
      router.refresh();
    },
    [assignee?.id, conversationId, members, router, segundoAsesor?.id, source],
  );

  const assignedToMe = Boolean(assignee && currentUserId && assignee.id === currentUserId);
  const buttonLabel = assignee ? memberLabel(assignee) : "Sin asignar";
  // Un chat se puede traspasar cuando es propio o no tiene dueno. El servidor vuelve a
  // comprobarlo: esto es solo para no ofrecer algo que va a ser rechazado.
  const puedeTraspasar = !assignee || assignedToMe;
  const companeras = members.filter((member) => member.id !== currentUserId);

  // "Agregar asesor": lo usa el jefe o el dueño del chat. El segundo asesor solo puede quitarse.
  const puedeManejarSegundo = isManager || assignedToMe;
  const soyElSegundo = Boolean(segundoAsesor && currentUserId && segundoAsesor.id === currentUserId);
  const candidatosSegundo = members.filter((member) => member.id !== assignee?.id);
  const nombreSegundo = segundoAsesor
    ? (() => {
        const miembro = members.find((member) => member.id === segundoAsesor.id);
        return miembro ? memberLabel(miembro) : segundoAsesor.name?.trim() || "Otro asesor";
      })()
    : "";

  const bloqueSegundo =
    conSegundoAsesor && loaded ? (
      segundoAsesor ? (
        puedeManejarSegundo || soyElSegundo ? (
          <div className="space-y-1">
            <div className="inline-flex h-9 max-w-full items-center gap-1.5 rounded-md border border-emerald-500/20 bg-emerald-500/10 pl-3 text-[13px] font-medium text-emerald-600">
              <Users className="h-4 w-4 shrink-0" />
              <span className="min-w-0 truncate">
                {nombreSegundo}
                {soyElSegundo ? " (tú)" : ""}
              </span>
              <button
                type="button"
                disabled={segundoPending}
                onClick={() => handleSegundo(null)}
                className="inline-flex size-9 shrink-0 items-center justify-center rounded-md transition hover:bg-emerald-500/20 disabled:opacity-50"
                title={soyElSegundo ? "Quitarme de este chat" : `Quitar a ${nombreSegundo} del chat`}
                aria-label={soyElSegundo ? "Quitarme de este chat" : `Quitar a ${nombreSegundo} del chat`}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {segundoError ? <div className="text-[12px] text-red-500">{segundoError}</div> : null}
          </div>
        ) : null
      ) : assignee && puedeManejarSegundo ? (
        <div ref={segundoRef} className="relative space-y-1">
          <button
            type="button"
            disabled={segundoPending}
            onClick={() => setSegundoOpen((value) => !value)}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-[13px] font-medium text-foreground transition hover:bg-muted disabled:opacity-50"
            aria-haspopup="menu"
            aria-expanded={segundoOpen}
          >
            <UserPlus className="h-4 w-4 shrink-0" />
            Agregar asesor
          </button>
          {segundoError ? <div className="text-[12px] text-red-500">{segundoError}</div> : null}
          {segundoOpen ? (
            <div className="absolute left-0 z-50 mt-1 w-60 overflow-hidden rounded-xl border border-border bg-popover shadow-[0_18px_50px_-24px_rgba(15,23,42,0.35)]">
              <div className="border-b border-border px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Agregar asesor
              </div>
              <div className="max-h-72 overflow-y-auto py-1">
                {candidatosSegundo.length === 0 ? (
                  <div className="px-3 py-2 text-[12px] text-muted-foreground">No hay nadie mas en el equipo.</div>
                ) : (
                  candidatosSegundo.map((member) => (
                    <button
                      key={member.id}
                      type="button"
                      disabled={segundoPending}
                      onClick={() => handleSegundo(member.id)}
                      className="flex min-h-10 w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-foreground transition hover:bg-muted disabled:opacity-50"
                    >
                      <span className="min-w-0 truncate">
                        {memberLabel(member)}
                        {member.id === currentUserId ? " (tú)" : ""}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>
          ) : null}
        </div>
      ) : null
    ) : null;

  const contenidoDeLaLista = (
    <>
      <div className="border-b border-border px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Asignar chat
      </div>

      {loading ? (
        <div className="px-3 py-3 text-[12px] text-muted-foreground">Cargando equipo…</div>
      ) : error ? (
        <div className="px-3 py-3 text-[12px] text-red-500">{error}</div>
      ) : (
        <div className="max-h-72 min-h-0 overflow-y-auto py-1">
          {/* Tomar / soltar / pasar a una companera, para quien no es jefe */}
          {!isManager ? (
            <>
              {!assignedToMe ? (
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => currentUserId && handleAssign(currentUserId)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-foreground transition hover:bg-muted disabled:opacity-50"
                >
                  <UserPlus className="h-3.5 w-3.5 text-emerald-500" />
                  Tomar este chat
                </button>
              ) : null}
              {assignedToMe ? (
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => handleAssign(null)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-foreground transition hover:bg-muted disabled:opacity-50"
                >
                  Soltar chat
                </button>
              ) : null}

              {/*
                Pasar el chat a otra persona: es lo que hace falta cuando el cliente pregunta
                algo que se le responde mejor desde otra experiencia. Solo sale si el chat es
                propio o no tiene dueno; el de otra companera no se toca (eso es de jefes).
              */}
              {puedeTraspasar ? (
                <>
                  <div className="mt-1 border-t border-border px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Pasar a
                  </div>
                  {companeras.length === 0 ? (
                    <div className="px-3 py-2 text-[12px] text-muted-foreground">
                      No hay nadie mas en el equipo.
                    </div>
                  ) : (
                    companeras.map((member) => (
                      <button
                        key={member.id}
                        type="button"
                        disabled={isPending}
                        onClick={() => handleAssign(member.id)}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-foreground transition hover:bg-muted disabled:opacity-50"
                      >
                        <span className="min-w-0 truncate">{memberLabel(member)}</span>
                      </button>
                    ))
                  )}
                </>
              ) : null}

              {assignee && !assignedToMe ? (
                <div className="px-3 py-2 text-[12px] text-muted-foreground">
                  Asignado a {memberLabel(assignee)}
                </div>
              ) : null}
            </>
          ) : (
            <>
              <button
                type="button"
                disabled={isPending}
                onClick={() => handleAssign(null)}
                className="flex w-full items-center justify-between px-3 py-2 text-left text-[13px] text-muted-foreground transition hover:bg-muted disabled:opacity-50"
              >
                <span>Sin asignar</span>
                {!assignee ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : null}
              </button>
              {members.map((member) => {
                const selected = assignee?.id === member.id;
                return (
                  <button
                    key={member.id}
                    type="button"
                    disabled={isPending}
                    onClick={() => handleAssign(member.id)}
                    className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[13px] text-foreground transition hover:bg-muted disabled:opacity-50"
                  >
                    <span className="min-w-0 truncate">
                      {memberLabel(member)}
                      {member.id === currentUserId ? " (tú)" : ""}
                    </span>
                    {selected ? <Check className="h-3.5 w-3.5 shrink-0 text-emerald-500" /> : null}
                  </button>
                );
              })}
            </>
          )}
        </div>
      )}
    </>
  );

  return (
    <>
    <div ref={containerRef} className="relative">
      {compacto ? (
        <button
          ref={botonCompactoRef}
          type="button"
          onClick={handleToggle}
          className={CLASES_BOTON_DE_LA_BARRA}
          onContextMenu={mostrarNombreAlMantener(assignee ? `Asignado a ${buttonLabel}` : "Asignar chat")}
          title={assignee ? `Asignado a ${buttonLabel}` : "Asignar chat"}
          aria-label={assignee ? `Asignado a ${buttonLabel}` : "Asignar chat"}
          aria-haspopup="menu"
          aria-expanded={open}
        >
          {assignee ? (
            <UserCheck className="size-4 text-emerald-600" />
          ) : (
            <UserPlus className="size-4 text-foreground/80" />
          )}
          <span className={CLASES_ETIQUETA_DE_LA_BARRA}>{assignee ? "Asignado" : "Asignar"}</span>
        </button>
      ) : (
      <button
        type="button"
        onClick={handleToggle}
        className={`inline-flex h-7 max-w-[160px] items-center gap-1.5 rounded-md border px-2 text-[12px] font-medium transition ${
          assignee
            ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20"
            : "border-border bg-card text-muted-foreground hover:bg-muted"
        }`}
        title={assignee ? `Asignado a ${buttonLabel}` : "Asignar chat"}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {assignee ? <UserCheck className="h-3.5 w-3.5 shrink-0" /> : <UserPlus className="h-3.5 w-3.5 shrink-0" />}
        <span className="truncate">{buttonLabel}</span>
        <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
      </button>
      )}

      {open && compacto && posicionLista && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={listaRef}
              // Para React el portal sigue dentro de la barra: los clics no siguen subiendo.
              onClick={(evento) => evento.stopPropagation()}
              style={{
                ...(posicionLista.top === undefined ? {} : { top: posicionLista.top }),
                ...(posicionLista.bottom === undefined ? {} : { bottom: posicionLista.bottom }),
                left: posicionLista.left,
                maxHeight: posicionLista.alto,
              }}
              className="fixed z-[100] flex w-56 max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-xl border border-border bg-popover shadow-[0_18px_50px_-24px_rgba(15,23,42,0.35)]"
            >
              {contenidoDeLaLista}
            </div>,
            document.body,
          )
        : null}
      {open && !compacto ? (
        <div
          className="absolute right-0 w-60 z-50 mt-1 overflow-hidden rounded-xl border border-border bg-popover shadow-[0_18px_50px_-24px_rgba(15,23,42,0.35)]"
        >
          {contenidoDeLaLista}
        </div>
      ) : null}
    </div>
    {bloqueSegundo}
    </>
  );
}
