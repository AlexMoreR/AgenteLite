"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, UserCheck, UserPlus, X } from "lucide-react";
import {
  asignarSegundoAsesorAction,
  assignChatAction,
  getAssignableMembersAction,
  type AssignableMember,
} from "@/app/actions/chats-actions";
import {
  olvidarSiYaLlego,
  recordarAsignacion,
  useAsignadoMostrado,
} from "@/components/chats/asignacion-optimista";
import { queVeDelSegundoAsesor } from "@/lib/chats-asignacion-compartida";

type AssignChatControlProps = {
  conversationId: string;
  assignee: { id: string; name: string | null; email: string } | null;
  // De que canal es el chat: los de la API oficial se guardan en otra tabla.
  source?: "agent" | "official";
  /** Barra del celular: solo el icono (verde si tiene asesora); el nombre va en el title. */
  compacto?: boolean;
  /**
   * El segundo asesor del chat (null = no tiene). Solo lo pasa la ficha del chat: sin este dato
   * (undefined) no se dibuja "Agregar asesor", para no ofrecerlo en un chat que ya tiene segundo.
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
  segundoAsesor,
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
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
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
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

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
    [assignee?.id, conversationId, members, router, source],
  );

  const assignedToMe = Boolean(assignee && currentUserId && assignee.id === currentUserId);
  const buttonLabel = assignee ? memberLabel(assignee) : "Sin asignar";
  // Un chat se puede traspasar cuando es propio o no tiene dueno. El servidor vuelve a
  // comprobarlo: esto es solo para no ofrecer algo que va a ser rechazado.
  const puedeTraspasar = !assignee || assignedToMe;
  const companeras = members.filter((member) => member.id !== currentUserId);

  const control = (
    <div ref={containerRef} className="relative">
      {compacto ? (
        <button
          type="button"
          onClick={handleToggle}
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-card transition hover:bg-muted disabled:opacity-60"
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

      {open ? (
        /* En la barra del celular el boton queda a la IZQUIERDA: alineado a la derecha, la lista
           se salia de la pantalla por ese lado y se veia cortada. Ahi abre hacia la derecha. */
        <div
          className={`absolute ${compacto ? "left-0 w-56" : "right-0 w-60"} z-50 mt-1 overflow-hidden rounded-xl border border-border bg-popover shadow-[0_18px_50px_-24px_rgba(15,23,42,0.35)]`}
        >
          <div className="border-b border-border px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Asignar chat
          </div>

          {loading ? (
            <div className="px-3 py-3 text-[12px] text-muted-foreground">Cargando equipo…</div>
          ) : error ? (
            <div className="px-3 py-3 text-[12px] text-red-500">{error}</div>
          ) : (
            <div className="max-h-72 overflow-y-auto py-1">
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
        </div>
      ) : null}
    </div>
  );

  // El segundo asesor va solo en la ficha (no en la barra del celular) y solo en WhatsApp normal:
  // la API oficial no tiene segundo asesor.
  if (compacto || source !== "agent" || segundoAsesor === undefined) {
    return control;
  }

  return (
    <div className="space-y-2">
      {control}
      <SegundoAsesorControl
        conversationId={conversationId}
        principalId={assignee?.id ?? null}
        segundoAsesorDelServidor={segundoAsesor}
        members={members}
        currentUserId={currentUserId}
        isManager={isManager}
      />
    </div>
  );
}

/*
  La marca optimista del segundo asesor vive en el mismo almacen que la de "Asignar"
  (asignacion-optimista), con su propia clave: asi tampoco se pierde si el router.refresh()
  desmonta la ficha justo despues de tocar.
*/
function claveDelSegundo(conversationId: string) {
  return `segundo:${conversationId}`;
}

/**
 * "Agregar asesor" debajo de "Asignar": un segundo asesor para el chat, sin cambiar al principal.
 * Con segundo asesor se ve su nombre con una "x" para quitarlo.
 *
 * Lo ve solo quien lo puede usar (el servidor lo vuelve a comprobar): el jefe o el principal
 * agregan y quitan; el segundo asesor solo ve su "x" para quitarse.
 */
function SegundoAsesorControl({
  conversationId,
  principalId,
  segundoAsesorDelServidor,
  members,
  currentUserId,
  isManager,
}: {
  conversationId: string;
  principalId: string | null;
  segundoAsesorDelServidor: { id: string; name: string | null } | null;
  members: AssignableMember[];
  currentUserId: string | null;
  isManager: boolean;
}) {
  const clave = claveDelSegundo(conversationId);
  const delServidor = segundoAsesorDelServidor
    ? { id: segundoAsesorDelServidor.id, name: segundoAsesorDelServidor.name, email: "" }
    : null;
  const segundo = useAsignadoMostrado(clave, delServidor);
  const segundoIdDelServidor = segundoAsesorDelServidor?.id ?? null;

  // Cuando el servidor ya dice lo mismo, se suelta la marca (igual que en "Asignar").
  useEffect(() => {
    olvidarSiYaLlego(clave, segundoIdDelServidor ? { id: segundoIdDelServidor, name: null, email: "" } : null);
  }, [clave, segundoIdDelServidor]);

  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  const cambiarSegundo = useCallback(
    (userId: string | null) => {
      // Elegir a quien ya esta (o quitar cuando no hay nadie) no es un cambio: es un toque de mas.
      if ((segundo?.id ?? null) === userId) {
        setOpen(false);
        return;
      }
      setError(null);
      startTransition(async () => {
        const result = await asignarSegundoAsesorAction({ conversationId, userId });
        if (result?.error) {
          setError(result.error);
          return;
        }
        const elegido = userId ? (members.find((miembro) => miembro.id === userId) ?? null) : null;
        recordarAsignacion(
          clave,
          elegido
            ? { id: elegido.id, name: elegido.name, email: elegido.email }
            : result.segundoAsesor
              ? { id: result.segundoAsesor.id, name: result.segundoAsesor.name, email: "" }
              : null,
        );
        setOpen(false);
      });
      // Como en "Asignar": por fuera de la transicion, para que la bandeja ("Mias") se entere.
      router.refresh();
    },
    [clave, conversationId, members, router, segundo?.id],
  );

  const { puedeAgregar, puedeQuitar } = queVeDelSegundoAsesor({
    principalId,
    segundoId: segundo?.id ?? null,
    usuarioId: currentUserId,
    esJefe: isManager,
  });
  const nombreDelSegundo = segundo ? memberLabel({ name: segundo.name, email: segundo.email || "Colaborador" }) : "";
  const soyElSegundo = Boolean(segundo && segundo.id === currentUserId);
  // La misma lista del equipo de "Asignar", sin el principal (ese ya esta en el chat).
  const elegibles = members.filter((member) => member.id !== principalId);

  if (!puedeAgregar && !puedeQuitar) {
    return null;
  }

  return (
    <div ref={containerRef} className="relative">
      {segundo ? (
        <div className="flex min-h-9 items-center gap-1 rounded-md border border-emerald-500/20 bg-emerald-500/10 pl-2.5 text-[13px] font-medium text-emerald-600">
          <UserCheck className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate" title={`También atiende: ${nombreDelSegundo}`}>
            {nombreDelSegundo}
            {soyElSegundo ? " (tú)" : ""}
          </span>
          <button
            type="button"
            disabled={isPending}
            onClick={() => cambiarSegundo(null)}
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-md transition hover:bg-emerald-500/20 disabled:opacity-50"
            title={soyElSegundo ? "Quitarme del chat" : "Quitar del chat"}
            aria-label={soyElSegundo ? "Quitarme del chat" : `Quitar a ${nombreDelSegundo} del chat`}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          disabled={isPending}
          onClick={() => setOpen((value) => !value)}
          className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-border bg-card px-3 text-[13px] font-medium text-muted-foreground transition hover:bg-muted disabled:opacity-60"
          aria-haspopup="menu"
          aria-expanded={open}
        >
          <UserPlus className="h-4 w-4 shrink-0" />
          Agregar asesor
        </button>
      )}

      {open && !segundo ? (
        <div className="absolute right-0 z-50 mt-1 w-full min-w-[15rem] overflow-hidden rounded-xl border border-border bg-popover shadow-[0_18px_50px_-24px_rgba(15,23,42,0.35)]">
          <div className="border-b border-border px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Agregar asesor al chat
          </div>
          <div className="max-h-72 overflow-y-auto py-1">
            {members.length === 0 ? (
              <div className="px-3 py-3 text-[12px] text-muted-foreground">Cargando equipo…</div>
            ) : elegibles.length === 0 ? (
              <div className="px-3 py-3 text-[12px] text-muted-foreground">No hay nadie más en el equipo.</div>
            ) : (
              elegibles.map((member) => (
                <button
                  key={member.id}
                  type="button"
                  disabled={isPending}
                  onClick={() => cambiarSegundo(member.id)}
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

      {error ? <p className="mt-1 text-[12px] text-red-500">{error}</p> : null}
    </div>
  );
}
